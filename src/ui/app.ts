/**
 * 操作のコントローラ。タップの流れと、盤に出す印を決める。
 *
 * タップの流れ（ドラッグ不要）:
 *   持ち駒をタップ → 打てるマスに点、裏返る枚数バッジ
 *   打てるマスをタップ → 裏返る駒を段数つきでプレビュー（まだ打っていない）
 *   同じマスをもう一度タップ、または「打つ」ボタン → 確定
 *   盤の自分の駒をタップ → 動けるマスに点 → タップで移動
 */
import type {
  Board,
  Color,
  DroppablePieceType,
  GameState,
  Move,
  Pos,
  ChainResult,
} from '../core/index.ts';
import {
  BOARD_SIZE,
  applyMoveWithDetail,
  formatMove,
  countPieces,
  destinationsFrom,
  dropDestinations,
  indexOf,
  findKing,
  initialGameState,
  isInCheck,
  isKingGuarded,
  legalMoves,
  mustPass,
  pieceAt,
  previewDrop,
  resign,
  samePos,
  simulateDrop,
} from '../core/index.ts';
import type { ClockState, MatchServerMessage, PlayerInfo } from '../../worker/protocol.ts';
import type { Difficulty } from '../ai/search.ts';
import { AiClient } from './ai-client.ts';
import { OnlineSession, loadIdentity, type Identity } from './online.ts';
import { showRanking } from './ranking.ts';
import { initLang, languageCode, nextLang, peekNextLang, t } from '../i18n/index.ts';
import { colorName, resultReason, resultTitle } from './labels.ts';
import { Sound } from './sound.ts';
import { showTutorial } from './tutorial.ts';
import { View, type CellView, type OpponentMode, type ViewModel } from './view.ts';

/** 1段ぶんの反転アニメーションにかける時間。 */
const CHAIN_STEP_MS = 190;

const ANIMATE_KEY = 'negaeri:animate';
const MODE_KEY = 'negaeri:mode';

/** AI が受け持つ側。人間はいつも先手。 */
const AI_COLOR: Color = 'gote';

/** 持ち時間を mm:ss にする。 */
function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 指し手が一瞬で返ってきても、指した感じが出るように少し待つ。 */
const AI_MIN_THINK_MS = 260;

type Selection =
  | { kind: 'none' }
  | { kind: 'hand'; piece: DroppablePieceType }
  | { kind: 'board'; from: Pos }
  | { kind: 'drop'; piece: DroppablePieceType; to: Pos; preview: ChainResult };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

export class App {
  private state: GameState = initialGameState();
  private history: GameState[] = [];
  private selection: Selection = { kind: 'none' };
  private animate = true;
  private busy = false;
  private lastMove: Pos | null = null;
  private justFlipped: readonly Pos[] = [];
  private mode: OpponentMode = 'local';
  private thinking = false;
  private readonly ai = new AiClient();
  private readonly sound = new Sound();
  private online: OnlineSession | null = null;
  private identity: Identity | null = null;
  private onlinePlayers: Readonly<Record<Color, PlayerInfo>> | null = null;
  private onlineColor: Color = 'sente';
  private clock: ClockState | null = null;
  /** 時計の基準時刻。ここからの経過を手番側から引いて表示する */
  private clockAt = 0;
  private clockTimer: number | null = null;
  private banner: string | null = null;
  /** ここまでの棋譜。共有ボタンでコピーする */
  private moveLog: string[] = [];
  private readonly view: View;

  constructor(root: HTMLElement) {
    initLang();
    this.animate = window.localStorage.getItem(ANIMATE_KEY) !== 'off';
    const savedMode = window.localStorage.getItem(MODE_KEY);
    if (savedMode === 'local' || savedMode === 'easy' || savedMode === 'normal' || savedMode === 'hard') {
      this.mode = savedMode;
    }
    this.view = new View(root, {
      onCell: (row, col) => this.handleCell({ row, col }),
      onHand: (owner, piece) => this.handleHand(owner, piece),
      onConfirm: () => this.confirmSelection(),
      onUndo: () => this.undo(),
      onPass: () => this.play({ kind: 'pass' }),
      onResign: () => this.handleResign(),
      onToggleAnimate: () => this.toggleAnimate(),
      onToggleMute: () => this.toggleMute(),
      onRematch: () => this.rematch(),
      onMode: (mode) => this.setMode(mode),
      onHelp: () => showTutorial(true),
      onToggleLang: () => this.toggleLang(),
      onRanking: () => void showRanking(this.identity),
      onShare: () => void this.shareKifu(),
    });
    this.render();
    showTutorial();
  }

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------

