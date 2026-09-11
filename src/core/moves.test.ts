/**
 * 駒の動きと合法手生成のテスト。仕様書 3.1 / 3.3 / 3.5 が対象。
 */
import { describe, expect, it } from 'vitest';
import { destinationsFrom, dropDestinations, generateMoves, isAttacked, isInCheck } from './moves.ts';
import { at, board, hand, hands, posSet } from './test-helpers.ts';
import { initialBoard } from './game.ts';

const KINGS_ONLY = board(
  '.  .  .  k  .  .',
  '.  .  .  .  .  .',
  '.  .  .  .  .  .',
  '.  .  .  .  .  .',
  '.  .  .  .  .  .',
  '.  .  K  .  .  .',
);

describe('駒の動き', () => {
  it('玉は8方向に1マス', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  K  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(2, 2)))).toEqual(
      ['11', '12', '13', '21', '23', '31', '32', '33'].sort(),
    );
  });

  it('先手の歩は row が減る向きに1マス', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  P  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(3, 2)))).toEqual(['22']);
  });

  it('後手の歩は row が増える向きに1マス', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  p  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(2, 2)))).toEqual(['32']);
  });

  it('飛は縦横に走り、駒に当たったら止まる', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  p  .  .  .', // 取れる（そこで止まる）
      '.  .  .  .  .  .',
      '.  P  R  .  .  .', // 自分の駒は越えられない
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(3, 2)))).toEqual(
      ['12', '22', '33', '34', '35', '42', '52'].sort(),
    );
  });

  it('角は斜めに走る', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  B  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(3, 2)))).toEqual(
      ['21', '10', '23', '14', '05', '41', '50', '43', '54'].sort(),
    );
  });

  it('と金は金の動き（6方向1マス）', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  . +P  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(3, 2)))).toEqual(
      ['21', '22', '23', '31', '33', '42'].sort(),
    );
  });

  it('竜は飛の動き + 斜め1マス', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  . +R  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(3, 2)))).toEqual(
      [
        // 縦横（走る）
        '02', '12', '22', '42', '52', '30', '31', '33', '34', '35',
        // 斜め1マス
        '21', '23', '41', '43',
      ].sort(),
    );
  });

  it('馬は角の動き + 縦横1マス', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  . +B  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(3, 2)))).toEqual(
      [
        // 斜め（走る）
        '21', '10', '23', '14', '05', '41', '50', '43', '54',
        // 縦横1マス
        '22', '42', '31', '33',
      ].sort(),
    );
  });

  it('自分の駒があるマスには行けない', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  P  .  .  .',
      '.  .  K  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(posSet(destinationsFrom(b, at(3, 2)))).not.toContain('22');
  });
});

describe('行き所のない駒（歩の最終段）', () => {
  it('先手の歩は row 0 へ動けない', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  P  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(destinationsFrom(b, at(1, 2))).toEqual([]);
  });

  it('後手の歩は row 5 へ動けない', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  p  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(destinationsFrom(b, at(4, 2))).toEqual([]);
  });

  it('先手の歩は row 0 に打てない', () => {
    const targets = posSet(dropDestinations(KINGS_ONLY, 'sente', 'P'));
    expect(targets.some((t) => t.startsWith('0'))).toBe(false);
    expect(targets).toContain('12');
  });

  it('飛や角は最終段にも打てる', () => {
    const targets = posSet(dropDestinations(KINGS_ONLY, 'sente', 'R'));
    expect(targets).toContain('00');
  });
});

describe('二歩は採用しない', () => {
  it('同じ筋に歩があっても打てる', () => {
    const b = board(
      '.  .  .  k  .  .',
      '.  .  .  .  .  .',
      '.  .  P  .  .  .',
      '.  .  .  .  .  .',
      '.  .  P  .  .  .',
      '.  .  K  .  .  .',
    );
    expect(posSet(dropDestinations(b, 'sente', 'P'))).toContain('32');
  });
});

describe('合法手の列挙', () => {
  it('初期局面に近い形では打つ手と動かす手の両方が出る', () => {
    const moves = generateMoves(KINGS_ONLY, hands(hand(1, 1, 1), hand()), 'sente');
    expect(moves.some((m) => m.kind === 'drop')).toBe(true);
    expect(moves.some((m) => m.kind === 'move')).toBe(true);
  });

  it('持ち駒が0枚なら打つ手は出ない', () => {
    const moves = generateMoves(KINGS_ONLY, hands(), 'sente');
    expect(moves.every((m) => m.kind === 'move')).toBe(true);
  });
});

describe('狙われているマスの判定', () => {
  it('飛の縦横の線上は狙われている', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  R  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(isAttacked(b, at(4, 2), 'sente')).toBe(true);
    expect(isAttacked(b, at(1, 5), 'sente')).toBe(true);
    // 斜めは狙っていない
    expect(isAttacked(b, at(3, 4), 'sente')).toBe(false);
  });

  it('間に駒があれば線は通らない', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  R  .  .  .',
      '.  .  P  .  .  .', // 自分の駒が塞いでいる
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(isAttacked(b, at(4, 2), 'sente')).toBe(false);
  });

  it('相手の駒の利きは数えない', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  r  .  .  .', // 後手の飛
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(isAttacked(b, at(4, 2), 'sente')).toBe(false);
    expect(isAttacked(b, at(4, 2), 'gote')).toBe(true);
  });
});

describe('王手の判定', () => {
  it('開始局面ではどちらにも王手がかかっていない', () => {
    const b = initialBoard();
    expect(isInCheck(b, 'sente')).toBe(false);
    expect(isInCheck(b, 'gote')).toBe(false);
  });

  it('玉の前に飛を打たれると王手', () => {
    //  玉 r0c3 の真下 r1c3 に先手の飛がいる
    const b = board(
      '.  .  b  k  r  .',
      '.  .  p  R  p  .',
      '.  .  .  p  .  .',
      '.  .  P  .  .  .',
      '.  P  .  P  .  .',
      '.  R  K  B  .  .',
    );
    expect(isInCheck(b, 'gote')).toBe(true);
    expect(isInCheck(b, 'sente')).toBe(false);
  });

  it('玉がいなければ王手にはならない', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  R  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(isInCheck(b, 'gote')).toBe(false);
  });
});
