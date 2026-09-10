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
// 既定は日本語環境として確認する（英語は最後にまとめて確認する）
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'ja-JP',
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
/** 初回に出るルール説明を閉じる。 */
const dismissTutorial = async () => {
  const tutorial = page.locator('.tut');
  if (await tutorial.isVisible().catch(() => false)) {
    await page.locator('[data-role="skip"]').click();
    await page.waitForTimeout(120);
  }
};
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (期待: ${expected})`}`);
  if (!ok) problems.push(`${label} が ${actual}（期待: ${expected}）`);
};

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForTimeout(200);
check('初回にルール説明が出る', await page.locator('.tut').isVisible(), true);
check('ルール説明は3枚', await page.locator('.tut__dot').count(), 3);
await shot('00-tutorial');
await dismissTutorial();

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


// ---------------------------------------------------------------------------
// AI 対戦（別スレッドで思考しても画面が固まらないこと）
// ---------------------------------------------------------------------------
await page.goto(url, { waitUntil: 'networkidle' });
await dismissTutorial();
await page.locator('.modes button', { hasText: 'AI 中' }).click();
await page.waitForTimeout(150);

// 人間（先手）が1手指すと、AI（後手）が自動で返す
await chip('sente', '歩').click();
await page.waitForTimeout(100);
await cell(3, 2).click();
await page.waitForTimeout(100);
await page.locator('[data-role="confirm"]').click();

// 思考中の表示が出て、やがて先手番に戻る
await page.waitForFunction(
  () => document.querySelector('.status__turn')?.textContent === '先手番',
  undefined,
  { timeout: 15000 },
);
check('AI が指し返して先手番に戻る', await page.locator('.status__turn').textContent(), '先手番');
check('AI が指したので盤の駒が増えているか動いている', (await page.locator('.cell__piece').count()) >= 13, true);
await shot('06-vs-ai');

// ---------------------------------------------------------------------------
// 多言語（navigator.language での自動判定 / 切り替え / レイアウトの頑丈さ）
// ---------------------------------------------------------------------------
const english = await browser.newPage({ viewport: { width: 360, height: 780 }, locale: 'en-US' });
await english.goto(url, { waitUntil: 'networkidle' });
await english.waitForTimeout(200);
check(
  '英語環境では英語で開く',
  await english.locator('.tut__title').textContent(),
  'Sandwich it and it defects',
);
await english.locator('[data-role="skip"]').click();
await english.waitForTimeout(150);
check('ボタンも英語になる', await english.locator('[data-role="resign"]').textContent(), 'Resign');
check(
  '日本語以外では駒にローマ字が付く',
  await english.locator('.cell__piece[data-roman]').count(),
  12,
);
check(
  '横スクロールが出ない',
  await english.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  ),
  false,
);

// 言語を切り替えると日本語に戻り、ローマ字も消える
await english.locator('[data-role="lang"]').click();
await english.waitForTimeout(150);
check('切り替えで日本語になる', await english.locator('[data-role="resign"]').textContent(), '投了');
check('日本語ではローマ字を出さない', await english.locator('.cell__piece[data-roman]').count(), 0);

// 文字数が2倍でも壊れないこと（ドイツ語想定）
const brokeLayout = await english.evaluate(() => {
  for (const button of document.querySelectorAll('.modes button, .actions button')) {
    button.textContent = 'Zugunerkennung';
  }
  return document.documentElement.scrollWidth > document.documentElement.clientWidth;
});
check('語が2倍の長さでもレイアウトが崩れない', brokeLayout, false);
await english.screenshot({ path: `${outDir}/08-english.png` });
await english.close();

await browser.close();

if (problems.length > 0) {
  console.error('\n問題:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nすべて OK');