  /** いま人間が操作してよいか。 */
  private get humanTurn(): boolean {
    if (this.busy || this.thinking) return false;
    if (this.state.result.kind !== 'playing') return false;
    if (this.mode === 'online') {
      return this.onlinePlayers !== null && this.state.turn === this.onlineColor;
    }
    return this.mode === 'local' || this.state.turn !== AI_COLOR;
  }

  private handleHand(owner: Color, piece: DroppablePieceType): void {
    if (!this.humanTurn) return;
    if (owner !== this.state.turn) return;
    if (this.state.hands[owner][piece] <= 0) return;

    const alreadySelected =
      (this.selection.kind === 'hand' || this.selection.kind === 'drop') &&
      this.selection.piece === piece;
    this.selection = alreadySelected ? { kind: 'none' } : { kind: 'hand', piece };
    this.render();
  }

  private handleCell(pos: Pos): void {
    if (!this.humanTurn) return;
    const { selection } = this;

    // 打つ手のプレビュー中に同じマスをもう一度 → 確定
    if (selection.kind === 'drop' && samePos(selection.to, pos)) {
      this.confirmSelection();
      return;
    }

    // 持ち駒を選んでいる（またはプレビュー中に別のマス）→ プレビューし直す
    if (selection.kind === 'hand' || selection.kind === 'drop') {
      const canDrop = this.dropTargets(selection.piece).some((target) => samePos(target, pos));
      if (canDrop) {
        this.selection = {
          kind: 'drop',
          piece: selection.piece,
          to: pos,
          preview: previewDrop(this.state, selection.piece, pos),
        };
        this.render();
        return;
      }
    }

    // 盤の駒を動かす
    if (selection.kind === 'board') {
      if (samePos(selection.from, pos)) {
        this.selection = { kind: 'none' };
        this.render();
        return;
      }
      const reachable = destinationsFrom(this.state.board, selection.from).some((target) =>
        samePos(target, pos),
      );
      if (reachable) {
        void this.play({ kind: 'move', from: selection.from, to: pos });
        return;
      }
    }

    const piece = pieceAt(this.state.board, pos);
    if (piece && piece.owner === this.state.turn) {
      this.selection = { kind: 'board', from: pos };
    } else {
      this.selection = { kind: 'none' };
    }
    this.render();
  }

  private confirmSelection(): void {
    if (this.selection.kind !== 'drop') return;
    void this.play({ kind: 'drop', piece: this.selection.piece, to: this.selection.to });
  }

  private handleResign(): void {
    if (this.state.result.kind !== 'playing') return;
    const who = this.mode === 'online' ? this.onlineColor : this.state.turn;
    if (!window.confirm(t('confirm.resign', { color: colorName(who) }))) return;
    if (this.mode === 'online') {
      this.online?.resign();
      return;
    }
    this.history.push(this.state);
    this.state = resign(this.state, this.state.turn);
    this.selection = { kind: 'none' };
    this.render();
    this.showResult();
  }

  private setMode(mode: OpponentMode): void {
    if (this.thinking || this.mode === mode) return;
    this.leaveOnline();
    this.mode = mode;
    window.localStorage.setItem(MODE_KEY, mode);
    this.ai.reset();
    this.selection = { kind: 'none' };

    if (mode === 'online') {
      void this.startOnline();
      return;
    }

    this.state = initialGameState();
    this.history = [];
    this.moveLog = [];
    this.lastMove = null;
    this.justFlipped = [];
    this.render();
    void this.maybeLetAiMove();
  }

