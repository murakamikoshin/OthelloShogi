/**
 * 反転（オセロ部分）のテスト。仕様書 3.4 が対象。
 */
import { describe, expect, it } from 'vitest';
import { applyMoveWithDetail, previewFlips } from './game.ts';
import { computeFlips } from './flip.ts';
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

  it('歩を打っても後方・横は判定しない（利きの方向だけ）', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .',
        '.  .  .  .  .  .', // ここに先手が歩を打つ
        'R  p  .  p  R  .', // 左右に挟みの形があるが歩は横を見ない
        '.  .  R  .  .  .', // 後方にも挟みの形があるが歩は後ろを見ない
      ),
      hands: hands(hand(1), hand()),
      turn: 'sente',
    });

    // 歩は前方(row-1)しか見ない。r3c2 の前方 r2c2 は空マス。
    expect(computeFlips(s.board, at(3, 2), 'P', 'sente')).toEqual([]);
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

    const flips = computeFlips(s.board, at(4, 4), 'B', 'sente');
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

    const flips = computeFlips(s.board, at(4, 2), 'P', 'sente');
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

    expect(computeFlips(s.board, at(5, 0), 'R', 'sente')).toEqual([]);
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

    expect(computeFlips(s.board, at(4, 2), 'P', 'sente')).toEqual([]);
  });

  it('裏返った駒は成る（歩→と / 飛→竜 / 角→馬）', () => {
    const s = state({
      board: board(
        '.  .  .  k  .  .',
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

    const flips = computeFlips(s.board, at(2, 2), 'R', 'sente');
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

    const flips = computeFlips(s.board, at(1, 3), 'P', 'gote');
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
