import { initialGameState, applyMoveWithDetail } from './src/core/index.ts';
import { findBestMove } from './src/ai/search.ts';
import type { GameState } from './src/core/index.ts';
function rng(seed: number) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; }
let sw = 0, gw = 0, dr = 0, plies = 0;
const N = 60;
for (let g = 0; g < N; g++) {
  const random = rng(g * 7919 + 13);
  let s: GameState = initialGameState();
  while (s.result.kind === 'playing' && s.ply < 200) {
    const r = findBestMove(s, { depth: 3, timeLimitMs: 700, noise: 45, random });
    s = applyMoveWithDetail(s, r.move ?? { kind: 'pass' }).state;
  }
  plies += s.ply;
  if (s.result.kind === 'win') (s.result.winner === 'sente' ? sw++ : gw++); else dr++;
  if ((g + 1) % 10 === 0) console.log(`  ${g + 1}局: 先手 ${sw} / 後手 ${gw} / 引分 ${dr}`);
}
console.log(`最終 ${N}局: 先手 ${sw} / 後手 ${gw} / 引分 ${dr}  先手勝率 ${(sw / N * 100).toFixed(0)}%  平均${(plies/N).toFixed(0)}手`);
