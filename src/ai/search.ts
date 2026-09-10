/**
 * アルファベータ探索 + 反復深化。
 *
 * DOM も Worker API も参照しない純粋な TypeScript。
 * ブラウザでは Web Worker から、開発時は Node の自己対戦から、同じコードを呼ぶ。
 */
import type { GameState, Move } from '../core/index.ts';
import { applyMoveWithDetail, indexOf, legalMoves, previewDrop } from '../core/index.ts';
import { DEFAULT_WEIGHTS, MATE_SCORE, evaluate, type EvalWeights } from './evaluate.ts';

export interface SearchOptions {
  /** 読む深さ（反復深化の上限） */
  readonly depth: number;
  /** 打ち切り時間（ミリ秒）。超えたらそれまでの最善手を返す */
  readonly timeLimitMs?: number;
  /** 評価値に乗せる乱数の幅。弱いレベルを作るのに使う */
  readonly noise?: number;
  /** 乱数生成器（再現性のあるテストのために差し替えられる） */
  readonly random?: () => number;
  readonly weights?: EvalWeights;
}

export interface SearchResult {
  readonly move: Move | null;
  readonly score: number;
  /** 実際に読み切った深さ */
  readonly depth: number;
  readonly nodes: number;
  readonly elapsedMs: number;
}

/** 反復深化の途中で時間切れになったことを伝えるための例外。 */
class Timeout extends Error {}

interface Context {
  nodes: number;
  readonly deadline: number;
  readonly weights: EvalWeights;
  readonly random: () => number;
  readonly noise: number;
}

/**
 * 手の並べ替え。良さそうな手を先に見るほどアルファベータの枝刈りが効く。
 *
 * 既定の FLIP_DIRECTION_MODE='all8' では、どの駒種を打っても挟み判定の方向は同じ。
 * だから「そのマスに打つと何枚裏返るか」はマスごとに1回調べれば足りる
 * （駒種ごとに調べると3倍の無駄になる）。
 */
function orderedMoves(state: GameState): Move[] {
  const moves = legalMoves(state);
  if (moves.length === 0) return [{ kind: 'pass' }];

  const dropScoreBySquare = new Map<number, number>();
  const scoreOf = (move: Move): number => {
    switch (move.kind) {
      case 'move': {
        const target = state.board[indexOf(move.to)];
        if (!target) return 0;
        return target.type === 'K' ? 100_000 : 1_000;
      }
      case 'drop': {
        const key = indexOf(move.to);
        const cached = dropScoreBySquare.get(key);
        if (cached !== undefined) return cached;
        const preview = previewDrop(state, move.piece, move.to);
        const score = preview.flips.length * 300 + preview.chainCount * 100;
        dropScoreBySquare.set(key, score);
        return score;
      }
      default:
        return -1;
    }
  };

  return moves
    .map((move) => ({ move, score: scoreOf(move) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.move);
}

/** 決着している局面の点数。手数が浅いほど良い（＝早く勝つ手を選ぶ）。 */
function terminalScore(state: GameState, ply: number): number {
  const { result } = state;
  if (result.kind === 'win') {
    const sign = result.winner === 'sente' ? 1 : -1;
    return sign * (MATE_SCORE - ply);
  }
  return 0; // 引き分け
}

/**
 * ネガマックス（先手視点の評価値を手番の符号で反転して扱う）。
 * @returns 手番から見た点数
 */
function search(
  state: GameState,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  context: Context,
): number {
  const sign = state.turn === 'sente' ? 1 : -1;

  if (state.result.kind !== 'playing') return sign * terminalScore(state, ply);

  context.nodes += 1;
  if ((context.nodes & 0x3ff) === 0 && Date.now() > context.deadline) throw new Timeout();

  if (depth <= 0) {
    let score = sign * evaluate(state, context.weights);
    if (context.noise > 0) score += (context.random() * 2 - 1) * context.noise;
    return score;
  }

  let best = -Infinity;
  let localAlpha = alpha;

  for (const move of orderedMoves(state)) {
    const next = applyMoveWithDetail(state, move).state;
    const score = -search(next, depth - 1, -beta, -localAlpha, ply + 1, context);
    if (score > best) best = score;
    if (best > localAlpha) localAlpha = best;
    if (localAlpha >= beta) break; // ベータカット
  }

  return best;
}

/**
 * 最善手を探す。反復深化なので、時間切れになっても
 * 「1つ浅い深さまでで一番良かった手」を返せる。
 */
export function findBestMove(state: GameState, options: SearchOptions): SearchResult {
  const started = Date.now();
  const context: Context = {
    nodes: 0,
    deadline: started + (options.timeLimitMs ?? Number.POSITIVE_INFINITY),
    weights: options.weights ?? DEFAULT_WEIGHTS,
    random: options.random ?? Math.random,
    noise: options.noise ?? 0,
  };

  const rootMoves = orderedMoves(state);
  let bestMove: Move | null = rootMoves[0] ?? null;
  let bestScore = 0;
  let reachedDepth = 0;

  for (let depth = 1; depth <= options.depth; depth += 1) {
    let alpha = -Infinity;
    let currentBest: Move | null = null;
    let currentScore = -Infinity;

    try {
      for (const move of rootMoves) {
        const next = applyMoveWithDetail(state, move).state;
        const score = -search(next, depth - 1, -Infinity, -alpha, 1, context);
        if (score > currentScore) {
          currentScore = score;
          currentBest = move;
        }
        if (score > alpha) alpha = score;
      }
    } catch (error) {
      if (error instanceof Timeout) break;
      throw error;
    }

    if (currentBest) {
      bestMove = currentBest;
      bestScore = currentScore;
      reachedDepth = depth;
      // 次の深さでは、今回の最善手から読み始める
      rootMoves.splice(rootMoves.indexOf(currentBest), 1);
      rootMoves.unshift(currentBest);
    }

    // 勝ち／負けが確定したらそれ以上読む意味がない
    if (Math.abs(bestScore) > MATE_SCORE / 2) break;
    if (Date.now() > context.deadline) break;
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: reachedDepth,
    nodes: context.nodes,
    elapsedMs: Date.now() - started,
  };
}

/** 難易度の設定。 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY: Record<Difficulty, SearchOptions> = {
  easy: { depth: 2, noise: 260, timeLimitMs: 400 },
  normal: { depth: 4, timeLimitMs: 900 },
  hard: { depth: 6, timeLimitMs: 1500 },
};
