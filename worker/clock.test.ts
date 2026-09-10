import { describe, expect, it } from 'vitest';
import { INCREMENT_MS, INITIAL_TIME_MS } from './protocol.ts';
import { commitMove, createClock, hasFlagged, remainingFor, snapshot } from './clock.ts';

describe('持ち時間（フィッシャー方式）', () => {
  it('最初は両者3分', () => {
    const clock = createClock(0);
    expect(clock.remaining.sente).toBe(INITIAL_TIME_MS);
    expect(clock.remaining.gote).toBe(INITIAL_TIME_MS);
  });

  it('手番の側だけ時間が減っていく', () => {
    const clock = createClock(0);
    expect(remainingFor(clock, 'sente', 10_000)).toBe(INITIAL_TIME_MS - 10_000);
    // 相手の持ち時間はそのまま
    expect(snapshot(clock, 'sente', 10_000).gote).toBe(INITIAL_TIME_MS);
  });

  it('指すと使った分が引かれ、5秒加算される', () => {
    const clock = createClock(0);
    commitMove(clock, 'sente', 10_000);
    expect(clock.remaining.sente).toBe(INITIAL_TIME_MS - 10_000 + INCREMENT_MS);
    expect(clock.turnStartedAt).toBe(10_000);
  });

  it('速く指せば持ち時間は増える', () => {
    const clock = createClock(0);
    commitMove(clock, 'sente', 1_000); // 1秒で指した
    expect(clock.remaining.sente).toBe(INITIAL_TIME_MS + 4_000);
  });

  it('使い切ったら時間切れになる', () => {
    const clock = createClock(0);
    expect(hasFlagged(clock, 'sente', INITIAL_TIME_MS - 1)).toBe(false);
    expect(hasFlagged(clock, 'sente', INITIAL_TIME_MS)).toBe(true);
    expect(hasFlagged(clock, 'sente', INITIAL_TIME_MS + 5_000)).toBe(true);
  });

  it('残り時間がマイナスにはならない', () => {
    const clock = createClock(0);
    commitMove(clock, 'sente', INITIAL_TIME_MS * 2);
    expect(clock.remaining.sente).toBe(INCREMENT_MS);
    expect(remainingFor(clock, 'sente', 0)).toBeGreaterThanOrEqual(0);
  });
});
