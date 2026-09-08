/**
 * テスト用のヘルパー。ルール本体ではない。
 */
import type { Board, Color, Hand, Hands, Piece, Pos } from './types.ts';
import { parseBoardDiagram, pieceAt } from './board.ts';
import { createGameState } from './game.ts';
import type { GameState } from './types.ts';

/** 6行のテキスト図から盤を作る。大文字=先手 小文字=後手 '.'=空 '+'=成駒 */
export function board(...rows: string[]): Board {
  return parseBoardDiagram(rows);
}

export function hand(P = 0, R = 0, B = 0): Hand {
  return { P, R, B };
}

export function hands(sente: Hand = hand(), gote: Hand = hand()): Hands {
  return { sente, gote };
}

export function at(row: number, col: number): Pos {
  return { row, col };
}

/** テスト用の局面を作る。 */
export function state(params: {
  board: Board;
  hands?: Hands;
  turn?: Color;
}): GameState {
  return createGameState(params);
}

/** そのマスの駒を取り出す（無ければテストを落とすために例外）。 */
export function pieceOn(b: Board, row: number, col: number): Piece {
  const piece = pieceAt(b, at(row, col));
  if (!piece) throw new Error(`r${row}c${col} は空マスです`);
  return piece;
}

/** Pos 配列を比較しやすい文字列集合にする。 */
export function posSet(positions: readonly Pos[]): string[] {
  return positions.map((p) => `${p.row}${p.col}`).sort();
}
