/**
 * AI 同士を大量に対局させて、面白さに効く数字をまとめて出す。
 *
 *   npm run report -- 100 3
 */
import { writeFileSync } from 'node:fs';
import { playMany } from './parallel.mjs';
import { summarize } from './analyze.ts';

const total = Number.parseInt(process.argv[2] ?? '100', 10);
const depth = Number.parseInt(process.argv[3] ?? '3', 10);
const workers = Number.parseInt(process.env.WORKERS ?? '4', 10);

console.log(`${total} 局を ${workers} 並列・深さ ${depth} で回します…`);
const started = Date.now();
const games = await playMany(total, depth, workers);
console.log(`（${((Date.now() - started) / 60000).toFixed(1)} 分）\n`);
console.log(summarize(games));
writeFileSync('.analyze.json', JSON.stringify(games));
