import { describe, expect, it } from 'vitest';
import { INITIAL_RATING, applyRating, expectedScore, kFactor, ratePair } from './rating.ts';

describe('K値', () => {
  it('対局数で切り替わる', () => {
    expect(kFactor(0)).toBe(40);
    expect(kFactor(29)).toBe(40);
    expect(kFactor(30)).toBe(20);
    expect(kFactor(99)).toBe(20);
    expect(kFactor(100)).toBe(10);
    expect(kFactor(1000)).toBe(10);
  });
});

describe('期待勝率', () => {
  it('同レートなら五分', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5);
  });

  it('400 差でおよそ 10 対 1', () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(10 / 11, 3);
  });

  it('自分と相手を入れ替えると足して1になる', () => {
    expect(expectedScore(1620, 1480) + expectedScore(1480, 1620)).toBeCloseTo(1);
  });
});

describe('レート変動', () => {
  it('同レートで勝つと K の半分だけ上がる', () => {
    const change = applyRating(INITIAL_RATING, 0, INITIAL_RATING, 1);
    expect(change.delta).toBe(20); // K=40 の半分
    expect(change.after).toBe(1520);
  });

  it('格上に勝つと大きく上がり、格下に勝ってもあまり上がらない', () => {
    const upset = applyRating(1500, 0, 1900, 1);
    const expected = applyRating(1900, 0, 1500, 1);
    expect(upset.delta).toBeGreaterThan(expected.delta);
    expect(expected.delta).toBeLessThanOrEqual(4);
  });

  it('引き分けは、格上相手なら上がり格下相手なら下がる', () => {
    expect(applyRating(1500, 0, 1900, 0.5).delta).toBeGreaterThan(0);
    expect(applyRating(1900, 0, 1500, 0.5).delta).toBeLessThan(0);
  });

  it('対局数が増えるほど動きが小さくなる', () => {
    const rookie = applyRating(1500, 0, 1500, 1).delta;
    const veteran = applyRating(1500, 200, 1500, 1).delta;
    expect(veteran).toBeLessThan(rookie);
  });
});

describe('両者まとめての変動', () => {
  it('同レート・同対局数なら、増えた分と減った分が釣り合う', () => {
    const { a, b } = ratePair({ rating: 1500, games: 5 }, { rating: 1500, games: 5 }, 1);
    expect(a.delta).toBe(20);
    expect(b.delta).toBe(-20);
    expect(a.delta + b.delta).toBe(0);
  });

  it('相手のレートは対局前の値を使う（順に更新して不公平にならない）', () => {
    const { a, b } = ratePair({ rating: 1400, games: 0 }, { rating: 1700, games: 0 }, 1);
    // どちらも「1400 対 1700」の期待勝率から計算されている
    expect(a.delta).toBe(-b.delta);
  });

  it('対局数が違えば動く量も違う', () => {
    const { a, b } = ratePair({ rating: 1500, games: 0 }, { rating: 1500, games: 150 }, 1);
    expect(a.delta).toBe(20); // K=40
    expect(b.delta).toBe(-5); // K=10
  });
});
