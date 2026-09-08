/**
 * オセロ将棋 ルールエンジン - 型定義
 *
 * このディレクトリ (/src/core) は「ルールの唯一の正」です。
 * DOM / fetch / Worker API を一切参照しません。クライアントとサーバの両方から import されます。
 */

/** 盤の一辺のマス数（6x6）。 */
export const BOARD_SIZE = 6;

/** 盤のマス総数。 */
export const SQUARE_COUNT = BOARD_SIZE * BOARD_SIZE;

/** 手番の色。sente = 先手（row 5 側）、gote = 後手（row 0 側）。 */
export type Color = 'sente' | 'gote';

/** 成っていない駒種。K=玉 P=歩 R=飛 B=角 */
export type BasePieceType = 'K' | 'P' | 'R' | 'B';

/** 成駒。+P=と +R=竜 +B=馬 */
export type PromotedPieceType = '+P' | '+R' | '+B';

/** 盤上に存在しうる全ての駒種。 */
export type PieceType = BasePieceType | PromotedPieceType;

/** 持ち駒になりうる駒種（玉は持ち駒にならない）。 */
export type DroppablePieceType = 'P' | 'R' | 'B';

/** 盤上の駒。 */
export interface Piece {
  readonly type: PieceType;
  readonly owner: Color;
}

/** 1マスの内容。null は空マス。 */
export type Square = Piece | null;

/** 盤面。長さ SQUARE_COUNT の配列。index = row * BOARD_SIZE + col。 */
export type Board = readonly Square[];

/** 盤上の座標。row 0〜5（0 が後手側）、col 0〜5。 */
export interface Pos {
  readonly row: number;
  readonly col: number;
}

/** 片方の持ち駒の枚数。 */
export type Hand = Readonly<Record<DroppablePieceType, number>>;

/** 両者の持ち駒。 */
export type Hands = Readonly<Record<Color, Hand>>;

/** A. 打つ手（持ち駒を空マスに置く）。反転が発生しうる唯一の手。 */
export interface DropMove {
  readonly kind: 'drop';
  readonly piece: DroppablePieceType;
  readonly to: Pos;
}

/** B. 動かす手（盤上の自分の駒を将棋の動きで動かす）。反転しない。 */
export interface BoardMove {
  readonly kind: 'move';
  readonly from: Pos;
  readonly to: Pos;
}

/** 合法手が1つも無いときに限り選べる手。 */
export interface PassMove {
  readonly kind: 'pass';
}

export type Move = DropMove | BoardMove | PassMove;

/** 勝敗の理由。 */
export type WinReason =
  /** 玉を取った */
  | 'king_captured'
  /** 両者連続パス → 盤上の駒数が多い方の勝ち */
  | 'pass_count'
  /** 同一局面4回 → 盤上の駒数が多い方の勝ち */
  | 'repetition_count'
  /** 投了 */
  | 'resign'
  /** 時間切れ */
  | 'timeout'
  /** 反則（サーバ側の不正手検出） */
  | 'illegal_move';

/** 引き分けの理由（駒数が同数だったとき）。 */
export type DrawReason = 'pass_count' | 'repetition_count';

/** 対局の状態。 */
export type GameResult =
  | { readonly kind: 'playing' }
  | { readonly kind: 'win'; readonly winner: Color; readonly reason: WinReason }
  | { readonly kind: 'draw'; readonly reason: DrawReason };

/**
 * 局面。immutable。applyMove は必ず新しい GameState を返します。
 */
export interface GameState {
  readonly board: Board;
  readonly hands: Hands;
  readonly turn: Color;
  /** 何手目か（初期局面は 0）。 */
  readonly ply: number;
  /** 連続でパスされた回数。2 になったら駒数判定で決着。 */
  readonly consecutivePasses: number;
  /** 千日手検出用。局面キー → 出現回数。 */
  readonly repetition: Readonly<Record<string, number>>;
  readonly result: GameResult;
}

/** applyMove の詳細な結果（UI のアニメーションや棋譜表示に使う）。 */
export interface MoveOutcome {
  readonly state: GameState;
  /** 反転したマス（打った手のときのみ発生しうる）。 */
  readonly flips: readonly Pos[];
  /** 移動で取った駒（取っていなければ null）。 */
  readonly captured: Piece | null;
}
