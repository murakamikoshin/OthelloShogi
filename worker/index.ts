/**
 * HTTP のルーター。
 *
 *   POST /api/players            プレイヤー登録（ログイン不要。ID と署名トークンを返す）
 *   GET  /api/players/me         自分の成績
 *   PUT  /api/players/me/name    名前の変更
 *   GET  /api/ranking            上位100位 + 自分の順位（60秒キャッシュ）
 *   GET  /api/lobby              マッチング待ち（WebSocket）
 *   GET  /api/match/:id          対局（WebSocket）
 */
import {
  DEFAULT_NAME,
  bearerToken,
  createPlayerId,
  issueToken,
  sanitizeName,
  verifyToken,
} from './auth.ts';
import { INITIAL_RATING, RANKED_MIN_GAMES } from './rating.ts';
import type { Env } from './env.ts';

export { MatchRoom } from './match.ts';
export { Lobby } from './lobby.ts';

/** ランキングをキャッシュしておく秒数。 */
const RANKING_CACHE_SECONDS = 60;

interface PlayerRow {
  id: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  best_chain: number;
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });

const fail = (status: number, message: string): Response => json({ error: message }, status);

/** トークンから本人を特定する。できなければ null。 */
async function authenticate(request: Request, env: Env): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) return null;
  return verifyToken(token, env.TOKEN_SECRET);
}

async function createPlayer(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const id = createPlayerId();
  const name = sanitizeName(body.name);

  await env.DB.prepare(
    'INSERT INTO players (id, name, rating, games, wins, losses, draws, best_chain, created_at)' +
      ' VALUES (?, ?, ?, 0, 0, 0, 0, 0, ?)',
  )
    .bind(id, name, INITIAL_RATING, Date.now())
    .run();

  return json({
    id,
    name,
    rating: INITIAL_RATING,
    // このトークンは localStorage に保存して、以降はこれで本人確認する
    token: await issueToken(id, env.TOKEN_SECRET),
  });
}

async function getMe(playerId: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT id, name, rating, games, wins, losses, draws, best_chain FROM players WHERE id = ?',
  )
    .bind(playerId)
    .first<PlayerRow>();
  if (!row) return fail(404, 'プレイヤーが見つかりません');

  const rank = await rankOf(row, env);
  return json({ ...row, rank, rankedMinGames: RANKED_MIN_GAMES });
}

/** ランキングに載る条件を満たしていれば順位を返す。満たしていなければ null。 */
async function rankOf(row: PlayerRow, env: Env): Promise<number | null> {
  if (row.games < RANKED_MIN_GAMES) return null;
  const above = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM players WHERE games >= ? AND rating > ?',
  )
    .bind(RANKED_MIN_GAMES, row.rating)
    .first<{ n: number }>();
  return (above?.n ?? 0) + 1;
}

async function renamePlayer(request: Request, playerId: string, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = sanitizeName(body.name);
  if (name === DEFAULT_NAME && typeof body.name === 'string' && body.name.trim() !== '') {
    return fail(400, '使えない名前です');
  }
  const result = await env.DB.prepare('UPDATE players SET name = ? WHERE id = ?')
    .bind(name, playerId)
    .run();
  if (!result.meta.changes) return fail(404, 'プレイヤーが見つかりません');
  return json({ name });
}

/**
 * ランキング。上位100位と、連鎖数の上位10位。
 * 10戦未満は載せない（レート操作対策）。60秒キャッシュする。
 */
async function getRanking(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const key = new Request(new URL('/api/ranking', request.url).toString(), { method: 'GET' });
  const cached = await cache.match(key);
  if (cached) return cached;

  const batched = await env.DB.batch<PlayerRow>([
    env.DB.prepare(
      'SELECT id, name, rating, games, wins, losses, draws, best_chain FROM players' +
        ' WHERE games >= ? ORDER BY rating DESC, games DESC LIMIT 100',
    ).bind(RANKED_MIN_GAMES),
    env.DB.prepare(
      'SELECT id, name, rating, games, wins, losses, draws, best_chain FROM players' +
        ' WHERE games >= ? AND best_chain > 0 ORDER BY best_chain DESC, rating DESC LIMIT 10',
    ).bind(RANKED_MIN_GAMES),
  ]);
  const byRating = batched[0]?.results ?? [];
  const byChain = batched[1]?.results ?? [];

  const response = Response.json(
    {
      rating: byRating.map((row, index) => ({ rank: index + 1, ...row })),
      chain: byChain.map((row, index) => ({ rank: index + 1, ...row })),
      minGames: RANKED_MIN_GAMES,
      generatedAt: Date.now(),
    },
    { headers: { 'Cache-Control': `public, max-age=${RANKING_CACHE_SECONDS}` } },
  );

  ctx.waitUntil(cache.put(key, response.clone()));
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

    try {
      if (path === '/api/players' && request.method === 'POST') {
        return await createPlayer(request, env);
      }

      if (path === '/api/ranking' && request.method === 'GET') {
        return await getRanking(request, env, ctx);
      }

      if (path === '/api/lobby') {
        // ロビーは1つだけ。全員が同じインスタンスに並ぶ
        const stub = env.LOBBY.get(env.LOBBY.idFromName('global'));
        return await stub.fetch(request);
      }

      const match = /^\/api\/match\/([\w-]+)$/.exec(path);
      if (match?.[1]) {
        const stub = env.MATCH.get(env.MATCH.idFromName(match[1]));
        return await stub.fetch(request);
      }

      // ここから先は本人確認が要る
      const playerId = await authenticate(request, env);
      if (!playerId) return fail(401, '認証できませんでした');

      if (path === '/api/players/me' && request.method === 'GET') {
        return await getMe(playerId, env);
      }
      if (path === '/api/players/me/name' && request.method === 'PUT') {
        return await renamePlayer(request, playerId, env);
      }

      return fail(404, 'そのようなエンドポイントはありません');
    } catch (error) {
      console.error('リクエストの処理に失敗', error);
      return fail(500, 'サーバ側でエラーが起きました');
    }
  },
} satisfies ExportedHandler<Env>;
