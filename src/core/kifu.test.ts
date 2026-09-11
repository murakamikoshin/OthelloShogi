/**
 * リポジトリに置いてあるサンプル棋譜が、最後まで合法手として通ることを保証するテスト。
 * （CLI から棋譜を流し込む動作確認を自動化したもの）
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyMoveWithDetail, initialGameState, parseKifu } from './index.ts';
import { pieceOn } from './test-helpers.ts';
import type { GameState } from './types.ts';

const SAMPLE = new URL('../../kifu/sample.kifu', import.meta.url);
const CHAIN = new URL('../../kifu/chain.kifu', import.meta.url);

/** 棋譜を最後まで流し込み、途中で起きたことをまとめて返す。 */
function replay(url: URL) {
  const moves = parseKifu(readFileSync(url, 'utf8'));
  let state: GameState = initialGameState();
  let flips = 0;
  let captures = 0;
  let bestChain = 0;

  moves.forEach((move, index) => {
    const outcome = applyMoveWithDetail(state, move);
    flips += outcome.flips.length;
    if (outcome.captured) captures += 1;
    bestChain = Math.max(bestChain, outcome.chainCount);
    state = outcome.state;
    // 途中で決着したのに手が残っていたら棋譜が壊れている
    if (state.result.kind !== 'playing' && index < moves.length - 1) {
      throw new Error(`${index + 1} 手目で決着したのに棋譜が続いています`);
    }
  });

  return { moves, state, flips, captures, bestChain };
}

describe('サンプル棋譜（AI 同士の実戦1局）', () => {
  it('全ての手が合法で、玉を取って決着する', () => {
    const { state, flips, captures, bestChain } = replay(SAMPLE);

    expect(state.result).toEqual({ kind: 'win', winner: 'sente', reason: 'king_captured' });
    // 取り合いと寝返りの両方が起きる棋譜であること
    expect(captures).toBeGreaterThanOrEqual(5);
    expect(flips).toBeGreaterThanOrEqual(30);
    expect(bestChain).toBeGreaterThanOrEqual(3);
  });
});

describe('連鎖デモ棋譜', () => {
  it('最後の1手で3連鎖が起き、最大連鎖数が記録される', () => {
    const { moves, state, bestChain } = replay(CHAIN);

    expect(moves).toHaveLength(12);
    expect(bestChain).toBe(3);
    expect(state.maxChainCount.gote).toBe(3);
    // 寝返った駒は相手のものになり、成っている
    expect(pieceOn(state.board, 2, 2)).toEqual({ type: '+P', owner: 'gote' });
    expect(state.result.kind).toBe('playing');
  });
});
