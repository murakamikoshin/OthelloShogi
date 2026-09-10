/**
 * 1対局 = Durable Object 1個。両者と WebSocket でつながる。
 *
 * ここが不正対策の要。クライアントから届いた手は必ず /src/core で検証する。
 * クライアントの申告する局面・時間・勝敗は一切信用しない。
 */
import type { Color, GameState, Move } from '../src/core/index.ts';
import {
  applyMoveWithDetail,
  formatMove,
  initialGameState,
  opponentOf,
  parseMove,
  validateMove,
} from '../src/core/index.ts';
import { verifyToken } from './auth.ts';
import { commitMove, createClock, hasFlagged, snapshot, type Clock } from './clock.ts';
import { finishMatch } from './finish.ts';
import {
  DISCONNECT_GRACE_MS,
  type MatchClientMessage,
  type MatchServerMessage,
  type PlayerInfo,
} from './protocol.ts';
import type { Env } from './env.ts';

/** DO のストレージに置く、対局の設定。 */
interface MatchSetup {
  readonly matchId: string;
  readonly players: Record<Color, PlayerInfo>;
}

interface Seat {
  socket: WebSocket | null;
  /** 切断した時刻。つながっていれば null */
  disconnectedAt: number | null;
}

export class MatchRoom implements DurableObject {
  private setup: MatchSetup | null = null;
  private state: GameState = initialGameState();
  private moves: string[] = [];
  private clock: Clock = createClock(Date.now());
  private seats: Record<Color, Seat> = {
    sente: { socket: null, disconnectedAt: null },
    gote: { socket: null, disconnectedAt: null },
  };
  private finished = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    // DO が眠って起き直したときのために、設定と棋譜を復元する
    void this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<{
        setup: MatchSetup;
        moves: string[];
        remaining: Record<Color, number>;
        finished: boolean;
      }>('match');
      if (!saved) return;
      this.setup = saved.setup;
      this.finished = saved.finished;
      this.moves = saved.moves;
      this.state = replay(saved.moves);
      this.clock = createClock(Date.now());
      this.clock.remaining.sente = saved.remaining.sente;
      this.clock.remaining.gote = saved.remaining.gote;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ロビーから「この2人で対局を始めて」と呼ばれる
    if (url.pathname.endsWith('/create')) {
      const setup = (await request.json()) as MatchSetup;
      this.setup = setup;
      this.state = initialGameState();
      this.moves = [];
      this.clock = createClock(Date.now());
      this.finished = false;
      await this.save();
      return Response.json({ ok: true });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket でつないでください', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.attach(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** 30秒の猶予を超えて戻ってこなかったら時間切れ負けにする。 */
  async alarm(): Promise<void> {
    if (this.finished) return;
    const now = Date.now();

    for (const color of ['sente', 'gote'] as const) {
      const since = this.seats[color].disconnectedAt;
      if (since !== null && now - since >= DISCONNECT_GRACE_MS) {
        await this.endGame({ kind: 'win', winner: opponentOf(color), reason: 'timeout' });
        return;
      }
    }

    // 手番の側が持ち時間を使い切っていないかも見る
    if (hasFlagged(this.clock, this.state.turn, now)) {
      await this.endGame({
        kind: 'win',
        winner: opponentOf(this.state.turn),
        reason: 'timeout',
      });
      return;
    }

    await this.scheduleAlarm();
  }

  // -------------------------------------------------------------------------

  private attach(socket: WebSocket): void {
    socket.addEventListener('message', (event) => {
      void this.onMessage(socket, event.data);
    });
    const drop = (): void => this.onClose(socket);
    socket.addEventListener('close', drop);
    socket.addEventListener('error', drop);
  }

  private async onMessage(socket: WebSocket, raw: unknown): Promise<void> {
    let message: MatchClientMessage;
    try {
      message = JSON.parse(String(raw)) as MatchClientMessage;
    } catch {
      send(socket, { type: 'error', message: '読めないメッセージです' });
      return;
    }

    switch (message.type) {
      case 'join':
        await this.onJoin(socket, message.token);
        return;
      case 'move':
        await this.onMove(socket, message.move);
        return;
      case 'resign':
        await this.onResign(socket);
        return;
      default:
        send(socket, { type: 'error', message: '知らないメッセージです' });
    }
  }

  private colorOf(socket: WebSocket): Color | null {
    if (this.seats.sente.socket === socket) return 'sente';
    if (this.seats.gote.socket === socket) return 'gote';
    return null;
  }

  private async onJoin(socket: WebSocket, token: string): Promise<void> {
    const setup = this.setup;
    if (!setup) {
      send(socket, { type: 'error', message: 'この対局は存在しません' });
      socket.close();
      return;
    }

    const playerId = await verifyToken(token, this.env.TOKEN_SECRET);
    if (!playerId) {
      send(socket, { type: 'error', message: '認証できませんでした' });
      socket.close();
      return;
    }

    const color = (['sente', 'gote'] as const).find(
      (side) => setup.players[side].id === playerId,
    );
    if (!color) {
      send(socket, { type: 'error', message: 'この対局の参加者ではありません' });
      socket.close();
      return;
    }

    // 同じ人が二重に開いたら、古い方を閉じる
    const seat = this.seats[color];
    if (seat.socket && seat.socket !== socket) {
      try {
        seat.socket.close(1000, '別の画面で開き直されました');
      } catch {
        /* すでに閉じている */
      }
    }
    const wasAway = seat.disconnectedAt !== null;
    seat.socket = socket;
    seat.disconnectedAt = null;

    send(socket, {
      type: 'sync',
      you: color,
      players: setup.players,
      moves: this.moves,
      clock: snapshot(this.clock, this.state.turn, Date.now()),
      result: this.state.result,
      bothConnected: this.bothConnected(),
    });

    if (wasAway) this.sendTo(opponentOf(color), { type: 'opponentBack' });
    await this.scheduleAlarm();
  }

  private async onMove(socket: WebSocket, move: Move): Promise<void> {
    const color = this.colorOf(socket);
    if (!color || this.finished) return;

    const now = Date.now();

    // 先に時間切れを見る。時間を使い切ってからの着手は通さない
    if (hasFlagged(this.clock, this.state.turn, now)) {
      await this.endGame({
        kind: 'win',
        winner: opponentOf(this.state.turn),
        reason: 'timeout',
      });
      return;
    }

    if (color !== this.state.turn) {
      send(socket, { type: 'error', message: 'あなたの手番ではありません' });
      return;
    }

    // ここが不正対策。クライアントが何を言ってきてもルールエンジンで検証する
    const invalid = validateMove(this.state, move);
    if (invalid) {
      send(socket, { type: 'error', message: `反則: ${invalid}` });
      await this.endGame({
        kind: 'win',
        winner: opponentOf(color),
        reason: 'illegal_move',
      });
      return;
    }

    const outcome = applyMoveWithDetail(this.state, move);
    this.state = outcome.state;
    this.moves.push(formatMove(move));
    commitMove(this.clock, color, now);
    await this.save();

    this.broadcast({
      type: 'moved',
      move: formatMove(move),
      by: color,
      flipSteps: outcome.flipSteps,
      chainCount: outcome.chainCount,
      clock: snapshot(this.clock, this.state.turn, now),
    });

    if (this.state.result.kind !== 'playing') {
      await this.endGame(this.state.result);
      return;
    }
    await this.scheduleAlarm();
  }

  private async onResign(socket: WebSocket): Promise<void> {
    const color = this.colorOf(socket);
    if (!color || this.finished) return;
    await this.endGame({ kind: 'win', winner: opponentOf(color), reason: 'resign' });
  }

  private onClose(socket: WebSocket): void {
    const color = this.colorOf(socket);
    if (!color) return;
    this.seats[color].socket = null;
    if (this.finished) return;

    this.seats[color].disconnectedAt = Date.now();
    this.sendTo(opponentOf(color), {
      type: 'opponentLeft',
      graceMs: DISCONNECT_GRACE_MS,
    });
    void this.scheduleAlarm();
  }

  // -------------------------------------------------------------------------

  private bothConnected(): boolean {
    return this.seats.sente.socket !== null && this.seats.gote.socket !== null;
  }

  /**
   * 次に様子を見る時刻を決める。
   * 「手番の側の持ち時間が尽きる時刻」と「切断の猶予が切れる時刻」の早い方。
   */
  private async scheduleAlarm(): Promise<void> {
    if (this.finished) return;
    const now = Date.now();
    const candidates = [this.clock.turnStartedAt + this.clock.remaining[this.state.turn]];
    for (const color of ['sente', 'gote'] as const) {
      const since = this.seats[color].disconnectedAt;
      if (since !== null) candidates.push(since + DISCONNECT_GRACE_MS);
    }
    await this.ctx.storage.setAlarm(Math.max(now + 1_000, Math.min(...candidates)));
  }

  private async save(): Promise<void> {
    if (!this.setup) return;
    await this.ctx.storage.put('match', {
      setup: this.setup,
      moves: this.moves,
      remaining: { ...this.clock.remaining },
      finished: this.finished,
    });
  }

  private async endGame(result: GameState['result']): Promise<void> {
    if (this.finished || !this.setup) return;
    this.finished = true;
    await this.ctx.storage.deleteAlarm();

    const summary = await finishMatch(this.env, {
      matchId: this.setup.matchId,
      players: this.setup.players,
      result,
      moves: this.moves,
      maxChain: this.state.maxChainCount,
    });

    await this.save();
    this.broadcast({
      type: 'over',
      result,
      ratingDelta: summary.ratingDelta,
      newRating: summary.newRating,
    });
  }

  private broadcast(message: MatchServerMessage): void {
    for (const color of ['sente', 'gote'] as const) this.sendTo(color, message);
  }

  private sendTo(color: Color, message: MatchServerMessage): void {
    const socket = this.seats[color].socket;
    if (socket) send(socket, message);
  }
}

function send(socket: WebSocket, message: MatchServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* もう閉じている */
  }
}

/** 棋譜から局面を作り直す。DO が眠って起きたときに使う。 */
function replay(moves: readonly string[]): GameState {
  let state = initialGameState();
  for (const text of moves) {
    // 保存した棋譜は既に検証済みなので、そのまま流す
    state = applyMoveWithDetail(state, parseMove(text)).state;
  }
  return state;
}

