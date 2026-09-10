/**
 * 画面に出す文字列。Phase 4 の多言語対応では、ここを言語ファイルに差し替える。
 */
import type { Color, DrawReason, GameResult, PieceType, WinReason } from '../core/index.ts';

export const PIECE_KANJI: Record<PieceType, string> = {
  K: '玉',
  P: '歩',
  R: '飛',
  B: '角',
  '+P': 'と',
  '+R': '竜',
  '+B': '馬',
};

export const COLOR_NAME: Record<Color, string> = {
  sente: '先手',
  gote: '後手',
};

const WIN_REASON: Record<WinReason, string> = {
  king_captured: '玉を取った',
  pass_count: '両者パス → 盤上の駒数',
  repetition_count: '同一局面4回 → 盤上の駒数',
  resign: '投了',
  timeout: '時間切れ',
  illegal_move: '反則',
};

const DRAW_REASON: Record<DrawReason, string> = {
  pass_count: '両者パス → 駒数が同数',
  repetition_count: '同一局面4回 → 駒数が同数',
};

export function resultTitle(result: GameResult): string {
  if (result.kind === 'draw') return '引き分け';
  if (result.kind === 'win') return `${COLOR_NAME[result.winner]}の勝ち`;
  return '対局中';
}

export function resultReason(result: GameResult): string {
  if (result.kind === 'draw') return DRAW_REASON[result.reason];
  if (result.kind === 'win') return WIN_REASON[result.reason];
  return '';
}
