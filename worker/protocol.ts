/**
 * クライアントとサーバがやりとりするメッセージの形。
 * ここは UI 側からも import するので、サーバ専用の API を持ち込まないこと。
 */
import type { Color, GameResult, Move, Pos } from '../src/core/index.ts';

/** 持ち時間（フィッシャー方式）。 */
export const INITIAL_TIME_MS = 3 * 60 * 1000;
export const INCREMENT_MS = 5 * 1000;

/** 切断してから負けになるまでの猶予。 */
export const DISCONNECT_GRACE_MS = 30 * 1000;

export interface ClockState {
  readonly sente: number;
  readonly gote: number;
}

export interface PlayerInfo {
  readonly id: string;
  readonly name: string;
  readonly rating: number;
}

// ---------------------------------------------------------------------------
// ロビー（マッチング）
// ---------------------------------------------------------------------------

export type LobbyClientMessage =
  | { readonly type: 'queue'; readonly token: string }
  | { readonly type: 'cancel' };

export type LobbyServerMessage =
  | { readonly type: 'queued'; readonly rating: number; readonly waiting: number }
  | { readonly type: 'searching'; readonly range: number; readonly waitedMs: number }
  | { readonly type: 'matched'; readonly matchId: string; readonly color: Color }
  | { readonly type: 'error'; readonly message: string };

// ---------------------------------------------------------------------------
// 対局
// ---------------------------------------------------------------------------

export type MatchClientMessage =
  | { readonly type: 'join'; readonly token: string }
  | { readonly type: 'move'; readonly move: Move }
  | { readonly type: 'resign' };

export type MatchServerMessage =
  /** 入室時と再接続時に、いまの局面をまるごと送る */
  | {
      readonly type: 'sync';
      readonly you: Color;
      readonly players: Readonly<Record<Color, PlayerInfo>>;
      /** 初手からの棋譜。クライアントは自分でルールエンジンに流し込んで局面を作る */
      readonly moves: readonly string[];
      readonly clock: ClockState;
      readonly result: GameResult;
      readonly bothConnected: boolean;
    }
  /** 相手または自分の着手が確定した */
  | {
      readonly type: 'moved';
      readonly move: string;
      readonly by: Color;
      readonly flipSteps: readonly (readonly Pos[])[];
      readonly chainCount: number;
      readonly clock: ClockState;
    }
  | { readonly type: 'opponentLeft'; readonly graceMs: number }
  | { readonly type: 'opponentBack' }
  | {
      readonly type: 'over';
      readonly result: GameResult;
      readonly ratingDelta: Readonly<Record<Color, number>>;
      readonly newRating: Readonly<Record<Color, number>>;
    }
  | { readonly type: 'error'; readonly message: string };
