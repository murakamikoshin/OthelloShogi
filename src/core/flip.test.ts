/**
 * 反転（オセロ部分）のテスト。仕様書 3.4 が対象。
 */
import { describe, expect, it } from 'vitest';
import { applyMoveWithDetail, previewFlips } from './game.ts';
import { DEFAULT_FLIP_RANGES, flipRays, simulateDrop } from './flip.ts';
import { FLIP_DIRECTION_MODE } from './rules.ts';
import { at, board, hand, hands, pieceOn, posSet, state } from './test-helpers.ts';

describe('打ったときの反転', () => {
  it('歩を打つと前方1方向だけを見て、挟んだ1枚が裏返る', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  R  .  .  .', // 挟みの終端になる先手の飛
        '.  .  p  .  .  .', // 裏返る後手の歩
        '.  .  .  .  .  .', // ここに先手が歩を打つ
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(1), hand()),
      turn: 'sente',
    });

    const { state: next, flips } = applyMoveWithDetail(s, {
      kind: 'drop',
      piece: 'P',
      to: at(4, 2),
    });

    expect(posSet(flips)).toEqual(['32']);
    expect(pieceOn(next.board, 3, 2).owner).toBe('sente');
    // 打った駒自身は常に不成
    expect(pieceOn(next.board, 4, 2)).toEqual({ type: 'P', owner: 'sente' });
    expect(next.hands.sente.P).toBe(0);
  });

  describe('挟み判定の方向（FLIP_DIRECTION_MODE）', () => {
    // r4c1 と r4c3 の後手の歩が、それぞれ r4c0 / r4c4 の先手の飛との間に挟まっている。
    // 歩を r4c2 に打ったとき、これを裏返せるかどうかがモードで変わる。
    const b = board(
      '.  .  .  k  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      'R  p  .  p  R  .',
      '.  .  R  .  .  .',
    );

    it("'attack' は打った駒の利きの方向だけを見る（歩は前1方向）", () => {
      expect(flipRays('P', 'sente', DEFAULT_FLIP_RANGES, 'attack').map((ray) => ray.dir)).toEqual([
        [-1, 0],
      ]);
      // 前方 r3c2 は空マスなので何も裏返らない
      expect(simulateDrop(b, at(4, 2), 'P', 'sente', { mode: 'attack' }).flips).toEqual([]);
    });

    it("'wide' なら歩でも横で挟める", () => {
      const result = simulateDrop(b, at(4, 2), 'P', 'sente', { mode: 'wide' });
      expect(posSet(result.flips)).toEqual(['41', '43']);
      expect(result.chainCount).toBe(1);
    });

    it("'all8' は駒種によらず全8方向を見る", () => {
      expect(flipRays('P', 'sente', DEFAULT_FLIP_RANGES, 'all8')).toHaveLength(8);
      expect(flipRays('B', 'sente', DEFAULT_FLIP_RANGES, 'all8')).toHaveLength(8);
      expect(posSet(simulateDrop(b, at(4, 2), 'P', 'sente', { mode: 'all8' }).flips)).toEqual([
        '41',
        '43',
      ]);
    });

    it('既定は all8。歩を打っても斜めで挟めば裏返る', () => {
      expect(FLIP_DIRECTION_MODE).toBe('all8');

      const diagonal = board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        'R  .  .  .  .  .', // 斜めの終端になる先手の飛
        '.  p  .  .  .  .', // 裏返る後手の歩
        '.  .  .  .  .  .', // ここに先手が歩を打つ
        '.  .  K  .  .  .',
      );

      // 既定（all8）なら斜めに挟んで裏返る
      const result = simulateDrop(diagonal, at(4, 2), 'P', 'sente');
      expect(posSet(result.flips)).toEqual(['31']);
      expect(pieceOn(result.board, 3, 1)).toEqual({ type: '+P', owner: 'sente' });

      // 斜めを見ないモードでは何も起きない
      expect(simulateDrop(diagonal, at(4, 2), 'P', 'sente', { mode: 'wide' }).flips).toEqual([]);
      expect(simulateDrop(diagonal, at(4, 2), 'P', 'sente', { mode: 'attack' }).flips).toEqual([]);
    });

    it('方向を上乗せしても、走る駒の距離は縮まない', () => {
      const ranges = { slide: Number.POSITIVE_INFINITY, step: 1 };
      // 飛の縦横は「走る」方向のまま（上乗せ分の距離1に潰されない）
      for (const ray of flipRays('R', 'sente', ranges, 'wide')) {
        expect(ray.range).toBe(Number.POSITIVE_INFINITY);
      }
      // 角は斜めが走る方向、上乗せされた縦横は1マス
      const bishop = flipRays('B', 'sente', ranges, 'wide');
      expect(bishop.filter((ray) => ray.range === Number.POSITIVE_INFINITY)).toHaveLength(4);
      expect(bishop.filter((ray) => ray.range === 1)).toHaveLength(4);
    });
  });

  it('飛を打つと縦横に一直線で複数枚裏返る', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        'B  .  .  .  .  .', // 挟みの終端になる先手の角
        'r  .  .  .  .  .', // 裏返る後手の飛
        'p  .  .  .  .  .', // 裏返る後手の歩
        '.  .  K  .  .  .', // r5c0 に先手が飛を打つ
      ),
      hands: hands(hand(0, 1), hand()),
      turn: 'sente',
    });

    const { state: next, flips } = applyMoveWithDetail(s, {
      kind: 'drop',
      piece: 'R',
      to: at(5, 0),
    });

    expect(posSet(flips)).toEqual(['30', '40']);
    expect(pieceOn(next.board, 4, 0)).toEqual({ type: '+P', owner: 'sente' });
    expect(pieceOn(next.board, 3, 0)).toEqual({ type: '+R', owner: 'sente' });
  });

  it('角を打つと斜めだけを判定する', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  B  .  .  .', // 斜めの終端
        '.  .  .  p  .  .', // 裏返る
        'R  p  .  .  .  .', // 縦の挟みの形（角は縦を見ないので裏返らない）
        '.  .  .  .  K  .', // r4c4 に角を打つ … ではなく r4c4 は空
      ),
      hands: hands(hand(0, 0, 1), hand()),
      turn: 'sente',
    });

    const flips = simulateDrop(s.board, at(4, 4), 'B', 'sente').flips;
    expect(posSet(flips)).toEqual(['33']);
  });

  it('挟みの間に相手の玉があると、その方向は何も裏返らない', () => {
    const s = state({
      board: board(
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        'B  .  .  .  .  .', // 先手の角（終端の候補）
        'k  .  .  .  .  .', // 後手の玉 … ここで打ち切り
        'p  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(0, 1), hand()),
      turn: 'sente',
    });

    const { state: next, flips } = applyMoveWithDetail(s, {
      kind: 'drop',
      piece: 'R',
      to: at(5, 0),
    });

    expect(flips).toEqual([]);
    expect(pieceOn(next.board, 4, 0)).toEqual({ type: 'P', owner: 'gote' });
    expect(pieceOn(next.board, 3, 0)).toEqual({ type: 'K', owner: 'gote' });

    // 玉ガードを切っても、玉そのものが経路を遮断することは変わらない
    expect(simulateDrop(s.board, at(5, 0), 'R', 'sente', { kingGuards: false }).flips).toEqual([]);
  });

  describe('玉に隣接する駒は寝返らない（KING_GUARDS_NEIGHBORS）', () => {
    //  r2c0 の後手の歩は、後手の玉 r1c1 の隣にいるので寝返らない
    const guarded = board(
      '.  .  .  .  .  .',
      'R  k  .  .  .  .', // 先手の飛（挟みの終端）と、その隣の後手の玉
      'p  .  .  .  .  .', // 玉の隣にいる後手の歩
      '.  .  .  .  .  .', // ここに先手が歩を打つ
      '.  .  .  .  .  .',
      '.  .  K  .  .  .',
    );

    it('玉の隣の駒は挟んでも裏返らず、その方向は打ち切りになる', () => {
      expect(simulateDrop(guarded, at(3, 0), 'P', 'sente').flips).toEqual([]);
    });

    it('玉ガードを切れば同じ形で裏返る', () => {
      const result = simulateDrop(guarded, at(3, 0), 'P', 'sente', { kingGuards: false });
      expect(posSet(result.flips)).toEqual(['20']);
    });

    it('玉から離れれば寝返る', () => {
      const far = board(
        '.  .  .  .  .  .',
        'R  .  .  .  .  .',
        'p  .  .  .  .  .', // 玉から離れた後手の歩
        '.  .  .  .  k  .', // 後手の玉は反対側
        '.  .  .  .  .  .',
        '.  .  K  .  .  .',
      );
      expect(posSet(simulateDrop(far, at(3, 0), 'P', 'sente').flips)).toEqual(['20']);
    });

    it('守るのは持ち主の玉だけ。相手の玉が隣にいても寝返る', () => {
      const b = board(
        '.  .  .  .  .  .',
        'R  .  .  .  .  .',
        'p  .  .  .  .  .', // 後手の歩。隣にいるのは先手の玉
        '.  K  .  .  k  .', // 先手の玉 r3c1 / 後手の玉は遠い
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
      );
      expect(posSet(simulateDrop(b, at(3, 0), 'P', 'sente').flips)).toEqual(['20']);
    });
  });

  it('自分の玉は挟みの終端（アンカー）として機能する', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  K  .  .  .', // 自分の玉がアンカー
        '.  .  p  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
      ),
      hands: hands(hand(1), hand()),
      turn: 'sente',
    });

    const flips = simulateDrop(s.board, at(4, 2), 'P', 'sente').flips;
    expect(posSet(flips)).toEqual(['32']);
  });

  it('間に空マスがあると挟めない', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        'R  .  .  .  .  .',
        '.  .  .  .  .  .', // 空マス … ここで打ち切り
        'p  .  .  .  .  .',
        'p  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(0, 1), hand()),
      turn: 'sente',
    });

    expect(simulateDrop(s.board, at(5, 0), 'R', 'sente').flips).toEqual([]);
  });

  it('相手の駒が0枚（自分の駒が隣接）なら裏返らない', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  R  .  .  .', // 隣が自分の駒
        '.  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(1), hand()),
      turn: 'sente',
    });

    expect(simulateDrop(s.board, at(4, 2), 'P', 'sente').flips).toEqual([]);
  });

  it('裏返った駒は成る（歩→と / 飛→竜 / 角→馬）', () => {
    const s = state({
      board: board(
        'k  .  .  .  .  .', // 玉は離しておく（玉の隣の駒は寝返らないため）
        '.  R  b  r  .  .', // 後手の角・飛が裏返って馬・竜になる
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(0, 1), hand()),
      turn: 'sente',
    });

    const { state: next, flips } = applyMoveWithDetail(s, {
      kind: 'drop',
      piece: 'R',
      to: at(1, 4),
    });

    expect(posSet(flips)).toEqual(['12', '13']);
    expect(pieceOn(next.board, 1, 2)).toEqual({ type: '+B', owner: 'sente' });
    expect(pieceOn(next.board, 1, 3)).toEqual({ type: '+R', owner: 'sente' });
  });

  it('すでに成駒なら成ったまま持ち主だけ変わる', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  R  .  .  .',
        '.  . +p  .  .  .', // 後手のと金
        '.  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(1), hand()),
      turn: 'sente',
    });

    const { state: next } = applyMoveWithDetail(s, { kind: 'drop', piece: 'P', to: at(4, 2) });
    expect(pieceOn(next.board, 3, 2)).toEqual({ type: '+P', owner: 'sente' });
  });

  it('1手で複数方向を同時に裏返せる', () => {
    const s = state({
      board: board(
        '.  .  R  .  .  .',
        '.  .  p  .  .  .',
        'R  p  .  p  R  .', // 中央 r2c2 に飛を打つ
        '.  .  p  .  .  .',
        '.  .  R  .  .  .',
        '.  .  .  k  K  .',
      ),
      hands: hands(hand(0, 1), hand()),
      turn: 'sente',
    });

    const flips = simulateDrop(s.board, at(2, 2), 'R', 'sente').flips;
    expect(posSet(flips)).toEqual(['12', '21', '23', '32']);
  });

  it('後手が打つときの前方は row が増える向き', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .', // ここに後手が歩を打つ
        '.  .  .  P  .  .', // 裏返る先手の歩
        '.  .  .  r  .  .', // 後手の飛がアンカー
        '.  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(), hand(1)),
      turn: 'gote',
    });

    const flips = simulateDrop(s.board, at(1, 3), 'P', 'gote').flips;
    expect(posSet(flips)).toEqual(['23']);
  });

  it('previewFlips は実際に打った結果と一致する', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        'B  .  .  .  .  .',
        'r  .  .  .  .  .',
        'p  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(hand(0, 1), hand()),
      turn: 'sente',
    });

    const preview = previewFlips(s, 'R', at(5, 0));
    const { flips } = applyMoveWithDetail(s, { kind: 'drop', piece: 'R', to: at(5, 0) });
    expect(posSet(preview)).toEqual(posSet(flips));
  });
});

describe('動かしたときは反転しない', () => {
  it('同じ挟みの形を移動で作っても裏返らない', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  R  .  .  .',
        '.  .  p  .  .  .',
        '.  .  .  .  .  .',
        '.  .  P  .  .  .', // この歩を r4c2 に動かす（打つのと同じ形になる）
      ),
      hands: hands(),
      turn: 'sente',
    });

    const { state: next, flips } = applyMoveWithDetail(s, {
      kind: 'move',
      from: at(5, 2),
      to: at(4, 2),
    });

    expect(flips).toEqual([]);
    expect(pieceOn(next.board, 3, 2)).toEqual({ type: 'P', owner: 'gote' });
  });

  it('移動では成らない', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  P  .  .  .', // 先手の歩。r1c2 に進んでも成らない
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  K  .  .  .',
      ),
      hands: hands(),
      turn: 'sente',
    });

    const next = applyMoveWithDetail(s, { kind: 'move', from: at(2, 2), to: at(1, 2) }).state;
    expect(pieceOn(next.board, 1, 2)).toEqual({ type: 'P', owner: 'sente' });
  });
});
