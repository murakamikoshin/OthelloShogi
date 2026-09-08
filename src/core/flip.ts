/**
 * 反転（オセロ部分）の判定。
 *
 * 反転が起きるのは「打つ」を選んだときだけ。「動かす」では絶対に反転しない。
 *
 * 打った駒の「利きの方向」にだけ挟み判定を行う:
 *   歩 → 前方1方向
 *   飛 → 縦横4方向
 *   角 → 斜め4方向
 *
 * 各方向へ外側に走査し `相手の駒が1枚以上連続 → その先に自分の駒` が成立したら、
 * 間の相手の駒を全部裏返す（オセロと同じ挟み判定）。
 *
 * 玉の扱い:
 *   - 相手の玉は絶対に反転しない。走査中に相手の玉に当たったらその方向は打ち切り。
 *   - 自分の玉は挟みの終端（アンカー）として機能する。
 */
import type { Board, Color, DroppablePieceType, Piece, Pos } from './types.ts';
import type { Dir } from './moves.ts';
import { forwardOf, isInside, promote } from './board.ts';
import { BOARD_SIZE } from './types.ts';

/**
 * 打った駒ごとの挟み判定の距離上限。
 * 現状は全て「距離無制限」（オセロと同じ）。
 * 仕様書 7 章のバランス調整でここを変える可能性があるので定数にしてある。
 */
export const DROP_FLIP_RANGE: Readonly<Record<DroppablePieceType, number>> = {
  P: Number.POSITIVE_INFINITY,
  R: Number.POSITIVE_INFINITY,
  B: Number.POSITIVE_INFINITY,
};

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

/** 打った駒の利きの方向。 */
export function dropFlipDirections(piece: DroppablePieceType, color: Color): readonly Dir[] {
  switch (piece) {
    case 'P':
      return [[forwardOf(color), 0]];
    case 'R':
      return ORTHOGONAL;
    case 'B':
      return DIAGONAL;
    default:
      return [];
  }
}

/**
 * 駒を `at` に打ったときに裏返るマスを全て返す。
 * 実際に盤を書き換えたりはしない（Phase 1 のプレビュー表示でもこれを使う）。
 *
 * @param board 打つ前の盤面
 * @param at    打つマス（空マスである前提）
 * @param piece 打つ駒種
 * @param color 打つ側の色
 */
export function computeFlips(
  board: Board,
  at: Pos,
  piece: DroppablePieceType,
  color: Color,
): Pos[] {
  const flips: Pos[] = [];
  const range = DROP_FLIP_RANGE[piece];

  for (const [dr, dc] of dropFlipDirections(piece, color)) {
    const line: Pos[] = [];
    let row = at.row + dr;
    let col = at.col + dc;
    let distance = 1;

    while (isInside(row, col) && distance <= range) {
      const square = board[row * BOARD_SIZE + col] ?? null;

      // 空マスに当たった → この方向は挟めていない
      if (!square) break;

      // 自分の駒に当たった → ここが挟みの終端。間の駒を裏返す。
      // （自分の玉もアンカーとして機能する）
      if (square.owner === color) {
        if (line.length > 0) flips.push(...line);
        break;
      }

      // 相手の玉に当たった → この方向は打ち切り（何も裏返らない）
      if (square.type === 'K') break;

      // 相手の駒 → 挟む候補に積んで先へ進む
      line.push({ row, col });
      row += dr;
      col += dc;
      distance += 1;
    }
  }

  return flips;
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
