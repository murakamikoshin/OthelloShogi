/**
 * 連鎖反転のテスト（追加仕様 v2 §2.4 の必須項目）。
 */
import { describe, expect, it } from 'vitest';
import { collectFlipStep, flipRays, resolveChain, simulateDrop } from './flip.ts';
import { applyMoveWithDetail, previewDrop } from './game.ts';
import { boardToString, posOf } from './board.ts';
import { MAX_CHAIN } from './rules.ts';
import { at, board, hand, hands, pieceOn, posSet, state } from './test-helpers.ts';
import type { Board, Pos } from './types.ts';

/**
 * 2段の連鎖が起きる盤面。
 *
 *   1段目: r4c2 に打った歩が r3c2 の後手の歩を r2c2 の先手の飛と挟んで反転
 *   2段目: 反転してできた「と金」は横にも利くので、r3c1 の後手の歩を
 *          r3c0 の先手の飛と挟んで反転する（歩のままなら絶対に起きない）
 */
const TWO_CHAIN: Board = board(
  '.  .  .  k  .  .',
  '.  .  .  .  .  .',
  '.  .  R  .  .  .',
  'R  p  p  .  .  .',
  '.  .  .  .  .  .',
  '.  .  K  .  .  .',
);

/** 上に加えて r4c1 の後手の歩を r5c1 の先手の飛と挟む3段目が続く盤面。 */
const THREE_CHAIN: Board = board(
  '.  .  .  k  .  .',
  '.  .  .  .  .  .',
  '.  .  R  .  .  .',
  'R  p  p  .  .  .',
  '.  p  .  .  .  .',
  '.  R  K  .  .  .',
);

describe('連鎖反転', () => {
  it('2段の連鎖が正しく発生する', () => {
    const result = simulateDrop(TWO_CHAIN, at(4, 2), 'P', 'sente');

    expect(result.chainCount).toBe(2);
    expect(result.steps).toHaveLength(2);
    expect(posSet(result.steps[0] ?? [])).toEqual(['32']);
    expect(posSet(result.steps[1] ?? [])).toEqual(['31']);
    expect(posSet(result.flips)).toEqual(['31', '32']);

    // どちらも先手のと金になっている
    expect(pieceOn(result.board, 3, 2)).toEqual({ type: '+P', owner: 'sente' });
    expect(pieceOn(result.board, 3, 1)).toEqual({ type: '+P', owner: 'sente' });
  });

  it('反転した駒の「成った後の利き」で次の判定が行われている', () => {
    // 歩の利きは前1方向だけ。横に挟める利きは「と金」になって初めて生まれる。
    expect(flipRays('P', 'sente').map((ray) => ray.dir)).toEqual([[-1, 0]]);
    expect(flipRays('+P', 'sente').map((ray) => ray.dir)).toContainEqual([0, -1]);

    // 2段目の反転 r3c1 は、と金の横の利きでしか起こりえない
    const asPawn = collectFlipStep(TWO_CHAIN, [at(3, 2)], 'gote');
    expect(asPawn).toEqual([]); // 反転前は後手の歩なので何も起きない

    const result = simulateDrop(TWO_CHAIN, at(4, 2), 'P', 'sente');
    expect(posSet(result.steps[1] ?? [])).toEqual(['31']);
  });

  it('3段の連鎖も続く', () => {
    const result = simulateDrop(THREE_CHAIN, at(4, 2), 'P', 'sente');
    expect(result.chainCount).toBe(3);
    expect(posSet(result.steps[0] ?? [])).toEqual(['32']);
    expect(posSet(result.steps[1] ?? [])).toEqual(['31']);
    expect(posSet(result.steps[2] ?? [])).toEqual(['41']);
  });

  it('連鎖が MAX_CHAIN で打ち切られる', () => {
    const capped = simulateDrop(THREE_CHAIN, at(4, 2), 'P', 'sente', { maxChain: 2 });

    expect(capped.chainCount).toBe(2);
    expect(capped.steps).toHaveLength(2);
    // 3段目で反転するはずだった駒は後手のまま残る
    expect(pieceOn(capped.board, 4, 1)).toEqual({ type: 'P', owner: 'gote' });

    const capped1 = simulateDrop(THREE_CHAIN, at(4, 2), 'P', 'sente', { maxChain: 1 });
    expect(capped1.chainCount).toBe(1);
    expect(pieceOn(capped1.board, 3, 1)).toEqual({ type: 'P', owner: 'gote' });

    // 既定値でも上限を超えることはない
    const full = simulateDrop(THREE_CHAIN, at(4, 2), 'P', 'sente');
    expect(full.chainCount).toBeLessThanOrEqual(MAX_CHAIN);
  });

  it('同一の駒が1手番中に2回以上反転しない', () => {
    const result = simulateDrop(THREE_CHAIN, at(4, 2), 'P', 'sente');
    const keys = result.flips.map((pos: Pos) => `${pos.row}${pos.col}`);
    expect(new Set(keys).size).toBe(keys.length);

    // 段をまたいでも重複しない
    const perStep = result.steps.map((step) => step.map((pos) => `${pos.row}${pos.col}`));
    expect(perStep.flat()).toEqual(keys);
  });

  it('既に反転したマスは次の段の対象から除外される', () => {
    const already = new Set([3 * 6 + 1]); // r3c1 を「反転済み」とする
    const found = collectFlipStep(TWO_CHAIN, [at(3, 2)], 'gote', already);
    expect(found).not.toContain(3 * 6 + 1);
  });
});

