/**
 * 世界ランキングの表示。
 *
 * レート部門（上位100位）と最大連鎖数部門。
 * 10戦未満の人は載らないので、その場合は「あと何戦で載るか」を出す。
 */
import { t } from '../i18n/index.ts';
import { fetchMe, fetchRanking, type Identity } from './online.ts';

interface RankingRow {
  readonly rank: number;
  readonly id: string;
  readonly name: string;
  readonly rating: number;
  readonly games: number;
  readonly wins: number;
  readonly losses: number;
  readonly best_chain: number;
}

interface RankingResponse {
  readonly rating: readonly RankingRow[];
  readonly chain: readonly RankingRow[];
  readonly minGames: number;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderRows(
  rows: readonly RankingRow[],
  meId: string | null,
  value: (row: RankingRow) => string,
): string {
  if (rows.length === 0) return `<p class="rank__empty">${t('ranking.empty')}</p>`;
  return `<ol class="rank__list">${rows
    .map(
      (row) =>
        `<li class="rank__row"${row.id === meId ? ' data-me="true"' : ''}>` +
        `<span class="rank__no">${row.rank}</span>` +
        `<span class="rank__name">${escapeHtml(row.name)}</span>` +
        `<span class="rank__value">${value(row)}</span>` +
        `</li>`,
    )
    .join('')}</ol>`;
}

/** ランキングを開く。 */
export async function showRanking(identity: Identity | null): Promise<void> {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay__card rank__card">
      <p class="overlay__title">${t('ranking.title')}</p>
      <div class="rank__tabs">
        <button class="rank__tab" data-tab="rating" aria-pressed="true">${t('ranking.byRating')}</button>
        <button class="rank__tab" data-tab="chain" aria-pressed="false">${t('ranking.byChain')}</button>
      </div>
      <div class="rank__body" data-role="body">${t('ranking.loading')}</div>
      <p class="rank__me" data-role="me"></p>
      <button data-role="close">${t('action.close')}</button>
    </div>
  `;
  document.body.append(overlay);

  const body = overlay.querySelector<HTMLElement>('[data-role="body"]')!;
  const me = overlay.querySelector<HTMLElement>('[data-role="me"]')!;
  overlay.querySelector('[data-role="close"]')!.addEventListener('click', () => overlay.remove());

  let data: RankingResponse | null = null;
  let tab: 'rating' | 'chain' = 'rating';

  const draw = (): void => {
    if (!data) return;
    body.innerHTML =
      tab === 'rating'
        ? renderRows(data.rating, identity?.id ?? null, (row) => `${row.rating}`)
        : renderRows(data.chain, identity?.id ?? null, (row) =>
            t('chain.badge', { count: row.best_chain }),
          );
    for (const button of overlay.querySelectorAll<HTMLButtonElement>('.rank__tab')) {
      button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    }
  };

  for (const button of overlay.querySelectorAll<HTMLButtonElement>('.rank__tab')) {
    button.addEventListener('click', () => {
      tab = button.dataset.tab === 'chain' ? 'chain' : 'rating';
      draw();
    });
  }

  try {
    data = (await fetchRanking()) as RankingResponse;
    draw();
  } catch {
    body.textContent = t('ranking.failed');
    return;
  }

  if (!identity) {
    me.textContent = t('ranking.needOnline');
    return;
  }

  try {
    const stats = await fetchMe(identity);
    me.textContent =
      stats.rank === null
        ? t('ranking.notRanked', {
            rating: stats.rating,
            remaining: Math.max(0, (data?.minGames ?? 10) - stats.games),
          })
        : t('ranking.yourRank', { rank: stats.rank, rating: stats.rating });
  } catch {
    me.textContent = '';
  }
}
