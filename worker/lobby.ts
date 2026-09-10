/**
 * マッチング。ロビー用の Durable Object 1個で待ち行列を持つ。
 *
 * レート差 ±100 から探し始め、10秒ごとに ±100 ずつ緩める。
 * 待たせすぎないためと、実力が近い相手と当たるようにするための折衷。
 */
import type { Color } from '../src/core/index.ts';
import { verifyToken } from './auth.ts';
import { INITIAL_RATING } from './rating.ts';
import type { LobbyClientMessage, LobbyServerMessage, PlayerInfo } from './protocol.ts';
import type { Env } from './env.ts';

/** 最初に探すレート差。 */
export const INITIAL_RANGE = 100;
/** 何ミリ秒ごとに */
export const WIDEN_EVERY_MS = 10_000;
/** どれだけ緩めるか */
export const WIDEN_BY = 100;

/** 待っている人の情報。 */
export interface Waiting {
  readonly player: PlayerInfo;
  readonly since: number;
}

/** 経過時間から、いま許すレート差を求める。 */
export function allowedRange(waitedMs: number): number {
  return INITIAL_RANGE + Math.floor(waitedMs / WIDEN_EVERY_MS) * WIDEN_BY;
}

/**
 * 2人が今この瞬間に組めるか。
 * どちらか一方でも「自分の許すレート差」に収まっていれば組む
 * （長く待っている側の条件を優先する）。
 */
export function canPair(a: Waiting, b: Waiting, now: number): boolean {
  const diff = Math.abs(a.player.rating - b.player.rating);
  return (
    diff <= allowedRange(now - a.since) || diff <= allowedRange(now - b.since)
  );
}

/**
 * 待ち行列から組めるペアを1つ探す。
 * 長く待っている人から順に見て、いちばんレートが近い相手と組む。
 */
export function findPair(
  queue: readonly Waiting[],
  now: number,
): readonly [Waiting, Waiting] | null {
  const byWait = [...queue].sort((x, y) => x.since - y.since);
  for (let i = 0; i < byWait.length; i += 1) {
    const a = byWait[i];
    if (!a) continue;
    let best: Waiting | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let j = i + 1; j < byWait.length; j += 1) {
      const b = byWait[j];
      if (!b || !canPair(a, b, now)) continue;
      const diff = Math.abs(a.player.rating - b.player.rating);
      if (diff < bestDiff) {
        best = b;
        bestDiff = diff;
      }
    }
    if (best) return [a, best];
  }
  return null;
}

/** 先後を決める。レートが低い側を先手にする（先手に歩1枚のハンデがあるため）。 */
export function assignColors(
  a: Waiting,
  b: Waiting,
): Readonly<Record<Color, PlayerInfo>> {
  return a.player.rating <= b.player.rating
    ? { sente: a.player, gote: b.player }
    : { sente: b.player, gote: a.player };
}

interface Entry extends Waiting {
  readonly socket: WebSocket;
}

export class Lobby implements DurableObject {
  private entries: Entry[] = [];
  private ticking = false;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return Response.json({ waiting: this.entries.length });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    server.addEventListener('message', (event) => {
      void this.onMessage(server, event.data);
    });
    const drop = (): void => this.remove(server);
    server.addEventListener('close', drop);
    server.addEventListener('error', drop);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** 定期的に見に来て、待ち時間が延びたぶんレート差を緩めて組み直す。 */
  async alarm(): Promise<void> {
    this.ticking = false;
    await this.tryPair();
    this.notifyWaiting();
    await this.scheduleTick();
  }

  private async onMessage(socket: WebSocket, raw: unknown): Promise<void> {
    let message: LobbyClientMessage;
    try {
      message = JSON.parse(String(raw)) as LobbyClientMessage;
    } catch {
      send(socket, { type: 'error', message: '読めないメッセージです' });
      return;
    }

    if (message.type === 'cancel') {
      this.remove(socket);
      socket.close(1000, 'マッチングをやめました');
      return;
    }
    if (message.type !== 'queue') return;

    const playerId = await verifyToken(message.token, this.env.TOKEN_SECRET);
    if (!playerId) {
      send(socket, { type: 'error', message: '認証できませんでした' });
      socket.close();
      return;
    }

    const row = await this.env.DB.prepare('SELECT id, name, rating FROM players WHERE id = ?')
      .bind(playerId)
      .first<PlayerInfo>();
    const player: PlayerInfo = row ?? {
      id: playerId,
      name: '名無し',
      rating: INITIAL_RATING,
    };

    // 同じ人が二重に並ばないようにする
    this.entries = this.entries.filter((entry) => entry.player.id !== playerId);
    this.entries.push({ player, since: Date.now(), socket });

    send(socket, { type: 'queued', rating: player.rating, waiting: this.entries.length });
    await this.tryPair();
    await this.scheduleTick();
  }

  private remove(socket: WebSocket): void {
    this.entries = this.entries.filter((entry) => entry.socket !== socket);
  }

  private async tryPair(): Promise<void> {
    const now = Date.now();
    for (;;) {
      const pair = findPair(this.entries, now);
      if (!pair) return;
      const [a, b] = pair;
      this.entries = this.entries.filter((entry) => entry !== a && entry !== b);
      await this.startMatch(a as Entry, b as Entry);
    }
  }

  private async startMatch(a: Entry, b: Entry): Promise<void> {
    const players = assignColors(a, b);
    const matchId = crypto.randomUUID();
    const stub = this.env.MATCH.get(this.env.MATCH.idFromName(matchId));

    await stub.fetch('https://match/create', {
      method: 'POST',
      body: JSON.stringify({ matchId, players }),
      headers: { 'Content-Type': 'application/json' },
    });

    for (const entry of [a, b]) {
      const color: Color = players.sente.id === entry.player.id ? 'sente' : 'gote';
      send(entry.socket, { type: 'matched', matchId, color });
      // 対局用の WebSocket につなぎ直してもらう
      entry.socket.close(1000, '対局が決まりました');
    }
  }

  private notifyWaiting(): void {
    const now = Date.now();
    for (const entry of this.entries) {
      const waitedMs = now - entry.since;
      send(entry.socket, {
        type: 'searching',
        range: allowedRange(waitedMs),
        waitedMs,
      });
    }
  }

  private async scheduleTick(): Promise<void> {
    if (this.ticking || this.entries.length === 0) return;
    this.ticking = true;
    await this.ctx.storage.setAlarm(Date.now() + 2_000);
  }
}

function send(socket: WebSocket, message: LobbyServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    /* もう閉じている */
  }
}
