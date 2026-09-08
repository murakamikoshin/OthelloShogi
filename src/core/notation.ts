/**
 * 棋譜のテキスト表記。
 *
 * 表記ルール（row と col は 0〜5、必ず「row → col」の順）:
 *   打つ    P*13   … 歩を row1 col3 に打つ（P=歩 R=飛 B=角）
 *   動かす  42-32  … row4 col2 の駒を row3 col2 に動かす
 *   パス    pass
 *
 * '#' 以降は行コメント。空行は無視。
 */
import type { DroppablePieceType, Move, Pos } from './types.ts';
import { BOARD_SIZE } from './rules.ts';

/** 盤の広さから座標1桁ぶんのパターンを作る（BOARD_SIZE を変えても追従する）。 */
const DIGIT = `[0-${BOARD_SIZE - 1}]`;
const DROP_RE = new RegExp(`^([PRB])\\*(${DIGIT})(${DIGIT})$`, 'i');
const MOVE_RE = new RegExp(`^(${DIGIT})(${DIGIT})-(${DIGIT})(${DIGIT})$`);

function toDigit(text: string): number {
  const value = Number.parseInt(text, 10);
  if (!Number.isInteger(value) || value < 0 || value >= BOARD_SIZE) {
    throw new Error(`座標は 0〜${BOARD_SIZE - 1} の範囲です: "${text}"`);
  }
  return value;
}

/** 1手を表すテキストを Move に変換する。 */
export function parseMove(text: string): Move {
  const token = text.trim();
  if (token === '') throw new Error('空の手は読み込めません');
  if (token.toLowerCase() === 'pass') return { kind: 'pass' };

  const drop = DROP_RE.exec(token);
  if (drop) {
    const [, letter, row, col] = drop as unknown as [string, string, string, string];
    return {
      kind: 'drop',
      piece: letter.toUpperCase() as DroppablePieceType,
      to: { row: toDigit(row), col: toDigit(col) },
    };
  }

  const move = MOVE_RE.exec(token);
  if (move) {
    const [, fromRow, fromCol, toRow, toCol] = move as unknown as [
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      kind: 'move',
      from: { row: toDigit(fromRow), col: toDigit(fromCol) },
      to: { row: toDigit(toRow), col: toDigit(toCol) },
    };
  }

  throw new Error(`読み取れない手です: "${token}"（例: P*13 / 42-32 / pass）`);
}

/** Move をテキストに変換する。 */
export function formatMove(move: Move): string {
  switch (move.kind) {
    case 'pass':
      return 'pass';
    case 'drop':
      return `${move.piece}*${move.to.row}${move.to.col}`;
    case 'move':
      return `${move.from.row}${move.from.col}-${move.to.row}${move.to.col}`;
    default: {
      const never: never = move;
      throw new Error(`未知の手: ${JSON.stringify(never)}`);
    }
  }
}

/** 座標を "r3c4" のような読みやすい形にする。 */
export function formatPos(pos: Pos): string {
  return `r${pos.row}c${pos.col}`;
}

/**
 * 棋譜テキスト（複数行 or スペース区切り）を Move の配列にする。
 * '#' 以降は行コメント。
 */
export function parseKifu(text: string): Move[] {
  return text
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      return hash >= 0 ? line.slice(0, hash) : line;
    })
    .flatMap((line) => line.trim().split(/\s+/))
    .filter((token) => token !== '')
    .map(parseMove);
}