describe('同時解決（処理順に依存しない）', () => {
  /**
   * 起点が2つある盤面。
   *   O1 = r1c2 のと金 … 下の r2c2 を r3c2 の飛と挟んで反転できる
   *   O2 = r2c4 のと金 … 左に r2c3, r2c2 と後手の歩が続くが、その先は空マス
   *
   * 1枚ずつ順番に処理すると、O1 が r2c2 を反転させた結果 O2 の挟みが成立してしまい、
   * 同じ段で r2c3 まで裏返ってしまう。同時解決なら r2c2 だけが裏返る。
   */
  const TWO_ORIGINS: Board = board(
    '.  .  .  k  .  .',
    '.  . +P  .  .  .',
    '.  .  p  p +P  .',
    '.  .  R  .  .  .',
    '.  .  .  .  .  .',
    '.  .  K  .  .  .',
  );

  const O1 = at(1, 2);
  const O2 = at(2, 4);

  it('同じ段では、その段を始めた時点の盤面だけを見る', () => {
    const found = collectFlipStep(TWO_ORIGINS, [O1, O2], 'sente').map(posOf);
    expect(posSet(found)).toEqual(['22']); // r2c3 は含まれない
  });

  it('起点を渡す順番を入れ替えても結果が同一', () => {
    expect(collectFlipStep(TWO_ORIGINS, [O1, O2], 'sente')).toEqual(
      collectFlipStep(TWO_ORIGINS, [O2, O1], 'sente'),
    );
  });

  it('複数の起点が同じマスを狙っても1回しか反転しない', () => {
    //  r1c0 と r3c0 のと金が、どちらも r2c0 の後手の歩を挟める
    const b = board(
      '.  .  .  k  .  .',
      '+P .  .  .  .  .',
      'p  .  .  .  .  .',
      '+P .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  K  .  .  .',
    );
    const found = collectFlipStep(b, [at(1, 0), at(3, 0)], 'sente');
    expect(found).toEqual([2 * 6 + 0]);
    expect(collectFlipStep(b, [at(3, 0), at(1, 0)], 'sente')).toEqual(found);
  });

  it('同じ手を100回適用しても毎回まったく同じ盤面になる（決定性）', () => {
    const expected = simulateDrop(THREE_CHAIN, at(4, 2), 'P', 'sente');
    const signature = (result: ReturnType<typeof simulateDrop>): string =>
      JSON.stringify({
        board: boardToString(result.board),
        chainCount: result.chainCount,
        steps: result.steps,
      });

    const first = signature(expected);
    for (let i = 0; i < 100; i += 1) {
      expect(signature(simulateDrop(THREE_CHAIN, at(4, 2), 'P', 'sente'))).toBe(first);
    }
  });
});

