/**
 * AI 同士の自己対戦。ランダム対局より実戦に近い数字が取れる。
 *
 *   npm run selfplay                 … 既定 30局・深さ3
 *   npm run selfplay -- 50 4         … 50局・深さ4
 *   npm run selfplay -- 30 3 --quiet … 1局ごとのログを出さない
 */
import type { GameState, Move } from '../src/core/index.ts';
import {
  BOARD_SIZE,
  FLIP_DIRECTION_MODE,
  INITIAL_HANDS,
  SQUARE_COUNT,
  applyMoveWithDetail,
  countPieces,
  initialGameState,
} from '../src/core/index.ts';
import { findBestMove } from '../src/ai/search.ts';

function createRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

const PLY_LIMIT = 260;

interface GameStats {
  readonly ply: number;
  readonly winner: 'sente' | 'gote' | 'draw';
  readonly reason: string;
  readonly maxChain: number;
  readonly peakPieces: number;
  readonly drops: number;
  readonly flipDrops: number;
  readonly chainSum: number;
  readonly firstFlipPly: number | null;
}

function playGame(seed: number, depth: number): GameStats {
  const random = createRandom(seed);
  let state: GameState = initialGameState();
  let peak = 0;
  let drops = 0;
  let flipDrops = 0;
  let chainSum = 0;
  let firstFlipPly: number | null = null;

  while (state.result.kind === 'playing' && state.ply < PLY_LIMIT) {
    const found = findBestMove(state, {
      depth,
      timeLimitMs: 1200,
      // 同じ対局ばかりにならないよう、わずかに揺らぎを入れる
      noise: 12,
      random,
    });
    const move: Move = found.move ?? { kind: 'pass' };
    const outcome = applyMoveWithDetail(state, move);

    if (move.kind === 'drop') {
      drops += 1;
      chainSum += outcome.chainCount;
      if (outcome.chainCount > 0) {
        flipDrops += 1;
        if (firstFlipPly === null) firstFlipPly = state.ply + 1;
      }
    }

    state = outcome.state;
    const counts = countPieces(state.board);
    peak = Math.max(peak, counts.sente + counts.gote);
  }

  const { result } = state;
  return {
    ply: state.ply,
    winner: result.kind === 'win' ? result.winner : 'draw',
    reason: result.kind === 'playing' ? 'ply_limit' : result.kind === 'win' ? result.reason : result.reason,
    maxChain: Math.max(state.maxChainCount.sente, state.maxChainCount.gote),
    peakPieces: peak,
    drops,
    flipDrops,
    chainSum,
    firstFlipPly,
  };
}

function main(): void {
  const games = Number.parseInt(process.argv[2] ?? '30', 10);
  const depth = Number.parseInt(process.argv[3] ?? '3', 10);
  const quiet = process.argv.includes('--quiet');

  const stats: GameStats[] = [];
  const started = Date.now();

  for (let game = 0; game < games; game += 1) {
    const result = playGame(game + 1, depth);
    stats.push(result);
    if (!quiet) {
      console.log(
        `  #${String(game + 1).padStart(3)} ${String(result.ply).padStart(3)}手 ` +
          `${result.winner.padEnd(5)} ${result.reason.padEnd(16)} ` +
          `最大連鎖 ${result.maxChain} / 反転した打ち手 ${result.flipDrops}/${result.drops}`,
      );
    }
  }

  const sum = (pick: (s: GameStats) => number): number =>
    stats.reduce((total, s) => total + pick(s), 0);
  const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;
  const count = (predicate: (s: GameStats) => boolean): number => stats.filter(predicate).length;

  const totalDrops = sum((s) => s.drops);
  const firstFlips = stats.map((s) => s.firstFlipPly).filter((v): v is number => v !== null);
  const reasons = new Map<string, number>();
  for (const s of stats) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);

  console.log('');
  console.log(
    `盤 ${BOARD_SIZE}x${BOARD_SIZE}（${SQUARE_COUNT}マス） / ` +
      `初期持ち駒 先手 歩${INITIAL_HANDS.sente.P}飛${INITIAL_HANDS.sente.R}角${INITIAL_HANDS.sente.B}` +
      ` / 後手 歩${INITIAL_HANDS.gote.P}飛${INITIAL_HANDS.gote.R}角${INITIAL_HANDS.gote.B} / ` +
      `方向 ${FLIP_DIRECTION_MODE}`,
  );
  console.log(`AI 自己対戦 ${games} 局・深さ ${depth}（${((Date.now() - started) / 1000).toFixed(1)}秒）`);
  console.log(`  平均手数                    : ${(sum((s) => s.ply) / games).toFixed(1)}`);
  console.log(
    `  盤上の駒の最大数            : ${(sum((s) => s.peakPieces) / games).toFixed(1)} / ${SQUARE_COUNT}` +
      `（埋まり率 ${percent(sum((s) => s.peakPieces) / games / SQUARE_COUNT)}）`,
  );
  console.log(`  打つ手のうち反転が起きた割合: ${percent(sum((s) => s.flipDrops) / totalDrops)}`);
  console.log(`  打つ手あたりの平均連鎖数    : ${(sum((s) => s.chainSum) / totalDrops).toFixed(2)}`);
  console.log(`  1局の最大連鎖の平均         : ${(sum((s) => s.maxChain) / games).toFixed(2)}`);
  console.log(`  2連鎖以上が出た対局         : ${percent(count((s) => s.maxChain >= 2) / games)}`);
  console.log(`  3連鎖以上が出た対局         : ${percent(count((s) => s.maxChain >= 3) / games)}`);
  console.log(
    `  最初の反転が起きた手数      : ${
      firstFlips.length === 0
        ? '（反転なし）'
        : `${(firstFlips.reduce((a, b) => a + b, 0) / firstFlips.length).toFixed(1)} 手目`
    }` + `（反転が1度も無い対局 ${percent((games - firstFlips.length) / games)}）`,
  );
  console.log(`  先手勝ち ${count((s) => s.winner === 'sente')} / 後手勝ち ${count((s) => s.winner === 'gote')} / 引き分け ${count((s) => s.winner === 'draw')}`);
  console.log(
    `  決着理由: ${[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, c]) => `${r} ${c}`).join(' / ')}`,
  );
}

main();
