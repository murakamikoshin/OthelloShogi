/**
 * 評価関数。局面を「先手から見た点数」で返す（正なら先手有利）。
 *
 * 評価項目（追加仕様 v2 §2.3 を含む）:
 *   - 駒の価値（盤上 + 持ち駒）
 *   - 盤上の枚数差（パスや千日手のときの決着条件そのもの）
 *   - 玉の安全度（王手放置が合法なので、玉が取られる形は致命的）
 *   - 利きの数（動ける手の多さ）
 *   - 次の手番で作れる最大の反転枚数（プラス）／相手に許す反転枚数（マイナス）
 */
import type { Board, Color, GameState, PieceType, Pos } from '../core/index.ts';
import {
  BOARD_SIZE,
  SQUARE_COUNT,
  destinationsFrom,
  findKing,
  indexOf,
  isInside,
  mayFlipAt,
  posOf,
  simulateDrop,
} from '../core/index.ts';

/** 玉を取られたら決着なので、他のどの評価値よりも大きくしておく。 */
export const MATE_SCORE = 1_000_000;

const PIECE_VALUE: Record<PieceType, number> = {
  K: 0, // 玉の価値は勝敗そのものなので、駒割には含めない
  P: 100,
  R: 520,
  B: 480,
  '+P': 320,
  '+R': 720,
  '+B': 680,
};

/** 持ち駒は打てる自由度があるぶん、盤上より少しだけ高く見る。 */
const HAND_VALUE = { P: 115, R: 545, B: 505 } as const;

export interface EvalWeights {
  /** 盤上の枚数差1枚あたり */
  readonly pieceCount: number;
  /** 動ける手1つあたり */
  readonly mobility: number;
  /** 玉の周りの自分の駒1枚あたり */
  readonly kingShield: number;
  /** 玉が相手の利きに入っているときの減点 */
  readonly kingAttacked: number;
  /** 次に作れる反転1枚あたり */
  readonly flipPotential: number;
  /** 相手に許す反転1枚あたり */
  readonly flipRisk: number;
}

export const DEFAULT_WEIGHTS: EvalWeights = {
  pieceCount: 22,
  mobility: 4,
  kingShield: 14,
  kingAttacked: 420,
  flipPotential: 26,
  flipRisk: 20,
};

interface Coverage {
  readonly mobility: number;
  readonly attacked: ReadonlySet<number>;
}

/**
 * その色の全ての駒の利きを1回で集計する。
 * 「どこを狙っているか」と「何手指せるか」を同時に数えたいので、
 * core の isAttacked（1マスずつ調べる）ではなくここでまとめて求めている。
 */
function coverageOf(board: Board, color: Color): Coverage {
  const attacked = new Set<number>();
  let mobility = 0;
  for (let index = 0; index < SQUARE_COUNT; index += 1) {
    const square = board[index];
    if (!square || square.owner !== color) continue;
    for (const to of destinationsFrom(board, posOf(index))) {
      mobility += 1;
      attacked.add(indexOf(to));
    }
  }
  return { mobility, attacked };
}

/** 玉の周りにいる自分の駒の枚数。 */
function shieldCount(board: Board, king: Pos, color: Color): number {
  let count = 0;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const row = king.row + dr;
      const col = king.col + dc;
      if (!isInside(row, col)) continue;
      const square = board[row * BOARD_SIZE + col];
      if (square && square.owner === color) count += 1;
    }
  }
  return count;
}

/**
 * その色が次に1手打ったときに作れる、最大の反転枚数。
 *
 * 既定の FLIP_DIRECTION_MODE='all8' では、どの駒種を打っても挟み判定の方向は同じなので、
 * マスごとに1回だけ調べれば足りる。
 */
export function bestDropGain(state: GameState, color: Color): number {
  const hand = state.hands[color];
  const piece = hand.P > 0 ? 'P' : hand.R > 0 ? 'R' : hand.B > 0 ? 'B' : null;
  if (!piece) return 0;

  let best = 0;
  for (let index = 0; index < SQUARE_COUNT; index += 1) {
    if (state.board[index]) continue;
    const pos = posOf(index);
    // 隣に相手の駒が無いマスは調べるだけ無駄
    if (!mayFlipAt(state.board, pos, color)) continue;
    const gain = simulateDrop(state.board, pos, piece, color).flips.length;
    if (gain > best) best = gain;
  }
  return best;
}

/** 先手から見た評価値。 */
export function evaluate(
  state: GameState,
  weights: EvalWeights = DEFAULT_WEIGHTS,
  includeFlipPotential = true,
): number {
  const { board } = state;
  let score = 0;
  let senteCount = 0;
  let goteCount = 0;

  for (let index = 0; index < SQUARE_COUNT; index += 1) {
    const square = board[index];
    if (!square) continue;
    const value = PIECE_VALUE[square.type];
    if (square.owner === 'sente') {
      score += value;
      senteCount += 1;
    } else {
      score -= value;
      goteCount += 1;
    }
  }

  for (const piece of ['P', 'R', 'B'] as const) {
    score += state.hands.sente[piece] * HAND_VALUE[piece];
    score -= state.hands.gote[piece] * HAND_VALUE[piece];
  }

  score += (senteCount - goteCount) * weights.pieceCount;

  const sente = coverageOf(board, 'sente');
  const gote = coverageOf(board, 'gote');
  score += (sente.mobility - gote.mobility) * weights.mobility;

  const senteKing = findKing(board, 'sente');
  const goteKing = findKing(board, 'gote');
  if (senteKing) {
    score += shieldCount(board, senteKing, 'sente') * weights.kingShield;
    if (gote.attacked.has(indexOf(senteKing))) score -= weights.kingAttacked;
  }
  if (goteKing) {
    score -= shieldCount(board, goteKing, 'gote') * weights.kingShield;
    if (sente.attacked.has(indexOf(goteKing))) score += weights.kingAttacked;
  }

  if (includeFlipPotential) {
    // 手番の側は「次に作れる連鎖」を活かせる。相手のそれは脅威。
    const mover = state.turn;
    const gain = bestDropGain(state, mover);
    const risk = bestDropGain(state, mover === 'sente' ? 'gote' : 'sente');
    const sign = mover === 'sente' ? 1 : -1;
    score += sign * gain * weights.flipPotential;
    score -= sign * risk * weights.flipRisk;
  }

  return score;
}
