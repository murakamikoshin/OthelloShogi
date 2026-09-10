/**
 * オンライン対戦のクライアント。
 *
 * サーバとのやりとりだけを受け持ち、ルール判定はしない。
 * 盤面はサーバから届いた棋譜を /src/core に流し込んで作る（サーバと同じ結果になる）。
 */
import type { Color, GameState, Move } from '../core/index.ts';
import { applyMoveWithDetail, initialGameState, parseMove } from '../core/index.ts';
import type {
  ClockState,
  LobbyServerMessage,
  MatchServerMessage,
  PlayerInfo,
} from '../../worker/protocol.ts';

const IDENTITY_KEY = 'negaeri:identity';

export interface Identity {
  readonly id: string;
  readonly name: string;
  readonly token: string;
}

export interface OnlineHandlers {
  /** マッチング待ちの状況 */
  onSearching(range: number, waitedMs: number): void;
  /** 対局が始まった */
  onStart(you: Color, players: Readonly<Record<Color, PlayerInfo>>): void;
  /** 局面が進んだ（自分の手も相手の手もここに来る） */
  onState(state: GameState, clock: ClockState, lastMove: Move | null, chainCount: number): void;
  onOpponentLeft(graceMs: number): void;
  onOpponentBack(): void;
  onOver(message: Extract<MatchServerMessage, { type: 'over' }>): void;
  onError(message: string): void;
}

/** サーバの場所。同じドメインに置くなら空文字でよい。 */
function apiBase(): string {
  const configured = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';
  return configured.replace(/\/$/, '');
}

function socketUrl(path: string): string {
  const base = apiBase();
  if (base !== '') return `${base.replace(/^http/, 'ws')}${path}`;
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${protocol}://${location.host}${path}`;
}

/** localStorage に保存した本人確認情報。無ければサーバに作ってもらう。 */
export async function loadIdentity(): Promise<Identity> {
  const saved = window.localStorage.getItem(IDENTITY_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as Identity;
      if (parsed.id && parsed.token) return parsed;
    } catch {
      /* 壊れていたら作り直す */
    }
  }

  const response = await fetch(`${apiBase()}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '' }),
  });
  if (!response.ok) throw new Error('プレイヤー登録に失敗しました');
  const created = (await response.json()) as Identity;
  window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(created));
  return created;
}

/** 名前を変える。 */
export async function renameSelf(identity: Identity, name: string): Promise<Identity> {
  const response = await fetch(`${apiBase()}/api/players/me/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identity.token}` },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error('名前を変更できませんでした');
  const { name: saved } = (await response.json()) as { name: string };
  const updated: Identity = { ...identity, name: saved };
  window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(updated));
  return updated;
}

export interface MyStats {
  readonly id: string;
  readonly name: string;
  readonly rating: number;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly best_chain: number;
  /** ランキングに載る条件を満たしていなければ null */
  readonly rank: number | null;
}

/** 自分の成績と順位。 */
export async function fetchMe(identity: Identity): Promise<MyStats> {
  const response = await fetch(`${apiBase()}/api/players/me`, {
    headers: { Authorization: `Bearer ${identity.token}` },
  });
  if (!response.ok) throw new Error('成績を取得できませんでした');
  return (await response.json()) as MyStats;
}

export async function fetchRanking(): Promise<unknown> {
  const response = await fetch(`${apiBase()}/api/ranking`);
  if (!response.ok) throw new Error('ランキングを取得できませんでした');
  return response.json();
}

/**
 * マッチングから対局終了までを受け持つ。
 */
export class OnlineSession {
  private lobby: WebSocket | null = null;
  private match: WebSocket | null = null;
  private state: GameState = initialGameState();
  private you: Color = 'sente';
  private closedByUs = false;
  /** 再接続の待ち時間（つながるたびに元に戻す） */
  private retryMs = 1_000;
  private matchId: string | null = null;

  constructor(
    private readonly identity: Identity,
    private readonly handlers: OnlineHandlers,
  ) {}

  get myColor(): Color {
    return this.you;
  }

  get currentState(): GameState {
    return this.state;
  }

  /** マッチングの行列に並ぶ。 */
  start(): void {
    this.closedByUs = false;
    const socket = new WebSocket(socketUrl('/api/lobby'));
    this.lobby = socket;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ type: 'queue', token: this.identity.token }));
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as LobbyServerMessage;
      switch (message.type) {
        case 'searching':
          this.handlers.onSearching(message.range, message.waitedMs);
          return;
        case 'matched':
          this.lobby = null;
          this.joinMatch(message.matchId);
          return;
        case 'error':
          this.handlers.onError(message.message);
          return;
        default:
          return;
      }
    });
    socket.addEventListener('error', () => {
      if (!this.closedByUs) this.handlers.onError('サーバにつながりませんでした');
    });
  }

  /** マッチングをやめる。対局中なら投了する。 */
  stop(): void {
    this.closedByUs = true;
    if (this.lobby) {
      try {
        this.lobby.send(JSON.stringify({ type: 'cancel' }));
      } catch {
        /* すでに閉じている */
      }
      this.lobby.close();
      this.lobby = null;
    }
    this.match?.close();
    this.match = null;
  }

  resign(): void {
    this.send({ type: 'resign' });
  }

  sendMove(move: Move): void {
    this.send({ type: 'move', move });
  }

  private send(payload: unknown): void {
    if (this.match?.readyState !== WebSocket.OPEN) return;
    this.match.send(JSON.stringify(payload));
  }

  private joinMatch(matchId: string): void {
    this.matchId = matchId;
    const socket = new WebSocket(socketUrl(`/api/match/${matchId}`));
    this.match = socket;

    socket.addEventListener('open', () => {
      this.retryMs = 1_000;
      socket.send(JSON.stringify({ type: 'join', token: this.identity.token }));
    });

    socket.addEventListener('message', (event) => {
      this.onMatchMessage(JSON.parse(String(event.data)) as MatchServerMessage);
    });

    // 通信が切れたら、サーバの猶予（30秒）のうちに戻れるよう自動で入り直す
    socket.addEventListener('close', () => {
      if (this.closedByUs || this.match !== socket) return;
      this.handlers.onError('接続が切れました。つなぎ直しています…');
      window.setTimeout(() => {
        if (!this.closedByUs && this.matchId) this.joinMatch(this.matchId);
      }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 8_000);
    });
  }

  private onMatchMessage(message: MatchServerMessage): void {
    switch (message.type) {
      case 'sync': {
        this.you = message.you;
        // サーバの棋譜から局面を作り直す。ルール判定はこちらでもサーバでも同じ
        this.state = replay(message.moves);
        this.handlers.onStart(message.you, message.players);
        this.handlers.onState(this.state, message.clock, null, 0);
        return;
      }
      case 'moved': {
        const move = parseMove(message.move);
        this.state = applyMoveWithDetail(this.state, move).state;
        this.handlers.onState(this.state, message.clock, move, message.chainCount);
        return;
      }
      case 'opponentLeft':
        this.handlers.onOpponentLeft(message.graceMs);
        return;
      case 'opponentBack':
        this.handlers.onOpponentBack();
        return;
      case 'over':
        this.closedByUs = true;
        this.handlers.onOver(message);
        return;
      case 'error':
        this.handlers.onError(message.message);
        return;
      default:
        return;
    }
  }
}

function replay(moves: readonly string[]): GameState {
  let state = initialGameState();
  for (const text of moves) {
    state = applyMoveWithDetail(state, parseMove(text)).state;
  }
  return state;
}
