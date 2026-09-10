import { describe, expect, it } from 'vitest';
import {
  INITIAL_RANGE,
  WIDEN_BY,
  WIDEN_EVERY_MS,
  allowedRange,
  assignColors,
  canPair,
  findPair,
  type Waiting,
} from './lobby.ts';

const waiting = (rating: number, since: number, id = `p${rating}`): Waiting => ({
  player: { id, name: id, rating },
  since,
});

describe('レート差の緩和', () => {
  it('最初は ±100', () => {
    expect(allowedRange(0)).toBe(INITIAL_RANGE);
    expect(allowedRange(WIDEN_EVERY_MS - 1)).toBe(INITIAL_RANGE);
  });

  it('10秒ごとに ±100 ずつ緩む', () => {
    expect(allowedRange(WIDEN_EVERY_MS)).toBe(INITIAL_RANGE + WIDEN_BY);
    expect(allowedRange(WIDEN_EVERY_MS * 3)).toBe(INITIAL_RANGE + WIDEN_BY * 3);
  });
});

describe('組めるかどうか', () => {
  it('レートが近ければすぐ組める', () => {
    expect(canPair(waiting(1500, 0), waiting(1560, 0), 0)).toBe(true);
  });

  it('レートが離れていると最初は組めない', () => {
    expect(canPair(waiting(1200, 0), waiting(1800, 0), 0)).toBe(false);
  });

  it('待っていれば組めるようになる', () => {
    const a = waiting(1200, 0);
    const b = waiting(1800, 0);
    expect(canPair(a, b, WIDEN_EVERY_MS * 2)).toBe(false); // ±300 ではまだ届かない
    expect(canPair(a, b, WIDEN_EVERY_MS * 5)).toBe(true); // ±600 で届く
  });

  it('片方だけ長く待っていても組める（待っている側の条件を優先）', () => {
    const veteran = waiting(1200, 0); // ずっと待っている
    const rookie = waiting(1700, WIDEN_EVERY_MS * 5); // 今来たばかり
    expect(canPair(veteran, rookie, WIDEN_EVERY_MS * 5)).toBe(true);
  });
});

describe('ペア探し', () => {
  it('誰もいなければ組まない', () => {
    expect(findPair([], 0)).toBeNull();
    expect(findPair([waiting(1500, 0)], 0)).toBeNull();
  });

  it('レートがいちばん近い相手と組む', () => {
    const target = waiting(1520, 0, 'near');
    const queue = [waiting(1500, 0, 'me'), waiting(1590, 0, 'far'), target];
    const pair = findPair(queue, 0);
    expect(pair).not.toBeNull();
    expect(pair?.map((entry) => entry.player.id).sort()).toEqual(['me', 'near']);
  });

  it('長く待っている人から先に組む', () => {
    const oldest = waiting(1500, 0, 'oldest');
    const queue = [waiting(1500, 5_000, 'newer'), oldest, waiting(1500, 8_000, 'newest')];
    const pair = findPair(queue, 10_000);
    expect(pair?.[0].player.id).toBe('oldest');
  });

  it('全員のレートが離れていれば組まない', () => {
    const queue = [waiting(1000, 0), waiting(1600, 0), waiting(2200, 0)];
    expect(findPair(queue, 0)).toBeNull();
  });
});

describe('先後の割り当て', () => {
  it('レートが低い側が先手（先手に歩1枚のハンデがあるため）', () => {
    const players = assignColors(waiting(1700, 0, 'strong'), waiting(1400, 0, 'weak'));
    expect(players.sente.id).toBe('weak');
    expect(players.gote.id).toBe('strong');
  });

  it('同レートなら先に並んでいた側が先手', () => {
    const players = assignColors(waiting(1500, 0, 'first'), waiting(1500, 100, 'second'));
    expect(players.sente.id).toBe('first');
  });
});
