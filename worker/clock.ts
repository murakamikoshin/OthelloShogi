/**
 * 持ち時間の管理（フィッシャー方式: 各3分、1手ごとに5秒加算）。
 *
 * 時間はサーバだけが持つ。クライアントの申告は一切信用しない。
 */
import type { Color } from '../src/core/index.ts';
import { INCREMENT_MS, INITIAL_TIME_MS, type ClockState } from './protocol.ts';

export interface Clock {
  readonly remaining: Record<Color, number>;
  /** いまの手番が始まった時刻 */
  turnStartedAt: number;
}

export function createClock(now: number): Clock {
  return {
    remaining: { sente: INITIAL_TIME_MS, gote: INITIAL_TIME_MS },
    turnStartedAt: now,
  };
}

/** その手番の側が、いま時点であと何ミリ秒残っているか。 */
export function remainingFor(clock: Clock, color: Color, now: number): number {
  return Math.max(0, clock.remaining[color] - (now - clock.turnStartedAt));
}

/** 手番の側が時間を使い切っているか。 */
export function hasFlagged(clock: Clock, color: Color, now: number): boolean {
  return remainingFor(clock, color, now) <= 0;
}

/**
 * 着手が確定したときに時計を進める。
 * 使った時間を引き、加算ぶんを足して、相手の手番を始める。
 */
export function commitMove(clock: Clock, mover: Color, now: number): void {
  const used = now - clock.turnStartedAt;
  clock.remaining[mover] = Math.max(0, clock.remaining[mover] - used) + INCREMENT_MS;
  clock.turnStartedAt = now;
}

/** 画面に出すための残り時間。手番の側は経過ぶんを引いた値にする。 */
export function snapshot(clock: Clock, turn: Color, now: number): ClockState {
  return {
    sente: turn === 'sente' ? remainingFor(clock, 'sente', now) : clock.remaining.sente,
    gote: turn === 'gote' ? remainingFor(clock, 'gote', now) : clock.remaining.gote,
  };
}
