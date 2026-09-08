/**
 * 盤面の基本操作。純粋関数のみ。
 */
import type {
  Board,
  Color,
  DroppablePieceType,
  Hand,
  Hands,
  Piece,
  PieceType,
  Pos,
  Square,
} from './types.ts';
import { BOARD_SIZE, SQUARE_COUNT } from './types.ts';

/** 相手の色を返す。 */
export function opponentOf(color: Color): Color {
  return color === 'sente' ? 'gote' : 'sente';
}

/** 座標 → 配列 index。 */
export function indexOf(pos: Pos): number {
  return pos.row * BOARD_SIZE + pos.col;
}

/** 配列 index → 座標。 */
export function posOf(index: number): Pos {
  return { row: Math.floor(index / BOARD_SIZE), col: index % BOARD_SIZE };
}

/** 盤内かどうか。 */
export function isInside(row: number, col: number): boolean {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

export function isInsidePos(pos: Pos): boolean {
  return isInside(pos.row, pos.col);
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.row === b.row && a.col === b.col;
}

/** マスの中身を取得。盤外なら null。 */
export function pieceAt(board: Board, pos: Pos): Square {
  if (!isInsidePos(pos)) return null;
  return board[indexOf(pos)] ?? null;
}

/** 1マスだけ書き換えた新しい盤を返す（元の盤は変更しない）。 */
export function withPiece(board: Board, pos: Pos, piece: Square): Board {
  const next = board.slice();
  next[indexOf(pos)] = piece;
  return next;
}

/** 複数マスをまとめて書き換えた新しい盤を返す。 */
export function withPieces(board: Board, updates: readonly (readonly [Pos, Square])[]): Board {
  const next = board.slice();
  for (const [pos, piece] of updates) {
    next[indexOf(pos)] = piece;
  }
  return next;
}

/** 空の盤。 */
export function emptyBoard(): Board {
  return new Array<Square>(SQUARE_COUNT).fill(null);
}

// ---------------------------------------------------------------------------
// 駒種のユーティリティ
// ---------------------------------------------------------------------------

/** 成っているか。 */
export function isPromoted(type: PieceType): boolean {
  return type.startsWith('+');
}

/** 成った駒種を返す。玉と既に成っている駒はそのまま。 */
export function promote(type: PieceType): PieceType {
  switch (type) {
    case 'P':
      return '+P';
    case 'R':
      return '+R';
    case 'B':
      return '+B';
    default:
      // 玉は成らない。成駒はそのまま。
      return type;
  }
}

/** 成りを解いた駒種を返す（取って持ち駒にするときに使う）。 */
export function unpromote(type: PieceType): PieceType {
  switch (type) {
    case '+P':
      return 'P';
    case '+R':
      return 'R';
    case '+B':
      return 'B';
    default:
      return type;
  }
}

/** 持ち駒になりうる駒種か（玉以外）。 */
export function isDroppableType(type: PieceType): type is DroppablePieceType {
  return type === 'P' || type === 'R' || type === 'B';
}

/** その色の歩にとっての「最終段」（行き所のない駒になる段）。 */
export function lastRankFor(color: Color): number {
  return color === 'sente' ? 0 : BOARD_SIZE - 1;
}

/** その色にとっての前方（row の増分）。先手は row が減る方向。 */
export function forwardOf(color: Color): number {
  return color === 'sente' ? -1 : 1;
}

// ---------------------------------------------------------------------------
// 持ち駒
// ---------------------------------------------------------------------------

export function emptyHand(): Hand {
  return { P: 0, R: 0, B: 0 };
}

/** 持ち駒を1枚増やした新しい Hands を返す。 */
export function handWithAdded(hands: Hands, color: Color, type: DroppablePieceType): Hands {
  const hand = hands[color];
  return { ...hands, [color]: { ...hand, [type]: hand[type] + 1 } };
}

/** 持ち駒を1枚減らした新しい Hands を返す。 */
export function handWithRemoved(hands: Hands, color: Color, type: DroppablePieceType): Hands {
  const hand = hands[color];
  return { ...hands, [color]: { ...hand, [type]: hand[type] - 1 } };
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

/** 盤上の駒数を色ごとに数える（玉も含む）。 */
export function countPieces(board: Board): Record<Color, number> {
  let sente = 0;
  let gote = 0;
  for (const square of board) {
    if (!square) continue;
    if (square.owner === 'sente') sente += 1;
    else gote += 1;
  }
  return { sente, gote };
}

/** 指定した色の駒がある全マスを返す。 */
export function findPieces(board: Board, color: Color): Pos[] {
  const result: Pos[] = [];
  for (let i = 0; i < board.length; i += 1) {
    const square = board[i];
    if (square && square.owner === color) result.push(posOf(i));
  }
  return result;
}

/** 玉の位置を返す。取られていれば null。 */
export function findKing(board: Board, color: Color): Pos | null {
  for (let i = 0; i < board.length; i += 1) {
    const square = board[i];
    if (square && square.owner === color && square.type === 'K') return posOf(i);
  }
  return null;
}

// ---------------------------------------------------------------------------
// テキスト表現（テスト・CLI・千日手判定に使う）
// ---------------------------------------------------------------------------

const PIECE_LETTER: Record<PieceType, string> = {
  K: 'k',
  P: 'p',
  R: 'r',
  B: 'b',
  '+P': '+p',
  '+R': '+r',
  '+B': '+b',
};

/** 駒 → 1〜2文字のトークン。先手は大文字、後手は小文字。 */
export function pieceToToken(piece: Piece): string {
  const letter = PIECE_LETTER[piece.type];
  return piece.owner === 'sente' ? letter.toUpperCase() : letter;
}

/** トークン → 駒。'.' は空マス。 */
export function tokenToPiece(token: string): Square {
  if (token === '.' || token === '') return null;
  const promoted = token.startsWith('+');
  const letter = promoted ? token.slice(1) : token;
  if (letter.length !== 1) throw new Error(`不正な駒トークン: ${token}`);
  const owner: Color = letter === letter.toUpperCase() ? 'sente' : 'gote';
  const base = letter.toUpperCase();
  if (base !== 'K' && base !== 'P' && base !== 'R' && base !== 'B') {
    throw new Error(`不正な駒トークン: ${token}`);
  }
  if (promoted && base === 'K') throw new Error('玉は成れません');
  const type = (promoted ? `+${base}` : base) as PieceType;
  return { type, owner };
}

/**
 * テキスト図から盤を作る。テスト・デバッグ用。
 *
 *   parseBoardDiagram([
 *     '.  .  .  k  .  .',
 *     '.  .  .  p  .  .',
 *     ...
 *   ])
 *
 * 大文字 = 先手、小文字 = 後手、'.' = 空マス、'+' 付きは成駒。
 */
export function parseBoardDiagram(rows: readonly string[]): Board {
  if (rows.length !== BOARD_SIZE) {
    throw new Error(`盤は ${BOARD_SIZE} 行必要です（受け取った行数: ${rows.length}）`);
  }
  const board = emptyBoard().slice();
  rows.forEach((line, row) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== BOARD_SIZE) {
      throw new Error(`row ${row} は ${BOARD_SIZE} マス必要です: "${line}"`);
    }
    tokens.forEach((token, col) => {
      board[row * BOARD_SIZE + col] = tokenToPiece(token);
    });
  });
  return board;
}

/** 盤を1行のテキストにする（千日手判定のキーに使う）。 */
export function boardToString(board: Board): string {
  return board.map((square) => (square ? pieceToToken(square) : '.')).join(',');
}

/** 持ち駒を1行のテキストにする。 */
export function handsToString(hands: Hands): string {
  const one = (hand: Hand): string => `P${hand.P}R${hand.R}B${hand.B}`;
  return `S:${one(hands.sente)}/G:${one(hands.gote)}`;
}

/**
 * 千日手判定用の局面キー。
 * 「盤面 + 両者の持ち駒 + 手番」が一致したら同一局面とみなす。
 */
export function positionKey(board: Board, hands: Hands, turn: Color): string {
  return `${boardToString(board)}|${handsToString(hands)}|${turn}`;
}
