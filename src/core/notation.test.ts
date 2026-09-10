/**
 * 棋譜表記のテスト。
 */
import { describe, expect, it } from 'vitest';
import { formatMove, parseKifu, parseMove } from './notation.ts';
import { applyMove, initialGameState } from './game.ts';
import { pieceOn } from './test-helpers.ts';
import { countPieces } from './board.ts';
import { INITIAL_HANDS } from './rules.ts';

describe('1手の読み書き', () => {
  it('打つ手', () => {
    expect(parseMove('P*13')).toEqual({ kind: 'drop', piece: 'P', to: { row: 1, col: 3 } });
    expect(formatMove({ kind: 'drop', piece: 'B', to: { row: 4, col: 0 } })).toBe('B*40');
  });

  it('動かす手', () => {
    expect(parseMove('42-32')).toEqual({
      kind: 'move',
      from: { row: 4, col: 2 },
      to: { row: 3, col: 2 },
    });
    expect(formatMove({ kind: 'move', from: { row: 0, col: 0 }, to: { row: 5, col: 5 } })).toBe(
      '00-55',
    );
  });

  it('パス', () => {
    expect(parseMove('pass')).toEqual({ kind: 'pass' });
    expect(formatMove({ kind: 'pass' })).toBe('pass');
  });

  it('読めない表記は例外', () => {
    expect(() => parseMove('K*11')).toThrow();
    expect(() => parseMove('99-11')).toThrow();
    expect(() => parseMove('あいうえお')).toThrow();
  });
});

describe('棋譜の読み込み', () => {
  it('コメントと空行を無視する', () => {
    const moves = parseKifu(`
      # 先手の初手
      P*32
      42-32   # ここはコメント

      pass
    `);
    expect(moves.map(formatMove)).toEqual(['P*32', '42-32', 'pass']);
  });

  it('初期局面に棋譜を流し込むと正しく進む', () => {
    const kifu = parseKifu(`
      B*33    # 先手が角を打つ
      13-23   # 後手が歩を進める
      42-32   # 先手が歩を進める
    `);
    const start = initialGameState();
    const finalState = kifu.reduce(applyMove, start);

    expect(pieceOn(finalState.board, 3, 3)).toEqual({ type: 'B', owner: 'sente' });
    expect(pieceOn(finalState.board, 2, 3)).toEqual({ type: 'P', owner: 'gote' });
    expect(pieceOn(finalState.board, 3, 2)).toEqual({ type: 'P', owner: 'sente' });
    expect(finalState.hands.sente.B).toBe(INITIAL_HANDS.sente.B - 1);

    // 打った角のぶんだけ先手が1枚増え、取り合いは起きていない
    const before = countPieces(start.board);
    expect(countPieces(finalState.board)).toEqual({
      sente: before.sente + 1,
      gote: before.gote,
    });
    expect(finalState.ply).toBe(3);
    expect(finalState.turn).toBe('gote');
  });
});
