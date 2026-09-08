/**
 * 局面の遷移と勝敗判定。
 *
 * GameState は immutable。applyMove は必ず新しい GameState を返す。
 */
import type {
  Board,
  Color,
  DrawReason,
  GameResult,
  GameState,
  Hands,
  Move,
  MoveOutcome,
  Piece,
  Pos,
  Square,
  WinReason,
} from './types.ts';
import {
  countPieces,
  emptyBoard,
  emptyHand,
  handWithAdded,
  handWithRemoved,
  indexOf,
  isDroppableType,
  isInsidePos,
  lastRankFor,
  opponentOf,
  pieceAt,
  positionKey,
  samePos,
  unpromote,
} from './board.ts';
import { computeFlips, flipPiece } from './flip.ts';
import { destinationsFrom, generateMoves } from './moves.ts';

/** 同一局面がこの回数出現したら駒数判定で決着。 */
export const REPETITION_LIMIT = 4;

/** 両者が連続でこの回数パスしたら駒数判定で決着。 */
export const PASS_LIMIT = 2;

const PLAYING: GameResult = { kind: 'playing' };

// ---------------------------------------------------------------------------
// 初期局面
// ---------------------------------------------------------------------------

/** 初期盤面。先手: 玉(5,2) 歩(4,2) / 後手: 玉(0,3) 歩(1,3) */
export function initialBoard(): Board {
  const board = emptyBoard().slice();
  const place = (row: number, col: number, piece: Piece): void => {
    board[indexOf({ row, col })] = piece;
  };
  place(5, 2, { type: 'K', owner: 'sente' });
  place(4, 2, { type: 'P', owner: 'sente' });
  place(0, 3, { type: 'K', owner: 'gote' });
  place(1, 3, { type: 'P', owner: 'gote' });
  return board;
}

/** 初期持ち駒。両者とも 歩3・飛1・角1。 */
export function initialHands(): Hands {
  return {
    sente: { ...emptyHand(), P: 3, R: 1, B: 1 },
    gote: { ...emptyHand(), P: 3, R: 1, B: 1 },
  };
}

/** 初期局面。 */
export function initialGameState(): GameState {
  const board = initialBoard();
  const hands = initialHands();
  const turn: Color = 'sente';
  return {
    board,
    hands,
    turn,
    ply: 0,
    consecutivePasses: 0,
    repetition: { [positionKey(board, hands, turn)]: 1 },
    result: PLAYING,
  };
}

/** 任意の局面を組み立てる（テスト・CLI・詰め局面の再現用）。 */
export function createGameState(params: {
  board: Board;
  hands?: Hands;
  turn?: Color;
  ply?: number;
  consecutivePasses?: number;
  result?: GameResult;
}): GameState {
  const board = params.board;
  const hands = params.hands ?? { sente: emptyHand(), gote: emptyHand() };
  const turn = params.turn ?? 'sente';
  return {
    board,
    hands,
    turn,
    ply: params.ply ?? 0,
    consecutivePasses: params.consecutivePasses ?? 0,
    repetition: { [positionKey(board, hands, turn)]: 1 },
    result: params.result ?? PLAYING,
  };
}

// ---------------------------------------------------------------------------
// 合法手
// ---------------------------------------------------------------------------

/** その局面の合法手を全て返す（パスは含まない）。対局が終わっていれば空配列。 */
export function legalMoves(state: GameState): Move[] {
  if (state.result.kind !== 'playing') return [];
  return generateMoves(state.board, state.hands, state.turn);
}

/** 合法手が1つも無い（＝パスするしかない）かどうか。 */
export function mustPass(state: GameState): boolean {
  return state.result.kind === 'playing' && legalMoves(state).length === 0;
}

/**
 * その手が合法かどうか。
 * サーバは受け取った手を必ずこれで検証すること（クライアントの申告を信用しない）。
 */
export function isLegalMove(state: GameState, move: Move): boolean {
  return validateMove(state, move) === null;
}

/**
 * 合法でなければ理由を、合法なら null を返す。
 */
export function validateMove(state: GameState, move: Move): string | null {
  if (state.result.kind !== 'playing') return '対局は既に終了しています';

  const { board, hands, turn } = state;

  if (move.kind === 'pass') {
    return mustPass(state) ? null : '合法手があるためパスできません';
  }

  if (move.kind === 'drop') {
    if (!isInsidePos(move.to)) return '盤外には打てません';
    if (hands[turn][move.piece] <= 0) return 'その持ち駒はありません';
    if (pieceAt(board, move.to) !== null) return '空マスにしか打てません';
    if (move.piece === 'P' && move.to.row === lastRankFor(turn)) {
      return '歩は最終段に打てません';
    }
    return null;
  }

  if (!isInsidePos(move.from) || !isInsidePos(move.to)) return '盤外の座標です';
  const piece = pieceAt(board, move.from);
  if (!piece) return '動かす駒がありません';
  if (piece.owner !== turn) return '相手の駒は動かせません';
  const reachable = destinationsFrom(board, move.from).some((pos) => samePos(pos, move.to));
  if (!reachable) return 'その駒はそのマスへ動けません';
  return null;
}

// ---------------------------------------------------------------------------
// 勝敗判定
// ---------------------------------------------------------------------------

/** 盤上の駒数で決着させる（多い方の勝ち、同数なら引き分け）。 */
export function resultByPieceCount(board: Board, reason: DrawReason): GameResult {
  const counts = countPieces(board);
  if (counts.sente > counts.gote) return { kind: 'win', winner: 'sente', reason };
  if (counts.gote > counts.sente) return { kind: 'win', winner: 'gote', reason };
  return { kind: 'draw', reason };
}