  /** オンライン対戦をやめて、後片付けする。 */
  private leaveOnline(): void {
    this.online?.stop();
    this.online = null;
    this.onlinePlayers = null;
    this.clock = null;
    this.banner = null;
    if (this.clockTimer !== null) {
      window.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private async startOnline(): Promise<void> {
    this.banner = t('online.connecting');
    this.state = initialGameState();
    this.history = [];
    this.moveLog = [];
    this.lastMove = null;
    this.justFlipped = [];
    this.render();

    try {
      this.identity ??= await loadIdentity();
    } catch {
      this.banner = t('online.error', { message: t('online.connecting') });
      this.render();
      return;
    }

    this.online = new OnlineSession(this.identity, {
      onSearching: (range, waitedMs) => {
        this.banner = t('online.searching', {
          range,
          seconds: Math.floor(waitedMs / 1000),
        });
        this.render();
      },
      onStart: (you, players) => {
        this.onlineColor = you;
        this.onlinePlayers = players;
        const opponent = players[you === 'sente' ? 'gote' : 'sente'];
        this.banner = t('online.matched', { name: opponent.name, rating: opponent.rating });
        this.startClockTicking();
        this.render();
      },
      onState: (state, clock, lastMove, chainCount) => {
        void this.onOnlineState(state, clock, lastMove, chainCount);
      },
      onOpponentLeft: (graceMs) => {
        this.banner = t('online.opponentLeft', { seconds: Math.round(graceMs / 1000) });
        this.render();
      },
      onOpponentBack: () => {
        this.banner = t('online.opponentBack');
        this.render();
      },
      onOver: (message) => this.onOnlineOver(message),
      onError: (message) => {
        this.banner = t('online.error', { message });
        this.render();
      },
    });
    this.online.start();
  }

  /** サーバから届いた局面を反映する。反転は同じ演出で見せる。 */
  private lastFlipCount = 0;

  private async onOnlineState(
    state: GameState,
    clock: ClockState,
    lastMove: Move | null,
    chainCount: number,
  ): Promise<void> {
    const before = this.state;
    this.lastFlipCount =
      lastMove?.kind === 'drop'
        ? previewDrop(before, lastMove.piece, lastMove.to).flips.length
        : 0;
    this.clock = clock;
    this.clockAt = Date.now();
    this.selection = { kind: 'none' };
    this.lastMove = lastMove && lastMove.kind !== 'pass' ? lastMove.to : null;

    if (lastMove?.kind === 'drop') {
      this.sound.unlock();
      this.sound.play('place');
      if (chainCount > 0 && this.animate) {
        this.busy = true;
        await this.animateChain(before, lastMove.piece, lastMove.to, chainCount);
        this.busy = false;
      }
    } else if (lastMove?.kind === 'move') {
      this.sound.play('move');
    }

    if (lastMove) this.moveLog.push(formatMove(lastMove));
    this.state = state;
    this.justFlipped = [];
    this.render();

    if (this.isBigTurn(chainCount, this.lastFlipCount)) {
      this.view.showChainBanner(chainCount, this.lastFlipCount);
      this.sound.play('chain');
    }
  }

  /** 見せ場かどうか。連鎖が続いたか、一度に大量に寝返らせたか。 */
  private isBigTurn(chainCount: number, flips: number): boolean {
    return chainCount >= 3 || flips >= 4;
  }

  private onOnlineOver(message: Extract<MatchServerMessage, { type: 'over' }>): void {
    this.state = { ...this.state, result: message.result };
    const delta = message.ratingDelta[this.onlineColor];
    const rating = message.newRating[this.onlineColor];
    this.banner = t('online.ratingDelta', {
      rating,
      delta: delta >= 0 ? `+${delta}` : String(delta),
    });
    if (this.clockTimer !== null) {
      window.clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
    this.render();
    this.showResult();
  }

  /** 手番側の残り時間を毎秒減らして見せる。 */
  private startClockTicking(): void {
    if (this.clockTimer !== null) return;
    this.clockTimer = window.setInterval(() => {
      if (this.clock) this.render();
    }, 500);
  }

  /** 棋譜をクリップボードにコピーする。大連鎖が出た対局を見せ合えるように。 */
  private async shareKifu(): Promise<void> {
    if (this.moveLog.length === 0) return;
    const counts = countPieces(this.state.board);
    const header = [
      `# ${t('app.title')} ${this.moveLog.length}手`,
      `# ${t('result.stats', {
        sente: counts.sente,
        gote: counts.gote,
        chainSente: this.state.maxChainCount.sente,
        chainGote: this.state.maxChainCount.gote,
      })}`,
    ].join('\n');
    const text = `${header}\n${this.moveLog.join(' ')}\n`;

    try {
      await navigator.clipboard.writeText(text);
      this.banner = t('share.copied');
    } catch {
      this.banner = t('share.failed');
    }
    this.render();
    window.setTimeout(() => {
      if (this.banner === t('share.copied') || this.banner === t('share.failed')) {
        this.banner = null;
        this.render();
      }
    }, 2500);
  }

  private toggleLang(): void {
    nextLang();
    this.render();
  }

  private toggleMute(): void {
    this.sound.toggleMute();
    this.sound.unlock();
    this.sound.play('place');
    this.render();
  }

  private toggleAnimate(): void {
    this.animate = !this.animate;
    window.localStorage.setItem(ANIMATE_KEY, this.animate ? 'on' : 'off');
    this.render();
  }

  private undo(): void {
    if (this.busy || this.thinking) return;
    let previous = this.history.pop();
    if (!previous) return;
    // AI 対戦中は「自分の手」まで戻す
    if (this.mode !== 'local' && previous.turn === AI_COLOR && this.history.length > 0) {
      previous = this.history.pop() ?? previous;
    }
    this.state = previous;
    this.moveLog = this.moveLog.slice(0, previous.ply);
    this.selection = { kind: 'none' };
    this.lastMove = null;
    this.justFlipped = [];
    this.view.hideResult();
    this.render();
  }

  private rematch(): void {
    if (this.mode === 'online') {
      this.leaveOnline();
      void this.startOnline();
      this.view.hideResult();
      return;
    }
    this.ai.reset();
    this.state = initialGameState();
    this.history = [];
    this.moveLog = [];
    this.selection = { kind: 'none' };
    this.lastMove = null;
    this.justFlipped = [];
    this.view.hideResult();
    this.render();
    void this.maybeLetAiMove();
  }

  /** AI の手番なら考えさせて指させる。 */
  private async maybeLetAiMove(): Promise<void> {
    if (this.mode === 'local' || this.mode === 'online') return;
    if (this.state.result.kind !== 'playing') return;
    if (this.state.turn !== AI_COLOR) return;
    if (this.thinking || this.busy) return;

    this.thinking = true;
    this.render();

    const difficulty: Difficulty = this.mode;

    const asked = this.state;
    let move: Move | null = null;
    try {
      const started = Date.now();
      const thought = await this.ai.think(asked, difficulty);
      const rest = AI_MIN_THINK_MS - (Date.now() - started);
      if (rest > 0) await sleep(rest);
      move = thought.move;
    } catch (error) {
      console.error('AI の思考でエラー', error);
    } finally {
      this.thinking = false;
    }

    // 考えているあいだに待った・再対局などで局面が変わっていたら捨てる
    if (this.state !== asked) {
      this.render();
      return;
    }

    await this.play(move ?? { kind: 'pass' });
  }

  // -------------------------------------------------------------------------
  // 手を進める
  // -------------------------------------------------------------------------

  private async play(move: Move): Promise<void> {
    if (this.busy || this.state.result.kind !== 'playing') return;

    // オンラインでは自分で局面を進めない。サーバが検証して返してきたものだけを反映する
    if (this.mode === 'online') {
      this.selection = { kind: 'none' };
      this.online?.sendMove(move);
      this.render();
      return;
    }

    const before = this.state;
    const outcome = applyMoveWithDetail(before, move);

    this.sound.unlock();
    if (move.kind === 'drop') this.sound.play('place');
    else if (move.kind === 'move') this.sound.play(outcome.captured ? 'capture' : 'move');

    this.history.push(before);
    this.moveLog.push(formatMove(move));
    this.selection = { kind: 'none' };
    this.lastMove = move.kind === 'pass' ? null : move.to;

    if (move.kind === 'drop' && outcome.chainCount > 0 && this.animate) {
      this.busy = true;
      await this.animateChain(before, move.piece, move.to, outcome.chainCount);
      this.busy = false;
    }

    this.state = outcome.state;
    this.justFlipped = outcome.flips;
    this.render();

    if (this.isBigTurn(outcome.chainCount, outcome.flips.length)) {
      this.view.showChainBanner(outcome.chainCount, outcome.flips.length);
      this.sound.play('chain');
    } else if (outcome.chainCount > 0 && !this.animate) {
      // 演出オフのときは1回だけ鳴らす
      this.sound.play('flip');
    }

    if (this.state.result.kind !== 'playing') {
      this.showResult();
      return;
    }

    void this.maybeLetAiMove();
  }

  /**
   * 反転を段ごとに時間差で見せる。
   * 各段の途中盤面は、連鎖の上限を段数に絞って解き直して求める。
   */
  private async animateChain(
    before: GameState,
    piece: DroppablePieceType,
    to: Pos,
    chainCount: number,
  ): Promise<void> {
    for (let step = 0; step <= chainCount; step += 1) {
      const partial = simulateDrop(before.board, to, piece, before.turn, { maxChain: step });
      const flipped = step === 0 ? [] : (partial.steps[step - 1] ?? []);
      // 段が上がるごとに音を高くする
      if (step > 0) this.sound.play('flip', (step - 1) * 3);
      this.renderBoardOnly(partial.board, flipped);
      await sleep(CHAIN_STEP_MS);
    }
  }

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  private dropTargets(piece: DroppablePieceType): Pos[] {
    return dropDestinations(this.state.board, this.state.turn, piece);
  }

  private render(): void {
    this.view.render(this.buildModel(this.state.board, this.justFlipped));
  }

  /** アニメーション中だけ盤の中身を差し替える。 */
  private renderBoardOnly(board: Board, justFlipped: readonly Pos[]): void {
    this.view.render(this.buildModel(board, justFlipped, true));
  }

  private buildModel(
    board: Board,
    justFlipped: readonly Pos[],
    animating = false,
  ): ViewModel {
    const { state } = this;
    const flipLevels = new Map<number, number>();
    const gains = new Map<number, number>();
    const targets = new Set<number>();
    let selectedIndex: number | null = null;

    if (!animating) {
      if (this.selection.kind === 'board') {
        selectedIndex = indexOf(this.selection.from);
        for (const pos of destinationsFrom(board, this.selection.from)) {
          targets.add(indexOf(pos));
        }
      } else if (this.selection.kind === 'hand') {
        for (const pos of this.dropTargets(this.selection.piece)) {
          targets.add(indexOf(pos));
          const gain = previewDrop(state, this.selection.piece, pos).flips.length;
          if (gain > 0) gains.set(indexOf(pos), gain);
        }
      } else if (this.selection.kind === 'drop') {
        selectedIndex = indexOf(this.selection.to);
        for (const pos of this.dropTargets(this.selection.piece)) targets.add(indexOf(pos));
        this.selection.preview.steps.forEach((step, level) => {
          for (const pos of step) flipLevels.set(indexOf(pos), level + 1);
        });
      }
    }

    const justFlippedSet = new Set(justFlipped.map(indexOf));
    const lastIndex = this.lastMove ? indexOf(this.lastMove) : null;

    // 王手がかかっている玉のマス。玉を取られたら即負けなので必ず見せる
    const checkedKings = new Set<number>();
    for (const color of ['sente', 'gote'] as const) {
      if (!isInCheck(board, color)) continue;
      const king = findKing(board, color);
      if (king) checkedKings.add(indexOf(king));
    }

    const cells: CellView[] = [];
    for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
      const piece = board[index] ?? null;
      cells.push({
        piece,
        selected: selectedIndex === index,
        target: targets.has(index),
        flipLevel: flipLevels.get(index) ?? null,
        gain: gains.get(index) ?? null,
        justFlipped: justFlippedSet.has(index),
        last: lastIndex === index,
        inCheck: checkedKings.has(index),
        guarded:
          piece !== null &&
          piece.type !== 'K' &&
          isKingGuarded(
            board,
            Math.floor(index / BOARD_SIZE),
            index % BOARD_SIZE,
            piece.owner,
          ),
      });
    }

    const selectedHandPiece =
      this.selection.kind === 'hand' || this.selection.kind === 'drop'
        ? this.selection.piece
        : null;

    const playing = state.result.kind === 'playing';
    const buildHand = (owner: Color) =>
      (['P', 'R', 'B'] as const).map((piece) => ({
        piece,
        count: state.hands[owner][piece],
        selected: owner === state.turn && selectedHandPiece === piece,
        enabled: playing && owner === state.turn && !animating,
      }));

    const counts = countPieces(board);

    return {
      cells,
      hands: { sente: buildHand('sente'), gote: buildHand('gote') },
      turnLabel: playing
        ? t('turn.label', { color: colorName(state.turn) })
        : resultTitle(state.result),
      turnColor: state.turn,
      hint: this.hint(animating),
      counts: `${counts.sente} : ${counts.gote}`,
      share: counts.sente + counts.gote === 0 ? 0.5 : counts.sente / (counts.sente + counts.gote),
      confirmLabel: this.selection.kind === 'drop' && !animating ? t('action.confirm') : null,
      canUndo:
        this.mode !== 'online' && this.history.length > 0 && !animating && !this.thinking,
      canPass: this.humanTurn && mustPass(state),
      canResign: playing && !animating && !this.thinking,
      animateLabel: this.animate ? '✨' : '💤',
      muteLabel: this.sound.isMuted ? '🔇' : '🔊',
      langLabel: languageCode(peekNextLang()),
      mode: this.mode,
      thinking: this.thinking,
      clock: this.clockLabels(),
      names: this.onlinePlayers
        ? { sente: this.onlinePlayers.sente.name, gote: this.onlinePlayers.gote.name }
        : null,
      banner: this.banner,
    };
  }

  private clockLabels(): Readonly<Record<Color, string>> | null {
    if (!this.clock) return null;
    const elapsed = this.state.result.kind === 'playing' ? Date.now() - this.clockAt : 0;
    const turn = this.state.turn;
    return {
      sente: formatClock(this.clock.sente - (turn === 'sente' ? elapsed : 0)),
      gote: formatClock(this.clock.gote - (turn === 'gote' ? elapsed : 0)),
    };
  }

  private hint(animating: boolean): string {
    if (this.thinking) return t('hint.thinking');
    if (animating) return t('hint.flipping');
    const { state } = this;
    if (state.result.kind !== 'playing') return resultReason(state.result);
    if (mustPass(state)) return t('hint.mustPass');
    // 玉が取られたら即負け。逃げるか受けるかしないといけないことを知らせる
    if (isInCheck(state.board, state.turn)) return t('hint.inCheck');
    if (this.mode === 'online' && this.onlinePlayers) {
      if (state.turn !== this.onlineColor) return t('online.waiting');
      if (this.selection.kind === 'none') return t('online.yourTurn');
    }

    switch (this.selection.kind) {
      case 'drop': {
        const { chainCount, flips } = this.selection.preview;
        if (flips.length === 0) return t('hint.dropNoFlip');
        return chainCount >= 2
          ? t('hint.dropChain', { count: flips.length, chain: chainCount })
          : t('hint.dropFlips', { count: flips.length });
      }
      case 'hand':
        return t('hint.pickSquare');
      case 'board':
        return t('hint.pickDestination');
      default:
        return legalMoves(state).length > 0 ? t('hint.pickPiece') : '';
    }
  }

  private showResult(): void {
    const { result } = this.state;
    if (result.kind === 'win') {
      // AI 対戦なら自分（先手）が勝ったかどうかで鳴らし分ける
      const humanWon = this.mode === 'local' || result.winner !== AI_COLOR;
      this.sound.play(humanWon ? 'win' : 'lose');
    }
    const counts = countPieces(this.state.board);
    this.view.showResult(
      resultTitle(this.state.result),
      resultReason(this.state.result),
      t('result.stats', {
        sente: counts.sente,
        gote: counts.gote,
        chainSente: this.state.maxChainCount.sente,
        chainGote: this.state.maxChainCount.gote,
      }),
    );
  }
}
