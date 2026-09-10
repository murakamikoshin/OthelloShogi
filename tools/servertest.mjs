/**
 * オンライン対戦の通しテスト。実際にサーバへつないで確かめる。
 *
 *   npx wrangler dev --port 8788 --local        （別のターミナルで起動）
 *   npx wrangler d1 execute negaeri --file=worker/schema.sql --local
 *   npm run servertest
 *
 * 確かめること:
 *   - 登録してトークンがもらえる
 *   - 2人がマッチングして同じ対局に入る
 *   - 不正な手はサーバが弾いて反則負けになる
 *   - 正常な対局が長手数でもサーバとクライアントでずれない
 *   - 投了で決着し、レートが正しく増減して D1 に残る
 */
import { initialGameState, applyMoveWithDetail, parseMove } from '../src/core/index.ts';
import { findBestMove } from '../src/ai/search.ts';

const BASE = process.argv[2] ?? 'http://localhost:8788';
const WS = BASE.replace(/^http/, 'ws');

const problems = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '  ok' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (期待: ${JSON.stringify(expected)})`}`);
  if (!ok) problems.push(label);
};
const note = (text) => console.log(`      ${text}`);

const register = async (name) =>
  (await fetch(`${BASE}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })).json();

const openSocket = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => resolve(socket));
    socket.addEventListener('error', reject);
  });

const waitFor = (socket, type, ms = 20000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`"${type}" 待ちでタイムアウト`)), ms);
    const on = (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== type) return;
      clearTimeout(timer);
      socket.removeEventListener('message', on);
      resolve(message);
    };
    socket.addEventListener('message', on);
  });

/** 2人を登録してマッチングさせ、対局の WebSocket を開くところまで。 */
async function seatTwoPlayers(nameA, nameB) {
  const a = await register(nameA);
  const b = await register(nameB);
  const [la, lb] = await Promise.all([openSocket(`${WS}/api/lobby`), openSocket(`${WS}/api/lobby`)]);
  const pa = waitFor(la, 'matched');
  const pb = waitFor(lb, 'matched');
  la.send(JSON.stringify({ type: 'queue', token: a.token }));
  lb.send(JSON.stringify({ type: 'queue', token: b.token }));
  const [ma, mb] = await Promise.all([pa, pb]);
  check('2人が同じ対局に入る', ma.matchId === mb.matchId, true);
  check('先後が別々に割り当てられる', ma.color !== mb.color, true);
  la.close();
  lb.close();

  const seats = {};
  for (const [player, info] of [[a, ma], [b, mb]]) {
    const socket = await openSocket(`${WS}/api/match/${info.matchId}`);
    const sync = waitFor(socket, 'sync');
    socket.send(JSON.stringify({ type: 'join', token: player.token }));
    const state = await sync;
    seats[state.you] = { socket, player, clock: state.clock };
  }
  check('持ち時間は3分から始まる', seats.sente.clock.gote, 180000);
  return { a, b, seats };
}

// ---------------------------------------------------------------------------
console.log('■ 不正な手はサーバが弾く');
{
  const { seats } = await seatTwoPlayers('反則するひと', '待つひと');
  const rejected = waitFor(seats.sente.socket, 'error');
  const over = waitFor(seats.gote.socket, 'over');
  // 相手の駒を動かそうとする
  seats.sente.socket.send(
    JSON.stringify({
      type: 'move',
      move: { kind: 'move', from: { row: 1, col: 3 }, to: { row: 2, col: 3 } },
    }),
  );
  note(`サーバの返答: ${(await rejected).message}`);
  const result = await over;
  check('反則した側の負けになる', result.result, {
    kind: 'win',
    winner: 'gote',
    reason: 'illegal_move',
  });
  check('レート変動が釣り合う', result.ratingDelta.sente + result.ratingDelta.gote, 0);
  for (const seat of Object.values(seats)) seat.socket.close();
}

// ---------------------------------------------------------------------------
console.log('■ 対局を進めても局面がずれない');
{
  const { a, b, seats } = await seatTwoPlayers('あかり', 'ぼたん');

  let state = initialGameState();
  let over = null;
  let plies = 0;
  let maxChain = 0;
  const pending = [];
  seats.sente.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'moved') {
      // サーバの着手通知だけを頼りに、こちらでも同じルールで局面を進める
      state = applyMoveWithDetail(state, parseMove(message.move)).state;
      plies += 1;
      maxChain = Math.max(maxChain, message.chainCount);
    } else if (message.type === 'over') {
      over = message;
    } else if (message.type === 'error') {
      problems.push(`対局中のエラー: ${message.message}`);
    }
    pending.shift()?.();
  });

  while (!over && plies < 40) {
    const found = findBestMove(state, { depth: 2, timeLimitMs: 400, noise: 40 });
    const advanced = new Promise((resolve) => pending.push(resolve));
    seats[state.turn].socket.send(
      JSON.stringify({ type: 'move', move: found.move ?? { kind: 'pass' } }),
    );
    await Promise.race([advanced, new Promise((resolve) => setTimeout(resolve, 8000))]);
  }
  check('40手ずれずに進む', plies, 40);
  note(`この対局の最大連鎖: ${maxChain}`);

  if (!over) {
    const done = waitFor(seats.sente.socket, 'over');
    seats.gote.socket.send(JSON.stringify({ type: 'resign' }));
    over = await done;
  }
  check('投了で決着する', over.result, { kind: 'win', winner: 'sente', reason: 'resign' });
  check('レート変動が釣り合う', over.ratingDelta.sente + over.ratingDelta.gote, 0);

  const [sente, gote] = await Promise.all(
    [a, b].map(async (player) =>
      (await fetch(`${BASE}/api/players/me`, {
        headers: { Authorization: `Bearer ${player.token}` },
      })).json(),
    ),
  );
  check('勝った側のレートが上がって D1 に残る', sente.rating > 1500, true);
  check('負けた側のレートが下がって D1 に残る', gote.rating < 1500, true);
  check('10戦未満はランキングに載せない', sente.rank, null);
  note(`${sente.name} ${sente.rating} / ${gote.name} ${gote.rating}`);

  for (const seat of Object.values(seats)) seat.socket.close();
}

// ---------------------------------------------------------------------------
console.log('■ 認証');
{
  const bad = await fetch(`${BASE}/api/players/me`, {
    // HTTP ヘッダは ASCII しか通らないので、偽トークンも ASCII で作る
    headers: { Authorization: 'Bearer 00000000-0000-0000-0000-000000000000.notavalidsignature' },
  });
  check('偽のトークンは通らない', bad.status, 401);
  const none = await fetch(`${BASE}/api/players/me`);
  check('トークンなしも通らない', none.status, 401);
}

console.log('■ ランキング');
{
  const ranking = await (await fetch(`${BASE}/api/ranking`)).json();
  check('10戦以上という条件が返る', ranking.minGames, 10);
  check('レート部門と連鎖部門がある', Array.isArray(ranking.rating) && Array.isArray(ranking.chain), true);
}

if (problems.length > 0) {
  console.error('\n問題:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('\nすべて OK');
process.exit(0);