/** 投了。負ける側の色を渡す。 */
export function resign(state: GameState, loser: Color): GameState {
  return finish(state, { kind: 'win', winner: opponentOf(loser), reason: 'resign' });
}

/** 時間切れ。時間を使い切った側の色を渡す。 */
export function timeout(state: GameState, loser: Color): GameState {
  return finish(state, { kind: 'win', winner: opponentOf(loser), reason: 'timeout' });
}

/** 反則負け。サーバが不正な手を検出したときに使う。 */
export function forfeit(state: GameState, offender: Color): GameState {
  return finish(state, { kind: 'win', winner: opponentOf(offender), reason: 'illegal_move' });
}

function finish(state: GameState, result: GameResult): GameState {
  return { ...state, result };
}

// ---------------------------------------------------------------------------
// 手の適用
// ---------------------------------------------------------------------------

/** 手を適用して次の局面を返す。不正な手なら例外を投げる。 */
export function applyMove(state: GameState, move: Move): GameState {
  return applyMoveWithDetail(state, move).state;
}

/** 手を適用し、反転したマスや取った駒も含めて返す。 */
export function applyMoveWithDetail(state: GameState, move: Move): MoveOutcome {
  const error = validateMove(state, move);
  if (error) throw new Error(`不正な手: ${error}`);

  switch (move.kind) {
    case 'pass':
      return applyPass(state);
    case 'drop':
      return applyDrop(state, move.piece, move.to);
    case 'move':
      return applyBoardMove(state, move.from, move.to);
    default: {
      const never: never = move;
      throw new Error(`未知の手: ${JSON.stringify(never)}`);
    }
  }
}

function applyPass(state: GameState): MoveOutcome {
  const consecutivePasses = state.consecutivePasses + 1;
  const base: GameState = {
    ...state,
    turn: opponentOf(state.turn),
    ply: state.ply + 1,
    consecutivePasses,
  };

  if (consecutivePasses >= PASS_LIMIT) {
    // 両者が連続でパス → 盤上の駒数が多い方の勝ち
    return { state: finish(base, resultByPieceCount(state.board, 'pass_count')), flips: [], captured: null };
  }
  return { state: registerPosition(base), flips: [], captured: null };
}

function applyDrop(state: GameState, piece: 'P' | 'R' | 'B', to: Pos): MoveOutcome {
  const color = state.turn;
  const flips = computeFlips(state.board, to, piece, color);

  const board = state.board.slice();
  board[indexOf(to)] = { type: piece, owner: color }; // 打つときは常に不成
  for (const pos of flips) {
    const target = board[indexOf(pos)];
    if (!target) continue;
    board[indexOf(pos)] = flipPiece(target, color);
  }

  const hands = handWithRemoved(state.hands, color, piece);
  const next: GameState = {
    ...state,
    board,
    hands,
    turn: opponentOf(color),
    ply: state.ply + 1,
    consecutivePasses: 0,
  };

  return { state: registerPosition(next), flips, captured: null };
}

function applyBoardMove(state: GameState, from: Pos, to: Pos): MoveOutcome {
  const color = state.turn;
  const moving = pieceAt(state.board, from);
  if (!moving) throw new Error('動かす駒がありません');

  const captured: Square = pieceAt(state.board, to);

  const board = state.board.slice();
  board[indexOf(from)] = null;
  // 移動による成りは無い。駒はそのままの状態で移動する。
  board[indexOf(to)] = moving;

  let hands = state.hands;
  if (captured) {
    // 玉を取ったら勝ち。持ち駒には入らない。
    if (captured.type === 'K') {
      const finished: GameState = {
        ...state,
        board,
        turn: opponentOf(color),
        ply: state.ply + 1,
        consecutivePasses: 0,
        result: { kind: 'win', winner: color, reason: 'king_captured' } satisfies GameResult,
      };
      return { state: finished, flips: [], captured };
    }
    const base = unpromote(captured.type); // 成駒は不成に戻る
    if (!isDroppableType(base)) throw new Error(`持ち駒にできない駒: ${captured.type}`);
    hands = handWithAdded(hands, color, base);
  }

  const next: GameState = {
    ...state,
    board,
    hands,
    turn: opponentOf(color),
    ply: state.ply + 1,
    consecutivePasses: 0,
  };

  // 「動かす」では反転しない
  return { state: registerPosition(next), flips: [], captured };
}

/**
 * 局面を千日手カウンタに登録し、規定回数に達していたら駒数判定で決着させる。
 */
function registerPosition(state: GameState): GameState {
  const key = positionKey(state.board, state.hands, state.turn);
  const count = (state.repetition[key] ?? 0) + 1;
  const repetition = { ...state.repetition, [key]: count };
  const withRepetition: GameState = { ...state, repetition };

  if (count >= REPETITION_LIMIT) {
    return finish(withRepetition, resultByPieceCount(state.board, 'repetition_count'));
  }
  return withRepetition;
}

// ---------------------------------------------------------------------------
// 参照用ヘルパー
// ---------------------------------------------------------------------------

/** 打つ前のプレビュー用。この手を打ったら裏返るマスを返す。 */
export function previewFlips(state: GameState, piece: 'P' | 'R' | 'B', to: Pos): Pos[] {
  if (state.result.kind !== 'playing') return [];
  if (pieceAt(state.board, to) !== null) return [];
  return computeFlips(state.board, to, piece, state.turn);
}

/** 対局が終わっているか。 */
export function isGameOver(state: GameState): boolean {
  return state.result.kind !== 'playing';
}

export type { WinReason, DrawReason };
