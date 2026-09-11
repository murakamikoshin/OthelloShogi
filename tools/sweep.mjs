/**
 * ルールの候補を並べて、どれが面白くなるかを数字で比べる。
 *
 *   npm run sweep -- 40 3     … 各案 40局・深さ3
 *
 * src/core/rules.ts の定数を書き換えては測り、最後に元へ戻す。
 * 途中で止めた場合は `git checkout src/core/rules.ts` で戻せる。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { playMany } from './parallel.mjs';

const games = Number.parseInt(process.argv[2] ?? '40', 10);
const depth = Number.parseInt(process.argv[3] ?? '3', 10);
const workers = Number.parseInt(process.env.WORKERS ?? '4', 10);
const RULES = new URL('../src/core/rules.ts', import.meta.url);

/** 比べたい案。`set` は rules.ts の定数の書き換え。 */
const VARIANTS = [
  { name: '現状', set: {} },
  { name: '壁アンカー', set: { WALL_ANCHORS: 'true' } },
  { name: '打った駒も出世(3枚)', set: { PROMOTE_DROP_AT: '3' } },
  { name: '壁+出世', set: { WALL_ANCHORS: 'true', PROMOTE_DROP_AT: '3' } },
  { name: '連鎖上限3', set: { MAX_CHAIN: '3' } },
  { name: '60手で駒数決着', set: { PLY_LIMIT: '60' } },
  { name: '壁+60手', set: { WALL_ANCHORS: 'true', PLY_LIMIT: '60' } },
];

const original = readFileSync(RULES, 'utf8');

/** 定数の値を書き換える。 */
function patch(source, name, value) {
  const pattern = new RegExp(`(export const ${name}(?:: [^=]+)? = )[^;]+;`);
  if (!pattern.test(source)) throw new Error(`rules.ts に ${name} が見つかりません`);
  return source.replace(pattern, `$1${value};`);
}

const rows = [];
try {
  for (const variant of VARIANTS) {
    let source = original;
    for (const [name, value] of Object.entries(variant.set)) source = patch(source, name, value);
    writeFileSync(RULES, source);

    const started = Date.now();
    const records = await playMany(games, depth, workers);
    const minutes = ((Date.now() - started) / 60000).toFixed(1);

    const n = records.length;
    const sum = (pick) => records.reduce((total, r) => total + pick(r), 0);
    const count = (predicate) => records.filter(predicate).length;
    const drops = sum((r) => r.drops);

    rows.push({
      name: variant.name,
      手数: (sum((r) => r.plies) / n).toFixed(0),
      反転率: `${((sum((r) => r.flipDrops) / drops) * 100).toFixed(0)}%`,
      平均枚数: (sum((r) => r.flips) / drops).toFixed(2),
      最大連鎖: (sum((r) => r.maxChain) / n).toFixed(2),
      '3連鎖以上の対局': `${((count((r) => r.maxChain >= 3) / n) * 100).toFixed(0)}%`,
      リード交代: (sum((r) => r.leadChanges) / n).toFixed(1),
      逆転あり: `${((count((r) => r.loserLedOnce) / n) * 100).toFixed(0)}%`,
      先手勝率: `${((count((r) => r.winner === 'sente') / n) * 100).toFixed(0)}%`,
      引分: count((r) => r.winner === 'draw'),
      駒数決着: count((r) => r.reason.includes('count')),
    });
    console.log(`  ${variant.name} 完了（${minutes}分）`);
  }
} finally {
  writeFileSync(RULES, original);
  console.log('rules.ts を元に戻しました\n');
}

console.table(rows);
