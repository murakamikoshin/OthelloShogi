/**
 * リポジトリに置いてあるサンプル棋譜が、最後まで合法手として通ることを保証するテスト。
 * （CLI から棋譜を流し込む動作確認を自動化したもの）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMoveWithDetail, initialGameState, parseKifu } from './index.ts';
import { countPieces } from './board.ts';
import { pieceOn } from './test-helpers.ts';
import type { GameState, Pos } from './types.ts';

const SAMPLE = new URL('../../kifu/sample.kifu', import.meta.url);

describe('サンプル棋譜', () => {
  it('全ての手が合法で、想定どおりの最終局面になる', () => {
    const moves = parseKifu(readFileSync(SAMPLE, 'utf8'));
    expect(moves).toHaveLength(7);

    let state: GameState = initialGameState();
    const allFlips: Pos[] = [];
    let captures = 0;

    for (const move of moves) {
      const outcome = applyMoveWithDetail(state, move);
      state = outcome.state;
      allFlips.push(...outcome.flips);
      if (outcome.captured) captures += 1;
    }

    // 5手目の飛打ちで1枚だけ反転する
    expect(allFlips).toHaveLength(1);
    expect(allFlips[0]).toEqual({ row: 2, col: 3 });

    // 6手目・7手目で駒を取り合う
    expect(captures).toBe(2);

    // 反転で手に入れた「と金」が r3c3 まで進んでいる
    expect(pieceOn(state.board, 3, 3)).toEqual({ type: '+P', owner: 'sente' });
    // 取った成駒ではない飛が後手の持ち駒に入っている（成りは解ける）
    expect(state.hands.gote.R).toBe(2);
    expect(state.hands.sente.B).toBe(2);

    expect(countPieces(state.board)).toEqual({ sente: 4, gote: 1 });
    expect(state.ply).toBe(7);
    expect(state.turn).toBe('gote');
    expect(state.result.kind).toBe('playing');
  });
});
