/**
 * 反転（オセロ部分）と連鎖反転の判定。
 *
 * 反転が起きるのは「打つ」を選んだときだけ。「動かす」では絶対に反転しない。
 * この非対称性は意図的な設計。反転しても持ち駒は増えず、持ち駒は「動かして取る」
 * ことでしか手に入らないため、`取る → 打つ → 連鎖で支配する` という循環が成立する。
 *
 * ■ 1段目
 *   打った駒の「利きの方向」にだけ挟み判定を行う。
 *     歩 → 前方1方向 / 飛 → 縦横4方向 / 角 → 斜め4方向
 *   各方向へ外側に走査し `相手の駒が1枚以上連続 → その先に自分の駒` が成立したら、
 *   間の相手の駒を全部裏返す（オセロと同じ挟み判定）。
 *
 * ■ 2段目以降（連鎖反転）
 *   反転した駒は成る（歩→と、飛→竜、角→馬）。成った駒は新しい利きを持つので、
 *   その駒を起点にさらに挟みが成立することがある。これを反転が止まるまで繰り返す。
 *
 *   絶対に守る制約:
 *     - 同一の駒は1手番中に2回以上反転しない（無限ループ防止の生命線）
 *     - 各段の反転は「同時解決」。1枚ずつ順番に処理してはいけない
 *       （処理順で結果が変わるとサーバとクライアントで盤面が食い違う）
 *     - 判定に使うのは「成った後」の利き
 *     - 玉は連鎖の対象外。反転もしないし連鎖の起点にもならない
 *     - 段数の上限は rules.ts の MAX_CHAIN
 */
import type { Board, Color, Piece, PieceType, Pos } from './types.ts';
import type { Dir } from './moves.ts';
import { isInside, posOf, promote } from './board.ts';
import { slideDirs, stepDirs } from './moves.ts';
import type { FlipDirectionMode } from './rules.ts';
import {
  BOARD_SIZE,
  FLIP_DIRECTION_MODE,
  KING_GUARDS_NEIGHBORS,
  MAX_CHAIN,
  PROMOTE_DROP_AT,
  SLIDE_FLIP_RANGE,
  STEP_FLIP_RANGE,
  WALL_ANCHORS,
} from './rules.ts';

