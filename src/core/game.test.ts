/**
 * 局面遷移と勝敗判定のテスト。仕様書 3.2 / 3.5 が対象。
 */
import { describe, expect, it } from 'vitest';
import {
  applyMove,
  applyMoveWithDetail,
  initialGameState,
  isLegalMove,
  legalMoves,
  mustPass,
  resign,
  timeout,
  validateMove,
} from './game.ts';
import { countPieces, findKing, findPieces, pieceAt, samePos } from './board.ts';
import { destinationsFrom } from './moves.ts';
import { BOARD_SIZE, INITIAL_HAND, INITIAL_SETUP } from './rules.ts';
import { at, board, hands, pieceOn, state } from './test-helpers.ts';

describe('初期局面', () => {
  it('INITIAL_SETUP どおりに並び、後手は点対称に置かれる', () => {
    const s = initialGameState();

    for (const { row, col, type } of INITIAL_SETUP) {
      expect(pieceOn(s.board, row, col)).toEqual({ type, owner: 'sente' });
      expect(pieceOn(s.board, BOARD_SIZE - 1 - row, BOARD_SIZE - 1 - col)).toEqual({
        type,
        owner: 'gote',
      });
    }

    const total = INITIAL_SETUP.length;
    expect(countPieces(s.board)).toEqual({ sente: total, gote: total });
    expect(s.hands.sente).toEqual(INITIAL_HAND);
    expect(s.hands.gote).toEqual(INITIAL_HAND);
    expect(s.turn).toBe('sente');
    expect(s.result.kind).toBe('playing');
  });

  it('開始局面ではどちらの玉にも王手がかかっていない', () => {
    // 盤が空だと1手目に飛を打つだけで王手がかかってしまうので、その回帰テスト
    const s = initialGameState();
    for (const color of ['sente', 'gote'] as const) {
      const king = findKing(s.board, color);
      expect(king).not.toBeNull();
      const foe = color === 'sente' ? 'gote' : 'sente';
      const attacked = findPieces(s.board, foe).some((from) =>
        destinationsFrom(s.board, from).some((to) => king !== null && samePos(to, king)),
      );
      expect(attacked).toBe(false);
    }
  });

  it('局面は immutable（applyMove は元の局面を変えない）', () => {
    const s = initialGameState();
    const before = s.board.slice();
    const next = applyMove(s, { kind: 'drop', piece: 'P', to: at(3, 2) });
    expect(s.board).toEqual(before);
    expect(s.hands.sente.P).toBe(INITIAL_HAND.P);
    expect(next.hands.sente.P).toBe(INITIAL_HAND.P - 1);
    expect(next.turn).toBe('gote');
  });
});

describe('手の検証', () => {
  const s = initialGameState();

  it('持っていない駒は打てない', () => {
    const empty = state({ board: s.board, hands: hands(), turn: 'sente' });
    expect(validateMove(empty, { kind: 'drop', piece: 'R', to: at(3, 3) })).toMatch(/持ち駒/);
  });

  it('駒があるマスには打てない', () => {
    expect(validateMove(s, { kind: 'drop', piece: 'P', to: at(5, 2) })).toMatch(/空マス/);
  });

  it('相手の駒は動かせない', () => {
    expect(validateMove(s, { kind: 'move', from: at(1, 3), to: at(2, 3) })).toMatch(/相手の駒/);
  });

  it('動けないマスへの移動は弾く', () => {
    expect(validateMove(s, { kind: 'move', from: at(4, 2), to: at(0, 0) })).toMatch(/動けません/);
  });

  it('合法な手は null を返す', () => {
    expect(validateMove(s, { kind: 'move', from: at(4, 2), to: at(3, 2) })).toBeNull();
    expect(isLegalMove(s, { kind: 'drop', piece: 'B', to: at(3, 3) })).toBe(true);
  });

  it('不正な手を applyMove に渡すと例外', () => {
    expect(() => applyMove(s, { kind: 'move', from: at(0, 0), to: at(1, 1) })).toThrow();
  });
});

describe('駒を取る', () => {
  it('取った駒は持ち駒になり、成駒は不成に戻る', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  . +r  .  .  .', // 後手の竜
        '.  .  R  .  .  .', // 先手の飛で取る
        '.  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(),
      turn: 'sente',
    });

    const { state: next, captured } = applyMoveWithDetail(s, {
      kind: 'move',
      from: at(3, 2),
      to: at(2, 2),
    });

    expect(captured).toEqual({ type: '+R', owner: 'gote' });
    expect(next.hands.sente.R).toBe(1);
    expect(pieceOn(next.board, 2, 2)).toEqual({ type: 'R', owner: 'sente' });
    expect(pieceAt(next.board, at(3, 2))).toBeNull();
  });

  it('玉を取ったら決着する（玉は持ち駒にならない）', () => {
    const s = state({
      board: board(
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        'k  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        'R  .  K  .  .  .',
      ),
      hands: hands(),
      turn: 'sente',
    });

    const next = applyMove(s, { kind: 'move', from: at(5, 0), to: at(2, 0) });
    expect(next.result).toEqual({ kind: 'win', winner: 'sente', reason: 'king_captured' });
    expect(next.hands.sente).toEqual({ P: 0, R: 0, B: 0 });
  });

  it('王手放置は合法（詰み判定はしない）', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  r  .  .  .', // 先手の玉に王手がかかっている
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  K  P  .  .',
      ),
      hands: hands(),
      turn: 'sente',
    });

    // 玉を逃がさず、関係ない歩を動かす手も合法
    expect(isLegalMove(s, { kind: 'move', from: at(5, 3), to: at(4, 3) })).toBe(true);
  });
});

