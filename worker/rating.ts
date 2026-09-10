/**
 * Elo レーティング。純粋関数なのでテストできる。
 */

/** 初期レート。 */
export const INITIAL_RATING = 1500;

/** ランキングに載せるのに必要な対局数（レート操作対策）。 */
export const RANKED_MIN_GAMES = 10;

/**
 * K値。対局数が少ないうちは大きく動かして、実力に早く近づける。
 */
export function kFactor(games: number): number {
  if (games < 30) return 40;
  if (games < 100) return 20;
  return 10;
}

/** 自分から見た期待勝率。 */
export function expectedScore(myRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - myRating) / 400));
}

/** 対局結果。1 = 勝ち、0.5 = 引き分け、0 = 負け。 */
export type Score = 0 | 0.5 | 1;

export interface RatingChange {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/** 1局ぶんのレート変動を求める。 */
export function applyRating(
  myRating: number,
  myGames: number,
  opponentRating: number,
  score: Score,
): RatingChange {
  const k = kFactor(myGames);
  const delta = Math.round(k * (score - expectedScore(myRating, opponentRating)));
  return { before: myRating, after: myRating + delta, delta };
}

/** 両者ぶんをまとめて求める。 */
export function ratePair(
  a: { readonly rating: number; readonly games: number },
  b: { readonly rating: number; readonly games: number },
  scoreA: Score,
): { readonly a: RatingChange; readonly b: RatingChange } {
  const scoreB = (1 - scoreA) as Score;
  return {
    // 相手のレートは「対局前」のものを使う。順に更新すると不公平になる
    a: applyRating(a.rating, a.games, b.rating, scoreA),
    b: applyRating(b.rating, b.games, a.rating, scoreB),
  };
}