describe('連鎖と玉', () => {
  it('連鎖の経路に相手の玉があっても玉は反転せず、その方向は不成立', () => {
    //  2段目のと金が左を見ると r3c1 の後手の玉に当たる
    const b = board(
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  R  .  .  .',
      'R  k  p  .  .  .',
      '.  .  .  .  .  .',
      '.  .  K  .  .  .',
    );
    const result = simulateDrop(b, at(4, 2), 'P', 'sente');

    expect(result.chainCount).toBe(1);
    expect(posSet(result.flips)).toEqual(['32']);
    expect(pieceOn(result.board, 3, 1)).toEqual({ type: 'K', owner: 'gote' });
  });

  it('玉は連鎖の起点にならない', () => {
    const b = board(
      '.  .  .  .  .  .',
      '.  .  R  .  .  .',
      '.  .  p  .  .  .',
      '.  .  K  .  .  .', // 先手の玉。挟みの形はあるが起点にはならない
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    expect(collectFlipStep(b, [at(3, 2)], 'sente')).toEqual([]);
    expect(flipRays('K', 'sente')).toEqual([]);
  });

  it('自分の玉は連鎖の途中でも挟みの終端として機能する', () => {
    const b = board(
      '.  .  .  k  .  .',
      '.  .  .  .  .  .',
      '.  .  R  .  .  .',
      'K  p  p  .  .  .', // 2段目のアンカーが自分の玉
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
    );
    const result = simulateDrop(b, at(4, 2), 'P', 'sente');
    expect(result.chainCount).toBe(2);
    expect(posSet(result.flips)).toEqual(['31', '32']);
  });
});

describe('連鎖の終了条件', () => {
  it('反転できる相手の駒が無くなったら正常に終了する', () => {
    //  1段目で後手の駒（玉以外）が全て無くなる
    const b = board(
      '.  .  R  .  .  .',
      '.  .  p  .  .  .',
      'R  p  .  p  R  .',
      '.  .  p  .  .  .',
      '.  .  R  .  .  .',
      '.  .  .  k  K  .',
    );
    const result = simulateDrop(b, at(2, 2), 'R', 'sente');

    expect(result.chainCount).toBe(1);
    expect(posSet(result.flips)).toEqual(['12', '21', '23', '32']);
    // 次の段で起点を調べても何も見つからない
    expect(collectFlipStep(result.board, result.steps[0] ?? [], 'sente')).toEqual([]);
  });

  it('そもそも1枚も裏返らなければ連鎖数は 0', () => {
    const b = board(
      '.  .  .  k  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  .  .  .  .',
      '.  .  K  .  .  .',
    );
    const result = simulateDrop(b, at(3, 3), 'R', 'sente');
    expect(result.chainCount).toBe(0);
    expect(result.steps).toEqual([]);
    expect(boardToString(result.board)).toBe(
      boardToString(resolveChain(result.board, at(3, 3), 'sente').board),
    );
  });
});

describe('局面への反映', () => {
  it('打つ手は連鎖数を局面に記録し、最大連鎖数を更新する', () => {
    const s = state({ board: THREE_CHAIN, hands: hands(hand(1), hand()), turn: 'sente' });
    const outcome = applyMoveWithDetail(s, { kind: 'drop', piece: 'P', to: at(4, 2) });

    expect(outcome.chainCount).toBe(3);
    expect(outcome.flipSteps).toHaveLength(3);
    expect(outcome.state.lastChainCount).toBe(3);
    expect(outcome.state.maxChainCount).toEqual({ sente: 3, gote: 0 });
  });

  it('動かす手では連鎖しない（連鎖数は 0 になる）', () => {
    const s = state({ board: THREE_CHAIN, hands: hands(hand(1), hand()), turn: 'sente' });
    const dropped = applyMoveWithDetail(s, { kind: 'drop', piece: 'P', to: at(4, 2) }).state;

    // 次は後手の手番。駒を動かしても反転は起きない
    const moved = applyMoveWithDetail(dropped, { kind: 'move', from: at(0, 3), to: at(0, 2) });
    expect(moved.chainCount).toBe(0);
    expect(moved.flips).toEqual([]);
    expect(moved.state.lastChainCount).toBe(0);
    // 最大連鎖数は消えない
    expect(moved.state.maxChainCount).toEqual({ sente: 3, gote: 0 });
  });

  it('プレビューは連鎖の最終結果まで返す', () => {
    const s = state({ board: THREE_CHAIN, hands: hands(hand(1), hand()), turn: 'sente' });
    const preview = previewDrop(s, 'P', at(4, 2));
    const actual = applyMoveWithDetail(s, { kind: 'drop', piece: 'P', to: at(4, 2) });

    expect(preview.chainCount).toBe(actual.chainCount);
    expect(preview.steps).toEqual(actual.flipSteps);
    expect(boardToString(preview.board)).toBe(boardToString(actual.state.board));
  });
});