describe('パス', () => {
  /** 先手も後手も動かせる駒が無い局面（歩は最終段に進めないため詰まっている）。 */
  const stuck = state({
    board: board(
      '.  .  .  .  .  .',
      'P  .  .  .  .  .', // 先手の歩：row0 へ進めない
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  p  p  .', // 後手の歩2枚：row5 へ進めない
      '.  .  .  .  .  .',
    ),
    hands: hands(),
    turn: 'sente',
  });

  it('合法手が1つも無ければパスになる', () => {
    expect(legalMoves(stuck)).toEqual([]);
    expect(mustPass(stuck)).toBe(true);
    expect(isLegalMove(stuck, { kind: 'pass' })).toBe(true);
  });

  it('合法手があるときはパスできない', () => {
    expect(mustPass(initialGameState())).toBe(false);
    expect(isLegalMove(initialGameState(), { kind: 'pass' })).toBe(false);
  });

  it('両者が連続でパスしたら盤上の駒数が多い方の勝ち', () => {
    const afterFirst = applyMove(stuck, { kind: 'pass' });
    expect(afterFirst.result.kind).toBe('playing');
    expect(afterFirst.consecutivePasses).toBe(1);

    const afterSecond = applyMove(afterFirst, { kind: 'pass' });
    // 先手1枚 vs 後手2枚 → 後手の勝ち
    expect(afterSecond.result).toEqual({ kind: 'win', winner: 'gote', reason: 'pass_count' });
  });

  it('駒数が同数なら引き分け', () => {
    const even = state({
      board: board(
        '.  .  .  .  .  .',
        'P  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  p  .  .',
        '.  .  .  .  .  .',
      ),
      hands: hands(),
      turn: 'sente',
    });
    const end = applyMove(applyMove(even, { kind: 'pass' }), { kind: 'pass' });
    expect(end.result).toEqual({ kind: 'draw', reason: 'pass_count' });
  });

  it('間に手が入ったら連続パスはリセットされる', () => {
    const s = state({
      board: board(
        '.  .  .  .  .  .',
        'P  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  p  .  .',
        '.  .  .  .  r  .', // 後手には動ける飛がある
      ),
      hands: hands(),
      turn: 'sente',
    });
    const afterPass = applyMove(s, { kind: 'pass' });
    expect(afterPass.consecutivePasses).toBe(1);
    const afterMove = applyMove(afterPass, { kind: 'move', from: at(5, 4), to: at(5, 5) });
    expect(afterMove.consecutivePasses).toBe(0);
    expect(afterMove.result.kind).toBe('playing');
  });
});

describe('同一局面4回', () => {
  it('4回目の出現で盤上の駒数判定になる', () => {
    let s = state({
      board: board(
        '.  .  .  k  .  r',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        'R  .  K  .  .  .',
      ),
      hands: hands(),
      turn: 'sente',
    });

    // 1周 = 先手の飛と後手の飛が往復して元の局面に戻る
    const cycle = [
      { kind: 'move', from: at(5, 0), to: at(4, 0) },
      { kind: 'move', from: at(0, 5), to: at(1, 5) },
      { kind: 'move', from: at(4, 0), to: at(5, 0) },
      { kind: 'move', from: at(1, 5), to: at(0, 5) },
    ] as const;

    // 2周目までは続く（初期局面の出現回数が 3 になる）
    for (let round = 0; round < 2; round += 1) {
      for (const move of cycle) {
        s = applyMove(s, move);
        expect(s.result.kind).toBe('playing');
      }
    }

    // 3周目を終えた瞬間に初期局面が4回目 → 駒数判定（2 対 2 で引き分け）
    for (const move of cycle) {
      s = applyMove(s, move);
    }
    expect(s.result).toEqual({ kind: 'draw', reason: 'repetition_count' });
  });
});

describe('投了と時間切れ', () => {
  it('投了した側の負け', () => {
    const s = resign(initialGameState(), 'sente');
    expect(s.result).toEqual({ kind: 'win', winner: 'gote', reason: 'resign' });
  });

  it('時間切れした側の負け', () => {
    const s = timeout(initialGameState(), 'gote');
    expect(s.result).toEqual({ kind: 'win', winner: 'sente', reason: 'timeout' });
  });

  it('決着後は手を指せない', () => {
    const s = resign(initialGameState(), 'sente');
    expect(legalMoves(s)).toEqual([]);
    expect(() => applyMove(s, { kind: 'drop', piece: 'P', to: at(3, 3) })).toThrow();
  });
});
