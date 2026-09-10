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
  countPieces,
  destinationsFrom,
  dropDestinations,
  indexOf,
  initialGameState,
  isKingGuarded,
  legalMoves,
  mustPass,
  pieceAt,
  previewDrop,
  resign,
  samePos,
  simulateDrop,
} from '../core/index.ts';
import { COLOR_NAME, resultReason, resultTitle } from './labels.ts';
import { View, type CellView, type ViewModel } from './view.ts';

/** 1段ぶんの反転アニメーションにかける時間。 */
const CHAIN_STEP_MS = 190;

const ANIMATE_KEY = 'negaeri:animate';

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
  private readonly view: View;

  constructor(root: HTMLElement) {
    this.animate = window.localStorage.getItem(ANIMATE_KEY) !== 'off';
    this.view = new View(root, {
      onCell: (row, col) => this.handleCell({ row, col }),
      onHand: (owner, piece) => this.handleHand(owner, piece),
      onConfirm: () => this.confirmSelection(),
      onUndo: () => this.undo(),
      onPass: () => this.play({ kind: 'pass' }),
      onResign: () => this.handleResign(),
      onToggleAnimate: () => this.toggleAnimate(),
      onRematch: () => this.rematch(),
    });
    this.render();
  }

  // -------------------------------------------------------------------------
  // 操作
  // -------------------------------------------------------------------------

  private handleHand(owner: Color, piece: DroppablePieceType): void {
    if (this.busy || this.state.result.kind !== 'playing') return;
    if (owner !== this.state.turn) return;
    if (this.state.hands[owner][piece] <= 0) return;

    const alreadySelected =
      (this.selection.kind === 'hand' || this.selection.kind === 'drop') &&
      this.selection.piece === piece;
    this.selection = alreadySelected ? { kind: 'none' } : { kind: 'hand', piece };
    this.render();
  }

  private handleCell(pos: Pos): void {
    if (this.busy || this.state.result.kind !== 'playing') return;
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
    if (!window.confirm(`${COLOR_NAME[this.state.turn]}が投了します。よろしいですか？`)) return;
    this.history.push(this.state);
    this.state = resign(this.state, this.state.turn);
    this.selection = { kind: 'none' };
    this.render();
    this.showResult();
  }

  private toggleAnimate(): void {
    this.animate = !this.animate;
    window.localStorage.setItem(ANIMATE_KEY, this.animate ? 'on' : 'off');
    this.render();
  }

  private undo(): void {
    if (this.busy) return;
    const previous = this.history.pop();
    if (!previous) return;
    this.state = previous;
    this.selection = { kind: 'none' };
    this.lastMove = null;
    this.justFlipped = [];
    this.view.hideResult();
    this.render();
  }

  private rematch(): void {
    this.state = initialGameState();
    this.history = [];
    this.selection = { kind: 'none' };
    this.lastMove = null;
    this.justFlipped = [];
    this.view.hideResult();
    this.render();
  }

  // -------------------------------------------------------------------------
  // 手を進める
  // -------------------------------------------------------------------------

  private async play(move: Move): Promise<void> {
    if (this.busy || this.state.result.kind !== 'playing') return;

    const before = this.state;
    const outcome = applyMoveWithDetail(before, move);

    this.history.push(before);
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

    if (outcome.chainCount >= 3) this.view.showChainBanner(outcome.chainCount);
    if (this.state.result.kind !== 'playing') this.showResult();
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
      turnLabel: playing ? `${COLOR_NAME[state.turn]}番` : resultTitle(state.result),
      turnColor: state.turn,
      hint: this.hint(animating),
      counts: `${counts.sente} 対 ${counts.gote}`,
      confirmLabel: this.selection.kind === 'drop' && !animating ? '打つ' : null,
      canUndo: this.history.length > 0 && !animating,
      canPass: playing && mustPass(state) && !animating,
      canResign: playing && !animating,
      animateLabel: this.animate ? '演出 ON' : '演出 OFF',
    };
  }

  private hint(animating: boolean): string {
    if (animating) return '反転中…';
    const { state } = this;
    if (state.result.kind !== 'playing') return resultReason(state.result);
    if (mustPass(state)) return '合法手がありません。パスしてください';

    switch (this.selection.kind) {
      case 'drop': {
        const { chainCount, flips } = this.selection.preview;
        if (flips.length === 0) return 'ここに打つ（裏返る駒なし）';
        return `${flips.length}枚 裏返る${chainCount >= 2 ? ` / ${chainCount}連鎖` : ''}`;
      }
      case 'hand':
        return '打つマスを選ぶ（数字は裏返る枚数）';
      case 'board':
        return '動かすマスを選ぶ';
      default:
        return legalMoves(state).length > 0 ? '駒か持ち駒をタップ' : '';
    }
  }

  private showResult(): void {
    const counts = countPieces(this.state.board);
    this.view.showResult(
      resultTitle(this.state.result),
      resultReason(this.state.result),
      `盤上の駒 先手 ${counts.sente} / 後手 ${counts.gote}　　` +
        `最大連鎖 先手 ${this.state.maxChainCount.sente} / 後手 ${this.state.maxChainCount.gote}`,
    );
  }
}
