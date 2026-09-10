/**
 * オンライン対戦を、ブラウザ2つで実際に成立させる通しテスト。
 * Phase 3 の完了条件「別端末2台で対局が成立し、レートが正しく増減すること」を自動で確かめる。
 *
 *   npm run worker:dev -- --port 8788      （API サーバ）
 *   npm run db:init                        （初回だけ）
 *   WORKER_URL=http://localhost:8788 npm run dev -- --port 5180
 *   npm run onlinetest
 */
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const problems = [];
const check = (label, actual, expected) => {
  const ok = String(actual) === String(expected);
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (期待: ${expected})`}`);
  if (!ok) problems.push(label);
};

const browser = await chromium.launch({ executablePath });

/** 別々のブラウザ文脈で開く＝別の端末に相当する。 */
async function openPlayer(label) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ja-JP',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`${label}: ${error}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('404')) {
      problems.push(`${label}: ${message.text()}`);
    }
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250);
  if (await page.locator('.tut').isVisible().catch(() => false)) {
    await page.locator('[data-role="skip"]').click();
    await page.waitForTimeout(120);
  }
  return { label, page };
}

const a = await openPlayer('端末A');
const b = await openPlayer('端末B');

await a.page.locator('.modes button', { hasText: 'オンライン' }).click();
await b.page.locator('.modes button', { hasText: 'オンライン' }).click();

for (const player of [a, b]) {
  await player.page.waitForFunction(
    () => (document.querySelector('[data-role="banner"]')?.textContent ?? '').includes('との対局'),
    undefined,
    { timeout: 30000 },
  );
}
check('2台ともマッチングが成立する', true, true);
check('持ち時間が3分から始まる', await a.page.locator('[data-role="clock-sente"]').textContent(), '3:00');

const myTurn = async (player) =>
  ((await player.page.locator('.status__hint').textContent()) ?? '').includes('あなたの手番');

let moves = 0;
for (let i = 0; i < 8; i += 1) {
  const mover = (await myTurn(a)) ? a : (await myTurn(b)) ? b : null;
  if (!mover) {
    await a.page.waitForTimeout(400);
    continue;
  }
  const other = mover === a ? b : a;

  await mover.page.locator('.hand__pieces button:not([disabled])').first().click();
  await mover.page.waitForTimeout(120);
  const targets = mover.page.locator('.cell[data-target="true"]');
  const count = await targets.count();
  if (count === 0) break;
  await targets.nth(Math.floor(Math.random() * count)).click();
  await mover.page.waitForTimeout(100);
  const confirm = mover.page.locator('[data-role="confirm"]');
  if (await confirm.isVisible()) await confirm.click();

  await other.page.waitForTimeout(700);
  moves += 1;
}
check('何手か指せる', moves >= 6, true);

const boards = await Promise.all(
  [a, b].map(async (player) => player.page.locator('.cell__piece').count()),
);
check('2台の盤面が一致する', boards[0], boards[1]);
const counts = await Promise.all(
  [a, b].map(async (player) => player.page.locator('.status__counts').textContent()),
);
check('駒数の表示も一致する', counts[0], counts[1]);

// 投了して、両方の画面で決着とレート変動が見えること
a.page.on('dialog', (dialog) => dialog.accept());
await a.page.locator('[data-role="resign"]').click();
await a.page.waitForTimeout(1500);

for (const player of [a, b]) {
  check(
    `${player.label} に結果が出る`,
    await player.page.locator('[data-role="overlay"]').isVisible(),
    true,
  );
}
const banners = await Promise.all(
  [a, b].map(async (player) => player.page.locator('[data-role="banner"]').textContent()),
);
check('投了した側のレートが下がる', banners[0]?.includes('（-'), true);
check('勝った側のレートが上がる', banners[1]?.includes('（+'), true);
console.log(`      ${a.label}: ${banners[0]} / ${b.label}: ${banners[1]}`);

await browser.close();

if (problems.length > 0) {
  console.error('\n問題:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nすべて OK');
process.exit(0);
