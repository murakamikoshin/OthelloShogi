-- Cloudflare D1（SQLite）のスキーマ
--
--   npx wrangler d1 execute negaeri --file=worker/schema.sql --local
--   npx wrangler d1 execute negaeri --file=worker/schema.sql --remote

CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rating      INTEGER NOT NULL DEFAULT 1500,
  games       INTEGER NOT NULL DEFAULT 0,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  draws       INTEGER NOT NULL DEFAULT 0,
  -- 1局での最大連鎖数の自己ベスト（連鎖数のランキング用）
  best_chain  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
  id              TEXT PRIMARY KEY,
  p1              TEXT NOT NULL,
  p2              TEXT NOT NULL,
  -- 勝者のプレイヤー ID。引き分けは NULL
  winner          TEXT,
  reason          TEXT NOT NULL,
  -- 棋譜（"R*30 B*21 ..." のような空白区切り）
  moves           TEXT NOT NULL,
  rating_delta_p1 INTEGER NOT NULL,
  rating_delta_p2 INTEGER NOT NULL,
  max_chain_p1    INTEGER NOT NULL DEFAULT 0,
  max_chain_p2    INTEGER NOT NULL DEFAULT 0,
  ended_at        INTEGER NOT NULL
);

-- ランキング（10戦以上のみ）を引くため
CREATE INDEX IF NOT EXISTS idx_players_rating ON players (rating DESC, games DESC);
CREATE INDEX IF NOT EXISTS idx_players_best_chain ON players (best_chain DESC);
-- 対局履歴を新しい順に引くため
CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches (ended_at DESC);
