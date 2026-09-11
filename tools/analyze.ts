/**
 * AI 同士を大量に対局させて「面白さ」に効く数字を取る。
 *
 *   npm run analyze -- 25 3 0      … 25局・深さ3・seed の開始番号 0
 *   npm run analyze -- 25 3 25 --json
 *
 * --json を付けると集計用の JSON を1行で出す（複数プロセスに分けて回すため）。
 *
 * 見ている数字:
 *   連鎖         … このゲームの売り。滅多に出ないなら演出が死んでいる
 *   リード交代   … 何度ひっくり返ったか。0 なら一方的で退屈
 *   決着した手数 … 勝敗が決まってから何手だらだら続いたか
 *   決着の種類   … 玉取りばかりだと将棋のおまけになってしまう
 */
import { pathToFileURL } from 'node:url';
import type { GameState } from '../src/core/index.ts';
import {
  SQUARE_COUNT,
  applyMoveWithDetail,
  countPieces,
  initialGameState,
} from '../src/core/index.ts';
import { findBestMove } from '../src/ai/search.ts';

function createRandom(seed: number): () => number {
  let value = (seed * 2654435761) >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

export interface GameRecord {
  plies: number;
  winner: 'sente' | 'gote' | 'draw';
  reason: string;
  drops: number;
  flipDrops: number;
  flips: number;
  /** 連鎖数ごとの回数（index が連鎖数） */
  chainHistogram: number[];
  maxChain: number;
  peakPieces: number;
  /** 盤上の駒数の優劣がひっくり返った回数 */
  leadChanges: number;
  /** 最後にひっくり返った手数。勝負が決まった時点の目安 */
  decidedAt: number;
  /** 負けた側が一度でもリードしていたか */
  loserLedOnce: boolean;
}

export function playOne(seed: number, depth: number, timeLimitMs = 500): GameRecord {
  const random = createRandom(seed);
  let state: GameState = initialGameState();

  const record: GameRecord = {
    plies: 0,
    winner: 'draw',
    reason: 'ply_limit',
    drops: 0,
    flipDrops: 0,
    flips: 0,
    chainHistogram: [],
    maxChain: 0,
    peakPieces: 0,
    leadChanges: 0,
    decidedAt: 0,
    loserLedOnce: false,
  };

  let lastLead = 0;
  const leadAt: { ply: number; lead: number }[] = [];

  while (state.result.kind === 'playing' && state.ply < 260) {
    const found = findBestMove(state, { depth, timeLimitMs, noise: 35, random });
    const move = found.move ?? { kind: 'pass' as const };
    const outcome = applyMoveWithDetail(state, move);

    if (move.kind === 'drop') {
      record.drops += 1;
      record.flips += outcome.flips.length;
      if (outcome.chainCount > 0) record.flipDrops += 1;
      record.chainHistogram[outcome.chainCount] =
        (record.chainHistogram[outcome.chainCount] ?? 0) + 1;
    }

    state = outcome.state;
    const counts = countPieces(state.board);
    record.peakPieces = Math.max(record.peakPieces, counts.sente + counts.gote);

    const lead = Math.sign(counts.sente - counts.gote);
    if (lead !== 0 && lastLead !== 0 && lead !== lastLead) {
      record.leadChanges += 1;
      record.decidedAt = state.ply;
    }
    if (lead !== 0) lastLead = lead;
    leadAt.push({ ply: state.ply, lead });
  }

  record.plies = state.ply;
  record.maxChain = Math.max(state.maxChainCount.sente, state.maxChainCount.gote);
  const { result } = state;
  if (result.kind === 'win') {
    record.winner = result.winner;
    record.reason = result.reason;
  } else if (result.kind === 'draw') {
    record.winner = 'draw';
    record.reason = result.reason;
  }

  if (record.winner !== 'draw') {
    const loserSign = record.winner === 'sente' ? -1 : 1;
    record.loserLedOnce = leadAt.some((entry) => entry.lead === loserSign);
  }

  return record;
}

/** 集計して人が読める形にする。 */
export function summarize(games: readonly GameRecord[]): string {
  const n = games.length;
  const sum = (pick: (g: GameRecord) => number): number =>
    games.reduce((total, g) => total + pick(g), 0);
  const count = (predicate: (g: GameRecord) => boolean): number =>
    games.filter(predicate).length;
  const pct = (value: number): string => `${((value / n) * 100).toFixed(0)}%`;

  const drops = sum((g) => g.drops);
  const chains: number[] = [];
  for (const game of games) {
    game.chainHistogram.forEach((times, chain) => {
      chains[chain] = (chains[chain] ?? 0) + times;
    });
  }

  const reasons = new Map<string, number>();
  for (const game of games) reasons.set(game.reason, (reasons.get(game.reason) ?? 0) + 1);

  const lines = [
    `対局数 ${n}`,
    '',
    '【テンポ】',
    `  平均手数            : ${(sum((g) => g.plies) / n).toFixed(1)}`,
    `  盤の埋まり率        : ${((sum((g) => g.peakPieces) / n / SQUARE_COUNT) * 100).toFixed(0)}%` +
      ` (${(sum((g) => g.peakPieces) / n).toFixed(1)} / ${SQUARE_COUNT})`,
    '',
    '【連鎖（このゲームの売り）】',
    `  打つ手のうち反転あり: ${((sum((g) => g.flipDrops) / drops) * 100).toFixed(0)}%`,
    `  1手あたりの反転枚数 : ${(sum((g) => g.flips) / drops).toFixed(2)}`,
    `  連鎖の内訳          : ${chains
      .map((times, chain) => (chain === 0 || !times ? null : `${chain}連鎖 ${((times / drops) * 100).toFixed(1)}%`))
      .filter((text) => text !== null)
      .join(' / ')}`,
    `  1局の最大連鎖の平均 : ${(sum((g) => g.maxChain) / n).toFixed(2)}`,
    `  3連鎖以上が出た対局 : ${pct(count((g) => g.maxChain >= 3))}`,
    `  4連鎖以上が出た対局 : ${pct(count((g) => g.maxChain >= 4))}`,
    '',
    '【競り合い】',
    `  リード交代の平均回数: ${(sum((g) => g.leadChanges) / n).toFixed(1)}`,
    `  一度も交代しない対局: ${pct(count((g) => g.leadChanges === 0))}`,
    `  負けた側もリードした: ${pct(count((g) => g.loserLedOnce))}`,
    `  勝負が決まった時点  : ${((sum((g) => g.decidedAt) / n / (sum((g) => g.plies) / n)) * 100).toFixed(0)}% 地点`,
    '',
    '【決着】',
    `  先手 ${count((g) => g.winner === 'sente')} / 後手 ${count((g) => g.winner === 'gote')} / 引分 ${count((g) => g.winner === 'draw')}` +
      `  （先手勝率 ${pct(count((g) => g.winner === 'sente'))}）`,
    `  理由: ${[...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, times]) => `${reason} ${times}`)
      .join(' / ')}`,
  ];
  return lines.join('\n');
}

/**
 * このファイルは summarize() を他から import して使うので、
 * 直接実行されたときだけ対局を走らせる。
 * （import しただけで対局が始まってしまうと、呼んだ側が終わらない）
 */
function main(): void {
  const games = Number.parseInt(process.argv[2] ?? '25', 10);
  const depth = Number.parseInt(process.argv[3] ?? '3', 10);
  const offset = Number.parseInt(process.argv[4] ?? '0', 10);
  const asJson = process.argv.includes('--json');

  const records: GameRecord[] = [];
  for (let i = 0; i < games; i += 1) {
    records.push(playOne(offset + i + 1, depth));
    if (!asJson) process.stdout.write(`\r  ${i + 1}/${games} 局`);
  }

  if (asJson) {
    console.log(JSON.stringify(records));
    return;
  }
  console.log('\n');
  console.log(summarize(records));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
