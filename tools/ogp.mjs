/**
 * OGP 画像（SNS でリンクを貼ったときに出るカード）を作る。
 *
 *   npm run ogp
 *
 * 画像を手で描くとルールが変わったときに古くなるので、
 * 実際のルールエンジンで作った盤面をブラウザで描いて撮っている。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const OUT = new URL('../public/ogp.png', import.meta.url);

// 連鎖が起きた直後の盤（ルールエンジンが出した並びをそのまま書き写したもの）
const BOARD = [
  '. . b k r .',
  '. . p p p .',
  '. . R . . .',
  'R T T . . .',
  '. P P P . .',
  '. R K B . .',
].map((row) => row.trim().split(/\s+/));

const KANJI = { k: '玉', p: '歩', r: '飛', b: '角', t: 'と' };
const FLIPPED = new Set(['3-1', '3-2']);

const cells = BOARD.flatMap((row, r) =>
  row.map((token, c) => {
    if (token === '.') return '<div class="cell"></div>';
    const sente = token === token.toUpperCase();
    const kanji = KANJI[token.toLowerCase()];
    const flip = FLIPPED.has(`${r}-${c}`) ? ' flip' : '';
    return `<div class="cell"><span class="piece${sente ? '' : ' gote'}${flip}">${kanji}</span></div>`;
  }),
).join('');

const html = `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; display: flex; align-items: center; gap: 52px;
    padding: 0 60px; background: #faf7f2;
    font-family: "Noto Sans CJK JP", "Noto Sans JP", "Hiragino Sans", sans-serif; }
  .board { display: grid; grid-template-columns: repeat(6, 1fr); gap: 2px;
    width: 420px; height: 420px; background: #8b6b3e; border: 4px solid #8b6b3e;
    border-radius: 6px; flex: 0 0 auto; }
  .cell { background: #e6c88c; display: flex; align-items: center; justify-content: center; }
  .piece { width: 84%; height: 84%; display: flex; align-items: center; justify-content: center;
    background: #f6e2b8; border: 1px solid #c49a5a; border-radius: 4px;
    font-size: 36px; font-weight: 700; color: #1c1917; }
  .piece.gote { transform: rotate(180deg); }
  .piece.flip { outline: 4px solid #f97316; color: #b91c1c; }
  h1 { font-size: 72px; letter-spacing: 0.02em; color: #1c1917; white-space: nowrap; }
  .sub { font-size: 26px; color: #8b6b3e; letter-spacing: 0.22em; margin-top: 6px; }
  p { font-size: 29px; line-height: 1.7; color: #44403c; margin-top: 30px; white-space: nowrap; }
  .tag { display: inline-block; margin-top: 26px; padding: 8px 20px; border-radius: 999px;
    background: #f97316; color: #fff; font-size: 26px; font-weight: 700; }
</style>
<div class="board">${cells}</div>
<div>
  <h1>寝返り将棋</h1>
  <div class="sub">NEGAERI SHOGI</div>
  <p>挟まれた駒は敵に寝返り、出世する。<br>出世した駒の利きで、さらに寝返る。</p>
  <span class="tag">2 連鎖</span>
</div>`;

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
writeFileSync(OUT, await page.screenshot({ type: 'png' }));
await browser.close();
console.log(`書き出しました: ${OUT.pathname}`);
