/**
 * 画面表示のための言い換え。文字列そのものは /src/i18n が持つ。
 */
import type { Color, GameResult, PieceType } from '../core/index.ts';
import { isJapanese, t } from '../i18n/index.ts';

/**
 * 駒の表記。日本語は漢字だけ。
 * それ以外の言語では、漢字の下に小さくローマ字を重ねる（CSS が data-roman を使う）。
 */
export const PIECE_ROMAN: Record<PieceType, string> = {
  K: 'K',
  P: 'P',
  R: 'R',
  B: 'B',
  '+P': '+P',
  '+R': '+R',
  '+B': '+B',
};

export function pieceKanji(type: PieceType): string {
  return t(`piece.${type}`);
}

/** 漢字の下に出すローマ字。日本語のときは出さない。 */
export function pieceRoman(type: PieceType): string | null {
  return isJapanese() ? null : PIECE_ROMAN[type];
}

export function colorName(color: Color): string {
  return t(`color.${color}`);
}

export function resultTitle(result: GameResult): string {
  if (result.kind === 'draw') return t('result.draw');
  if (result.kind === 'win') return t('result.win', { color: colorName(result.winner) });
  return t('result.playing');
}

export function resultReason(result: GameResult): string {
  if (result.kind === 'draw') return t(`reason.draw_${result.reason}`);
  if (result.kind === 'win') return t(`reason.${result.reason}`);
  return '';
}