const ORTHOGONAL: readonly Dir[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const DIAGONAL: readonly Dir[] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const ALL_EIGHT: readonly Dir[] = [...ORTHOGONAL, ...DIAGONAL];

/** FLIP_DIRECTION_MODE によって、利きに上乗せする方向。 */
function extraDirs(mode: FlipDirectionMode): readonly Dir[] {
  switch (mode) {
    case 'wide':
      return ORTHOGONAL;
    case 'all8':
      return ALL_EIGHT;
    case 'attack':
    default:
      return [];
  }
}

/** 挟み判定を行う1本の線。方向と、その方向に何マス先まで見るか。 */
export interface FlipRay {
  readonly dir: Dir;
  readonly range: number;
}

/** 挟み判定の距離設定。 */
export interface FlipRanges {
  /** 走る方向（飛・角・竜・馬の本来の走り）。 */
  readonly slide: number;
  /** 1マスだけ利く方向（歩の前・と金の6方向・竜の斜め・馬の縦横）。 */
  readonly step: number;
}

export const DEFAULT_FLIP_RANGES: FlipRanges = {
  slide: SLIDE_FLIP_RANGE,
  step: STEP_FLIP_RANGE,
};

/**
 * その駒が挟み判定に使う線を返す。
 *
 * 方向の集合は将棋の利きと同じ。距離は FlipRanges で決める
 * （既定は無制限＝オセロと同じ挟み判定）。玉は反転にも連鎖にも関与しない。
 */
export function flipRays(
  type: PieceType,
  color: Color,
  ranges: FlipRanges = DEFAULT_FLIP_RANGES,
  mode: FlipDirectionMode = FLIP_DIRECTION_MODE,
): FlipRay[] {
  if (type === 'K') return [];

  // 同じ方向が重複したときは先に入れた方（＝本来の利き）を残す。
  // そうしないと飛の「走る」距離が上乗せ分で潰れてしまう。
  const rays = new Map<string, FlipRay>();
  const add = (dir: Dir, range: number): void => {
    const key = `${dir[0]},${dir[1]}`;
    if (!rays.has(key)) rays.set(key, { dir, range });
  };

  for (const dir of stepDirs(type, color)) add(dir, ranges.step);
  for (const dir of slideDirs(type)) add(dir, ranges.slide);
  for (const dir of extraDirs(mode)) add(dir, ranges.step);

  return [...rays.values()];
}

/**
 * 1つの起点から1方向だけ挟み判定を行い、裏返るマスの index を返す。
 * 挟めていなければ空配列。
 */
function scanRay(
  board: Board,
  origin: Pos,
  ray: FlipRay,
  color: Color,
  kingGuards: boolean,
  wallAnchors: boolean,
): number[] {
  const [dr, dc] = ray.dir;
  const line: number[] = [];
  let row = origin.row + dr;
  let col = origin.col + dc;
  let distance = 1;

  while (distance <= ray.range) {
    if (!isInside(row, col)) {
      // 盤の外に出た。壁をアンカーとして認めるなら、ここが挟みの終端になる
      return wallAnchors ? line : [];
    }

    const index = row * BOARD_SIZE + col;
    const square = board[index] ?? null;

    // 空マス → この方向は挟めていない
    if (!square) return [];

    // 自分の駒 → ここが挟みの終端。自分の玉もアンカーとして機能する。
    if (square.owner === color) return line;

    // 相手の玉 → 経路を遮断。この方向は不成立。
    if (square.type === 'K') return [];

    // 相手の玉に隣接している駒は寝返らない。玉と同じく経路を遮断する。
    if (kingGuards && isKingGuarded(board, row, col, square.owner)) return [];

    line.push(index);
    row += dr;
    col += dc;
    distance += 1;
  }

  // 距離の上限まで行っても終端が無かった
  return [];
}

/**
 * 連鎖の1段ぶんを解決する。
 *
 * 複数の起点をまとめて受け取り、**全ての起点を同じ盤面に対して**判定してから
 * 裏返るマスを1つの集合にまとめる（同時解決）。起点を渡す順番を変えても
 * 結果は必ず同じになる。
 *
 * @param board     この段を始める時点の盤面
 * @param origins   この段の起点（1段目は打った駒、2段目以降は前の段で反転した駒）
 * @param color     打った側の色
 * @param alreadyFlipped この手番で既に反転したマスの index（2回目の反転を防ぐ）
 * @returns 裏返るマスの index。index の昇順（＝処理順に依存しない）。
 */
export function collectFlipStep(
  board: Board,
  origins: readonly Pos[],
  color: Color,
  alreadyFlipped: ReadonlySet<number> = new Set(),
  ranges: FlipRanges = DEFAULT_FLIP_RANGES,
  mode: FlipDirectionMode = FLIP_DIRECTION_MODE,
  kingGuards: boolean = KING_GUARDS_NEIGHBORS,
  wallAnchors: boolean = WALL_ANCHORS,
): number[] {
  const found = new Set<number>();

  for (const origin of origins) {
    const piece = board[origin.row * BOARD_SIZE + origin.col] ?? null;
    // 玉は連鎖の起点にならない
    if (!piece || piece.type === 'K' || piece.owner !== color) continue;

    for (const ray of flipRays(piece.type, piece.owner, ranges, mode)) {
      for (const index of scanRay(board, origin, ray, color, kingGuards, wallAnchors)) {
        // 同一の駒は1手番中に2回以上反転しない
        if (alreadyFlipped.has(index)) continue;
        found.add(index);
      }
    }
  }

  return [...found].sort((a, b) => a - b);
}

/**
 * その駒が「自分の玉に隣接していて寝返らない」状態か。
 * 玉のまわりを安定地帯にするためのルール（rules.ts の KING_GUARDS_NEIGHBORS）。
 */
export function isKingGuarded(board: Board, row: number, col: number, owner: Color): boolean {
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (!isInside(r, c)) continue;
      const square = board[r * BOARD_SIZE + c];
      if (square && square.type === 'K' && square.owner === owner) return true;
    }
  }
  return false;
}

/**
 * そのマスに打ったとき、1枚でも裏返る可能性があるか。
 *
 * 挟みは打ったマスから外側に走査するので、成立するには
 * **隣のマスに「玉ではない相手の駒」がある**ことが必ず必要
 * （空マスならその方向は打ち切り、自分の駒なら間に何も無い、相手の玉なら遮断）。
 *
 * 必要条件であって十分条件ではない。AI の探索や UI のバッジ計算で、
 * 明らかに無駄な挟み判定を省くための足切りに使う。
 */
export function mayFlipAt(board: Board, at: Pos, color: Color): boolean {
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const row = at.row + dr;
      const col = at.col + dc;
      if (!isInside(row, col)) continue;
      const square = board[row * BOARD_SIZE + col];
      if (square && square.owner !== color && square.type !== 'K') return true;
    }
  }
  return false;
}

