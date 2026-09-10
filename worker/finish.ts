/**
 * 対局が終わったときの後始末。レートを計算して D1 に書き込む。
 */
import type { Color, GameResult } from '../src/core/index.ts';
import { INITIAL_RATING, ratePair, type Score } from './rating.ts';
import type { PlayerInfo } from './protocol.ts';
import type { Env } from './env.ts';

export interface FinishInput {
  readonly matchId: string;
  readonly players: Readonly<Record<Color, PlayerInfo>>;
  readonly result: GameResult;
  readonly moves: readonly string[];
  readonly maxChain: Readonly<Record<Color, number>>;
}

export interface FinishSummary {
  readonly ratingDelta: Record<Color, number>;
  readonly newRating: Record<Color, number>;
}

interface Row {
  rating: number;
  games: number;
}

/** 先手から見た結果を 1 / 0.5 / 0 にする。 */
export function scoreForSente(result: GameResult): Score {
  if (result.kind === 'draw') return 0.5;
  if (result.kind === 'win') return result.winner === 'sente' ? 1 : 0;
  return 0.5;
}

export async function finishMatch(env: Env, input: FinishInput): Promise<FinishSummary> {
  const { players, result } = input;

  const rows = await Promise.all(
    (['sente', 'gote'] as const).map(async (color) => {
      const row = await env.DB.prepare('SELECT rating, games FROM players WHERE id = ?')
        .bind(players[color].id)
        .first<Row>();
      return row ?? { rating: INITIAL_RATING, games: 0 };
    }),
  );
  const [senteRow, goteRow] = rows as [Row, Row];

  const score = scoreForSente(result);
  const change = ratePair(senteRow, goteRow, score);

  const outcome = (color: Color): { win: number; loss: number; draw: number } => {
    if (result.kind === 'draw') return { win: 0, loss: 0, draw: 1 };
    if (result.kind === 'win') {
      return result.winner === color
        ? { win: 1, loss: 0, draw: 0 }
        : { win: 0, loss: 1, draw: 0 };
    }
    return { win: 0, loss: 0, draw: 1 };
  };

  const now = Date.now();
  const winnerId =
    result.kind === 'win' ? players[result.winner].id : null;
  const reason = result.kind === 'playing' ? 'aborted' : result.reason;

  const updatePlayer = (color: Color) => {
    const { win, loss, draw } = outcome(color);
    const delta = color === 'sente' ? change.a.delta : change.b.delta;
    return env.DB.prepare(
      `UPDATE players
          SET rating = rating + ?,
              games = games + 1,
              wins = wins + ?,
              losses = losses + ?,
              draws = draws + ?,
              best_chain = MAX(best_chain, ?)
        WHERE id = ?`,
    ).bind(delta, win, loss, draw, input.maxChain[color], players[color].id);
  };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR REPLACE INTO matches
         (id, p1, p2, winner, reason, moves,
          rating_delta_p1, rating_delta_p2, max_chain_p1, max_chain_p2, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.matchId,
      players.sente.id,
      players.gote.id,
      winnerId,
      reason,
      input.moves.join(' '),
      change.a.delta,
      change.b.delta,
      input.maxChain.sente,
      input.maxChain.gote,
      now,
    ),
    updatePlayer('sente'),
    updatePlayer('gote'),
  ]);

  return {
    ratingDelta: { sente: change.a.delta, gote: change.b.delta },
    newRating: { sente: change.a.after, gote: change.b.after },
  };
}
