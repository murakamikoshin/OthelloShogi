/**
 * 多言語対応。
 *
 * 言語を増やすときは `src/i18n/<コード>.json` を1つ足すだけでよい。
 * ここでファイルを列挙していないので、コードを触る必要はない。
 */

/** Vite のグロブ読み込み。ファイルを足せば自動で候補に入る。 */
const MODULES = import.meta.glob<Record<string, string>>('./*.json', {
  eager: true,
  import: 'default',
});

const BUNDLES: Record<string, Record<string, string>> = {};
for (const [path, bundle] of Object.entries(MODULES)) {
  const code = path.replace(/^\.\//, '').replace(/\.json$/, '');
  BUNDLES[code] = bundle;
}

/** 用意されている言語コード。 */
export const LANGUAGES: readonly string[] = Object.keys(BUNDLES).sort();

/** 見つからない言語を指定されたときの言語。 */
const FALLBACK = 'ja';

const STORAGE_KEY = 'negaeri:lang';

let current = FALLBACK;

/** その言語の表示名。 */
export function languageName(lang: string): string {
  return BUNDLES[lang]?.['lang.name'] ?? lang;
}

/** 言語切り替えボタン用の短い表記（"JA" / "EN"）。言語が増えても幅が変わらない。 */
export function languageCode(lang: string): string {
  return lang.toUpperCase();
}

/** いまの言語。 */
export function getLang(): string {
  return current;
}

/** 日本語かどうか。駒にローマ字を重ねるかの判断に使う。 */
export function isJapanese(): boolean {
  return current === 'ja';
}

/**
 * 最初は navigator.language で自動判定し、以降は手動で選んだものを使う。
 */
export function initLang(): string {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved && BUNDLES[saved]) {
    current = saved;
    return current;
  }
  const preferred = [...(navigator.languages ?? []), navigator.language ?? ''];
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base && BUNDLES[base]) {
      current = base;
      return current;
    }
  }
  current = FALLBACK;
  return current;
}

export function setLang(lang: string): void {
  if (!BUNDLES[lang]) return;
  current = lang;
  window.localStorage.setItem(STORAGE_KEY, lang);
}

/** 次に切り替わる言語（まだ切り替えない）。ボタンのラベルに使う。 */
export function peekNextLang(): string {
  const index = LANGUAGES.indexOf(current);
  return LANGUAGES[(index + 1) % LANGUAGES.length] ?? FALLBACK;
}

/** 次の言語に切り替える（言語が2つならトグルになる）。 */
export function nextLang(): string {
  const next = peekNextLang();
  setLang(next);
  return next;
}

/**
 * 訳語を引く。`{name}` の部分を params で差し替える。
 * 訳が無ければ既定言語、それも無ければキーをそのまま返す（画面が空白にならないように）。
 */
export function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  const template = BUNDLES[current]?.[key] ?? BUNDLES[FALLBACK]?.[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** `data-i18n="キー"` が付いた要素の中身を差し替える。 */
export function applyTranslations(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key);
  }
  for (const element of root.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    const key = element.dataset.i18nLabel;
    if (key) element.setAttribute('aria-label', t(key));
  }
}
