/**
 * バランス計測ツール。
 *
 * ランダム対局を大量に回して「反転と連鎖がどのくらい起きるか」「盤がどのくらい埋まるか」
 * を測る。src/core/rules.ts の数値を書き換えて実行し、結果を見比べるために使う。
 *
 *   npm run balance            … 400 局
 *   npm run balance -- 2000    … 2000 局
 *
 * 注意: ランダムな指し手なので、人間や AI が狙って挟みに行く実戦より必ず低めに出る。
 * 絶対値ではなく、設定を変えたときの「増えたか減ったか」を見るための道具。
 */
import type { GameState, Move } from '../src/core/index.ts';
import {
  BOARD_SIZE,
  INITIAL_HAND,
  MAX_CHAIN,
  SQUARE_COUNT,
  applyMoveWithDetail,
  countPieces,
  initialGameState,
  legalMoves,
} from '../src/core/index.ts';

/** 再現性のある擬似乱数（線形合同法）。 */
function createRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

const PLY_LIMIT = 400;

function main(): void {
  const games = Number.parseInt(process.argv[2] ?? '400', 10);

  let totalPly = 0;
  let peakPiecesSum = 0;
  let dropCount = 0;
  let flipDropCount = 0;
  let chainSum = 0;
  let bestChain = 0;
  const histogram = new Map<number, number>();

  for (let game = 0; game < games; game += 1) {
    const random = createRandom(game + 1);
    let state: GameState = initialGameState();
    let peak = 0;

    while (state.result.kind === 'playing' && state.ply < PLY_LIMIT) {
      const moves = legalMoves(state);
      const move: Move =
        moves.length === 0
          ? { kind: 'pass' }
          : (moves[Math.floor(random() * moves.length)] ?? { kind: 'pass' });

      const outcome = applyMoveWithDetail(state, move);

      if (move.kind === 'drop') {
        dropCount += 1;
        chainSum += outcome.chainCount;
        if (outcome.chainCount > 0) flipDropCount += 1;
        histogram.set(outcome.chainCount, (histogram.get(outcome.chainCount) ?? 0) + 1);
      }

      state = outcome.state;
      const counts = countPieces(state.board);
      peak = Math.max(peak, counts.sente + counts.gote);
    }

    totalPly += state.ply;
    peakPiecesSum += peak;
    bestChain = Math.max(bestChain, state.maxChainCount.sente, state.maxChainCount.gote);
  }

  const avgPeak = peakPiecesSum / games;
  const percent = (value: number): string => `${(value * 100).toFixed(0)}%`;

  console.log(
    `盤 ${BOARD_SIZE}x${BOARD_SIZE}（${SQUARE_COUNT}マス） / ` +
      `初期持ち駒 歩${INITIAL_HAND.P} 飛${INITIAL_HAND.R} 角${INITIAL_HAND.B} / ` +
      `MAX_CHAIN ${MAX_CHAIN}`,
  );
  console.log(`ランダム対局 ${games} 局`);
  console.log(`  平均手数              : ${(totalPly / games).toFixed(1)}`);
  console.log(
    `  盤上の駒の最大数      : ${avgPeak.toFixed(1)} / ${SQUARE_COUNT}` +
      `（埋まり率 ${percent(avgPeak / SQUARE_COUNT)}）`,
  );
  console.log(`  打つ手のうち反転が起きた割合: ${percent(flipDropCount / dropCount)}`);
  console.log(`  打つ手あたりの平均連鎖数    : ${(chainSum / dropCount).toFixed(2)}`);
  console.log(`  1局の最大連鎖数の最大       : ${bestChain}`);
  console.log(
    `  連鎖数の分布: ` +
      [...histogram.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([chain, count]) => `${chain}連鎖 ${percent(count / dropCount)}`)
        .join(' / '),
  );
}

main();
