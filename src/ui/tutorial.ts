/**
 * 初回起動時のルール説明。
 *
 * 文章ではなく、実際の盤を使った図で見せる。
 * このゲームは「打つと寝返る・寝返ると成る・成ると連鎖する」が伝わらないと
 * 何をしているのか分からないので、そこだけに絞って3枚で説明する。
 *
 * 図はルールエンジンで本当に手を進めて作っているので、
 * 説明とルールがずれることがない。
 */
import type { Board, Pos } from '../core/index.ts';
import { BOARD_SIZE, parseBoardDiagram, simulateDrop } from '../core/index.ts';
import { t } from '../i18n/index.ts';
import { pieceKanji, pieceRoman } from './labels.ts';

const SEEN_KEY = 'negaeri:tutorial-seen';

interface Slide {
  /** 訳語のキーの接頭辞（例: 'tutorial.flip'） */
  readonly key: string;
  /** 打つ前の盤 */
  readonly before: Board;
  /** 打つ手 */
  readonly drop: { readonly piece: 'P' | 'R' | 'B'; readonly at: Pos };
}

/** 1. 挟むと寝返る */
const SLIDE_FLIP: Slide = {
  key: 'tutorial.flip',
  before: parseBoardDiagram([
    '.  .  .  .  .  .',
    '.  .  R  .  .  .',
    '.  .  p  .  .  .',
    '.  .  .  .  .  .',
    '.  .  .  .  .  .',
    '.  .  .  .  K  k',
  ]),
  drop: { piece: 'P', at: { row: 3, col: 2 } },
};

/** 2. 寝返った駒は成る */
const SLIDE_PROMOTE: Slide = {
  key: 'tutorial.promote',
  before: parseBoardDiagram([
    '.  .  .  .  .  .',
    '.  R  b  r  .  .',
    '.  .  .  .  .  .',
    '.  .  .  .  .  .',
    '.  .  .  .  .  .',
    '.  .  .  .  K  k',
  ]),
  drop: { piece: 'R', at: { row: 1, col: 4 } },
};

/** 3. 成った駒の利きで連鎖する */
const SLIDE_CHAIN: Slide = {
  key: 'tutorial.chain',
  before: parseBoardDiagram([
    '.  .  .  .  .  .',
    '.  .  .  .  .  .',
    '.  .  R  .  .  .',
    'R  p  p  .  .  .',
    '.  .  .  .  .  .',
    '.  .  .  .  K  k',
  ]),
  drop: { piece: 'P', at: { row: 4, col: 2 } },
};

const SLIDES: readonly Slide[] = [SLIDE_FLIP, SLIDE_PROMOTE, SLIDE_CHAIN];

/** 玉に守られた駒は寝返らないので、説明の図では玉を隅に置いてある。 */
function renderBoard(board: Board, marks: ReadonlyMap<number, string>): string {
  const cells: string[] = [];
  for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) {
    const piece = board[index] ?? null;
    const mark = marks.get(index);
    const attrs = mark ? ` data-mark="${mark}"` : '';
    const roman = piece ? pieceRoman(piece.type) : null;
    const inner = piece
      ? `<span class="tut__piece" data-owner="${piece.owner}"` +
        ` data-promoted="${piece.type.startsWith('+')}"` +
        `${roman ? ` data-roman="${roman}"` : ''}>${pieceKanji(piece.type)}</span>`
      : '';
    cells.push(`<div class="tut__cell"${attrs}>${inner}</div>`);
  }
  return `<div class="tut__board" style="grid-template-columns:repeat(${BOARD_SIZE},1fr)">${cells.join('')}</div>`;
}

/** 打つ前と打った後を並べて見せる。 */
function renderSlide(slide: Slide): string {
  const { piece, at } = slide.drop;
  const result = simulateDrop(slide.before, at, piece, 'sente');
  const dropIndex = at.row * BOARD_SIZE + at.col;

  const beforeMarks = new Map<number, string>([[dropIndex, 'drop']]);
  const afterMarks = new Map<number, string>([[dropIndex, 'drop']]);
  result.steps.forEach((step, level) => {
    for (const pos of step) afterMarks.set(pos.row * BOARD_SIZE + pos.col, String(level + 1));
  });

  const chainNote =
    result.chainCount >= 2
      ? `<span class="tut__chain">${t('chain.badge', { count: result.chainCount })}</span>`
      : '';

  return `
    <h2 class="tut__title">${t(`${slide.key}.title`)}</h2>
    <div class="tut__figures">
      <figure>
        <figcaption>${t('tutorial.dropHere', { piece: pieceKanji(piece) })}</figcaption>
        ${renderBoard(slide.before, beforeMarks)}
      </figure>
      <div class="tut__arrow" aria-hidden="true">▼</div>
      <figure>
        <figcaption>${t('tutorial.flipped', { count: result.flips.length })} ${chainNote}</figcaption>
        ${renderBoard(result.board, afterMarks)}
      </figure>
    </div>
    <p class="tut__body">${t(`${slide.key}.body`)}</p>
  `;
}

/**
 * ルール説明を表示する。
 * @param force 「遊び方」ボタンから開いたときは、既に見ていても表示する
 */
export function showTutorial(force = false): void {
  if (!force && window.localStorage.getItem(SEEN_KEY) === 'yes') return;

  let index = 0;
  const overlay = document.createElement('div');
  overlay.className = 'overlay tut';
  overlay.innerHTML = `
    <div class="overlay__card tut__card">
      <div class="tut__slide" data-role="slide"></div>
      <div class="tut__dots" data-role="dots"></div>
      <div class="tut__buttons">
        <button class="ghost" data-role="skip">${t('action.skip')}</button>
        <button class="confirm" data-role="next"></button>
      </div>
    </div>
  `;
  document.body.append(overlay);

  const slideBox = overlay.querySelector<HTMLDivElement>('[data-role="slide"]')!;
  const dots = overlay.querySelector<HTMLDivElement>('[data-role="dots"]')!;
  const nextButton = overlay.querySelector<HTMLButtonElement>('[data-role="next"]')!;
  const skipButton = overlay.querySelector<HTMLButtonElement>('[data-role="skip"]')!;

  const close = (): void => {
    window.localStorage.setItem(SEEN_KEY, 'yes');
    overlay.remove();
  };

  const draw = (): void => {
    const slide = SLIDES[index];
    if (!slide) return;
    slideBox.innerHTML = renderSlide(slide);
    dots.innerHTML = SLIDES.map(
      (_, i) => `<span class="tut__dot"${i === index ? ' data-on="true"' : ''}></span>`,
    ).join('');
    nextButton.textContent = t(index === SLIDES.length - 1 ? 'action.start' : 'action.next');
  };

  nextButton.addEventListener('click', () => {
    if (index === SLIDES.length - 1) {
      close();
      return;
    }
    index += 1;
    draw();
  });
  skipButton.addEventListener('click', close);

  draw();
}
