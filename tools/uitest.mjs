/**
 * ブラウザで実際に操作してみる煙テスト。
 *
 *   npm run dev            （別のターミナルで起動しておく）
 *   npm run uitest         （既定では http://localhost:5173）
 *   npm run uitest -- http://localhost:5180 ./shots
 *
 * スクリーンショットは指定したディレクトリ（既定 ./.uitest）に出る。
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5173/';
const outDir = process.argv[3] ?? './.uitest';
mkdirSync(outDir, { recursive: true });

// このコンテナには Playwright 同梱版ではなく、あらかじめ入っている Chromium を使う
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

const problems = [];
page.on('pageerror', (error) => problems.push(`JS エラー: ${error}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
});

const cell = (row, col) => page.locator('.cell').nth(row * 6 + col);
const chip = (owner, kanji) =>
  page.locator(`.hand--${owner} .chip`, { hasText: kanji }).first();
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png` });
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (期待: ${expected})`}`);
  if (!ok) problems.push(`${label} が ${actual}（期待: ${expected}）`);
};

await page.goto(url, { waitUntil: 'networkidle' });
await shot('01-initial');
check('初期の手番', await page.locator('.status__turn').textContent(), '先手番');

// 開始局面では両陣の12枚が並んでいる
check('開始局面の駒数', await page.locator('.cell__piece').count(), 12);
check('玉に守られた駒の数', await page.locator('.cell__piece[data-guarded="true"]').count(), 10);

// 持ち駒を選ぶと打てるマスが出る
await chip('sente', '飛').click();
await page.waitForTimeout(120);
const dropTargets = await page.locator('.cell[data-target="true"]').count();
check('飛を打てるマス数（空マスの数）', dropTargets, 24);
await shot('02-drop-targets');

// 打つ前にプレビューが出る
await cell(3, 2).click();
await page.waitForTimeout(120);
check('確定ボタンが出る', await page.locator('[data-role="confirm"]').isVisible(), true);
await shot('03-preview');

await page.locator('[data-role="confirm"]').click();
await page.waitForTimeout(350);
check('打ったあとの手番', await page.locator('.status__turn').textContent(), '後手番');
await shot('04-after-drop');

// 盤の駒を動かす
await cell(1, 3).click();
await page.waitForTimeout(120);
check('後手の歩の移動先', await page.locator('.cell[data-target="true"]').count(), 1);
await cell(2, 3).click();
await page.waitForTimeout(300);
check('動かしたあとの手番', await page.locator('.status__turn').textContent(), '先手番');

// 待った
await page.locator('[data-role="undo"]').click();
await page.waitForTimeout(150);
check('待った後の手番', await page.locator('.status__turn').textContent(), '後手番');

// 投了 → 結果表示
page.on('dialog', (dialog) => dialog.accept());
await page.locator('[data-role="resign"]').click();
await page.waitForTimeout(250);
check('結果が出る', await page.locator('[data-role="overlay"]').isVisible(), true);
check('勝者', await page.locator('[data-role="result-title"]').textContent(), '先手の勝ち');
await shot('05-result');

await browser.close();

if (problems.length > 0) {
  console.error('\n問題:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nすべて OK');
