/**
 * 駒の動きと合法手生成。
 *
 * ルール上の注意:
 * - 移動による成りは無い（成る手段は反転のみ）。
 * - 二歩は採用しない。
 * - 歩を最終段に打つ・動かすことは禁止（行き所のない駒）。
 * - 王手放置は合法。詰み判定はしない。
 */
import type {
  Board,
  BoardMove,
  Color,
  DropMove,
  DroppablePieceType,
  Hands,
  Move,
  PieceType,
  Pos,
} from './types.ts';
import { BOARD_SIZE, SQUARE_COUNT } from './rules.ts';
import {
  findKing,
  forwardOf,
  indexOf,
  isInside,
  lastRankFor,
  pieceAt,
  posOf,
} from './board.ts';

/** 方向ベクトル [row の増分, col の増分]。 */
export type Dir = readonly [number, number];

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

/** 金（と金）の動き。前・斜め前・横・後ろの6方向1マス。 */
function goldDirs(color: Color): readonly Dir[] {
  const f = forwardOf(color);
  return [
    [f, 0],
    [f, -1],
    [f, 1],
    [0, -1],
    [0, 1],
    [-f, 0],
  ];
}

/** 1マスだけ動ける方向。 */
export function stepDirs(type: PieceType, color: Color): readonly Dir[] {
  switch (type) {
    case 'K':
      return ALL_EIGHT;
    case 'P':
      return [[forwardOf(color), 0]];
    case '+P':
      return goldDirs(color);
    case '+R':
      // 竜 = 飛 + 斜め1マス
      return DIAGONAL;
    case '+B':
      // 馬 = 角 + 縦横1マス
      return ORTHOGONAL;
    case 'R':
    case 'B':
      return [];
    default:
      return [];
  }
}

/** 距離無制限で走れる方向。 */
export function slideDirs(type: PieceType): readonly Dir[] {
  switch (type) {
    case 'R':
    case '+R':
      return ORTHOGONAL;
    case 'B':
    case '+B':
      return DIAGONAL;
    default:
      return [];
  }
}

/**
 * その駒が from から動ける全マス（盤上のルールのみ。王手放置は考慮しない）。
 * 自分の駒があるマスには行けない。相手の駒があるマスには行ける（取る）。
 */
export function destinationsFrom(board: Board, from: Pos): Pos[] {
  const piece = pieceAt(board, from);
  if (!piece) return [];
  const { type, owner } = piece;
  const result: Pos[] = [];

  const canLand = (row: number, col: number): boolean => {
    const target = board[row * BOARD_SIZE + col] ?? null;
    if (target && target.owner === owner) return false;
    // 歩は最終段に行けない（行き所のない駒）。移動による成りが無いため。
    if (type === 'P' && row === lastRankFor(owner)) return false;
    return true;
  };

  for (const [dr, dc] of stepDirs(type, owner)) {
    const row = from.row + dr;
    const col = from.col + dc;
    if (!isInside(row, col)) continue;
    if (canLand(row, col)) result.push({ row, col });
  }

  for (const [dr, dc] of slideDirs(type)) {
    let row = from.row + dr;
    let col = from.col + dc;
    while (isInside(row, col)) {
      const target = board[row * BOARD_SIZE + col] ?? null;
      if (target && target.owner === owner) break;
      if (canLand(row, col)) result.push({ row, col });
      // 駒に当たったらそこで止まる（取ったマスより先には進めない）。
      if (target) break;
      row += dr;
      col += dc;
    }
  }

  return result;
}

/** その持ち駒を打てる全マス。 */
export function dropDestinations(
  board: Board,
  color: Color,
  piece: DroppablePieceType,
): Pos[] {
  const result: Pos[] = [];
  for (let i = 0; i < SQUARE_COUNT; i += 1) {
    if (board[i]) continue;
    const pos = posOf(i);
    // 歩は最終段に打てない。二歩は採用しないので同じ筋の歩は数えない。
    if (piece === 'P' && pos.row === lastRankFor(color)) continue;
    result.push(pos);
  }
  return result;
}

/** 盤上の駒を動かす手を全て列挙。 */
export function generateBoardMoves(board: Board, color: Color): BoardMove[] {
  const moves: BoardMove[] = [];
  for (let i = 0; i < SQUARE_COUNT; i += 1) {
    const square = board[i];
    if (!square || square.owner !== color) continue;
    const from = posOf(i);
    for (const to of destinationsFrom(board, from)) {
      moves.push({ kind: 'move', from, to });
    }
  }
  return moves;
}

/** 持ち駒を打つ手を全て列挙。 */
export function generateDropMoves(board: Board, hands: Hands, color: Color): DropMove[] {
  const moves: DropMove[] = [];
  const hand = hands[color];
  const types: readonly DroppablePieceType[] = ['P', 'R', 'B'];
  for (const piece of types) {
    if (hand[piece] <= 0) continue;
    for (const to of dropDestinations(board, color, piece)) {
      moves.push({ kind: 'drop', piece, to });
    }
  }
  return moves;
}

/**
 * そのマスが、指定した色の駒に狙われているか。
 *
 * 王手の表示にも、AI の玉の安全度の評価にも使う。
 * このゲームは王手放置が合法なので「狙われている＝次に取られる」が直結する。
 */
export function isAttacked(board: Board, target: Pos, by: Color): boolean {
  const index = indexOf(target);
  for (let i = 0; i < SQUARE_COUNT; i += 1) {
    const square = board[i];
    if (!square || square.owner !== by) continue;
    for (const to of destinationsFrom(board, posOf(i))) {
      if (indexOf(to) === index) return true;
    }
  }
  return false;
}

/** その色の玉が狙われているか（王手がかかっているか）。玉がいなければ false。 */
export function isInCheck(board: Board, color: Color): boolean {
  const king = findKing(board, color);
  if (!king) return false;
  return isAttacked(board, king, color === 'sente' ? 'gote' : 'sente');
}

/**
 * 合法手を全て列挙（パスは含まない）。
 * 空配列が返ってきたら、その手番はパスするしかない。
 */
export function generateMoves(board: Board, hands: Hands, color: Color): Move[] {
  return [...generateDropMoves(board, hands, color), ...generateBoardMoves(board, color)];
}