/**
 * 反転後の駒を返す。
 * - 持ち主が打った側に変わる
 * - 同時に成る（歩→と、飛→竜、角→馬）
 * - すでに成駒なら成ったまま持ち主だけ変わる
 */
export function flipPiece(piece: Piece, newOwner: Color): Piece {
  return { type: promote(piece.type), owner: newOwner };
}

/** 連鎖反転の結果。 */
export interface ChainResult {
  /** 連鎖を全て解決したあとの盤面。 */
  readonly board: Board;
  /** 段ごとの反転マス。steps[0] が1段目。UI はこれを時間差でアニメーションさせる。 */
  readonly steps: readonly (readonly Pos[])[];
  /** 連鎖した段数（= steps.length）。1段だけ裏返った場合は 1。 */
  readonly chainCount: number;
  /** 全段をまとめた反転マス。 */
  readonly flips: readonly Pos[];
}

const NO_CHAIN: Omit<ChainResult, 'board'> = { steps: [], chainCount: 0, flips: [] };

export interface ChainOptions {
  readonly maxChain?: number;
  readonly ranges?: FlipRanges;
  readonly mode?: FlipDirectionMode;
  readonly kingGuards?: boolean;
  readonly wallAnchors?: boolean;
  /** 打った駒自身が成るのに必要な反転枚数。0 なら成らない */
  readonly promoteDropAt?: number;
}

/**
 * 打った駒を起点に、反転が止まるまで連鎖を解決する。
 *
 * @param board  打った駒を既に置いた状態の盤面
 * @param origin 打ったマス
 * @param color  打った側の色
 */
export function resolveChain(
  board: Board,
  origin: Pos,
  color: Color,
  options: ChainOptions = {},
): ChainResult {
  const maxChain = options.maxChain ?? MAX_CHAIN;
  const ranges = options.ranges ?? DEFAULT_FLIP_RANGES;
  const mode = options.mode ?? FLIP_DIRECTION_MODE;
  const kingGuards = options.kingGuards ?? KING_GUARDS_NEIGHBORS;
  const wallAnchors = options.wallAnchors ?? WALL_ANCHORS;

  const flippedThisTurn = new Set<number>();
  const steps: Pos[][] = [];
  let current = board;
  let origins: readonly Pos[] = [origin];
  let chainCount = 0;

  while (origins.length > 0 && chainCount < maxChain) {
    const newlyFlipped = collectFlipStep(
      current,
      origins,
      color,
      flippedThisTurn,
      ranges,
      mode,
      kingGuards,
      wallAnchors,
    );
    if (newlyFlipped.length === 0) break;

    // この段の反転は「同時に」適用する
    const next = current.slice();
    for (const index of newlyFlipped) {
      const target = next[index];
      if (!target) continue;
      next[index] = flipPiece(target, color);
      flippedThisTurn.add(index);
    }

    current = next;
    const positions = newlyFlipped.map(posOf);
    steps.push(positions);
    origins = positions;
    chainCount += 1;
  }

  return {
    board: current,
    steps,
    chainCount,
    flips: steps.flat(),
  };
}

/**
 * 盤を書き換えずに、その手を打ったら何が起きるかだけを調べる。
 * Phase 1 のプレビュー表示は「連鎖の最終結果まで」ここで求める。
 *
 * @param board 打つ前の盤面
 * @param at    打つマス（空マスである前提）
 */
export function simulateDrop(
  board: Board,
  at: Pos,
  piece: 'P' | 'R' | 'B',
  color: Color,
  options: ChainOptions = {},
): ChainResult {
  const index = at.row * BOARD_SIZE + at.col;
  if (board[index]) return { board, ...NO_CHAIN };

  const withDrop = board.slice();
  withDrop[index] = { type: piece, owner: color }; // 打った時点では不成

  // 隣に裏返せる相手の駒が1枚も無ければ、挟み判定をするまでもなく反転は起きない
  if (!mayFlipAt(board, at, color)) return { board: withDrop, ...NO_CHAIN };

  const chain = resolveChain(withDrop, at, color, options);

  // 大量に寝返らせた手柄で、打った駒自身も出世する
  const promoteAt = options.promoteDropAt ?? PROMOTE_DROP_AT;
  if (promoteAt > 0 && chain.flips.length >= promoteAt) {
    const promoted = chain.board.slice();
    promoted[index] = { type: promote(piece), owner: color };
    return { ...chain, board: promoted };
  }

  return chain;
}
