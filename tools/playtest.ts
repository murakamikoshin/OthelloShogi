/**
 * 実際に1手ずつ考えて遊ぶための盤面ビューア。
 *
 *   npm run playtest -- "42-32 13-23"     … その手順まで進めて局面を見せる
 *   npm run playtest -- "" --ai=normal    … AI に相手をさせる（人間の手番で止まる）
 *
 * 各マスに「打つと何枚寝返るか・何連鎖か」を出すので、
 * 何を考えて指せる局面なのかが分かる。
 */
import type { GameState, Move } from '../src/core/index.ts';
import {
  BOARD_SIZE,
  applyMoveWithDetail,
  countPieces,
  findKing,
  formatMove,
  initialGameState,
  isInCheck,
  legalMoves,
  parseKifu,
  pieceAt,
  previewDrop,
} from '../src/core/index.ts';
import { findBestMove, DIFFICULTY, type Difficulty } from '../src/ai/search.ts';

const KANJI: Record<string, string> = {
  K: '玉', P: '歩', R: '飛', B: '角', '+P': 'と', '+R': '竜', '+B': '馬',
};

function renderBoard(state: GameState, marks: ReadonlyMap<number, string> = new Map()): string {
  const header = Array.from({ length: BOARD_SIZE }, (_, c) => ` c${c} `).join('');
  const lines = [`     ${header}`];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const index = row * BOARD_SIZE + col;
      const square = state.board[index] ?? null;
      const mark = marks.get(index);
      if (square) {
        cells.push(`${square.owner === 'sente' ? '^' : 'v'}${KANJI[square.type]}${mark ?? ' '}`);
      } else {
        cells.push(` ・${mark ?? ' '}`);
      }
    }
    lines.push(`r${row}   ${cells.join('')}`);
  }
  return lines.join('\n');
}

/** その手番で打てる手を、寝返る枚数の多い順に並べる。 */
function dropOptions(state: GameState) {
  const options: { move: Move; flips: number; chain: number; label: string }[] = [];
  for (const move of legalMoves(state)) {
    if (move.kind !== 'drop') continue;
    const preview = previewDrop(state, move.piece, move.to);
    options.push({
      move,
      flips: preview.flips.length,
      chain: preview.chainCount,
      label: `${formatMove(move)} ${KANJI[move.piece]}打 → ${preview.flips.length}枚${preview.chainCount >= 2 ? ` ${preview.chainCount}連鎖` : ''}`,
    });
  }
  return options.sort((a, b) => b.flips - a.flips);
}

/** 動かす手のうち、駒を取れるものを並べる。 */
function captureOptions(state: GameState) {
  const options: { move: Move; label: string }[] = [];
  for (const move of legalMoves(state)) {
    if (move.kind !== 'move') continue;
    const target = pieceAt(state.board, move.to);
    if (!target) continue;
    options.push({
      move,
      label: `${formatMove(move)} ${KANJI[target.type]}を取る`,
    });
  }
  return options;
}

/** 相手が次に何をしてくるか（いちばん大きな反転と、玉が取れるか）。 */
function threats(state: GameState) {
  const foe = state.turn === 'sente' ? 'gote' : 'sente';
  const asFoe: GameState = { ...state, turn: foe };
  const best = dropOptions(asFoe)[0];
  const king = findKing(state.board, state.turn);
  const kingHunted = king !== null && isInCheck(state.board, state.turn);
  return { best, kingHunted };
}

function show(state: GameState, note = ''): void {
  const counts = countPieces(state.board);
  const drops = dropOptions(state);
  const marks = new Map<number, string>();
  // いちばん大きな反転が狙えるマスに印を付ける
  for (const option of drops.slice(0, 3)) {
    if (option.flips === 0 || option.move.kind !== 'drop') continue;
    marks.set(option.move.to.row * BOARD_SIZE + option.move.to.col, '*');
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`${state.ply}手目まで / 手番 ${state.turn === 'sente' ? '先手' : '後手'}${note ? ` — ${note}` : ''}`);
  console.log(renderBoard(state, marks));
  console.log(`駒数 先手${counts.sente} : 後手${counts.gote}   持ち駒 先[歩${state.hands.sente.P} 飛${state.hands.sente.R} 角${state.hands.sente.B}] 後[歩${state.hands.gote.P} 飛${state.hands.gote.R} 角${state.hands.gote.B}]`);
  if (isInCheck(state.board, state.turn)) console.log('★ 王手がかかっている');

  const withFlips = drops.filter((d) => d.flips > 0);
  console.log(`打てる手 ${drops.length} 通り（うち寝返らせるもの ${withFlips.length} 通り）`);
  for (const option of withFlips.slice(0, 6)) console.log(`   ${option.label}`);
  if (withFlips.length === 0) console.log('   （寝返らせる手は無い）');

  const captures = captureOptions(state);
  if (captures.length > 0) {
    console.log(`取れる手 ${captures.length} 通り`);
    for (const option of captures.slice(0, 5)) console.log(`   ${option.label}`);
  }

  const threat = threats(state);
  if (threat.best && threat.best.flips > 0) {
    console.log(`相手の最大の狙い: ${threat.best.label}`);
  }
}

function main(): void {
  const kifu = process.argv[2] ?? '';
  const aiArg = process.argv.find((a) => a.startsWith('--ai='));
  const ai = aiArg?.slice('--ai='.length) as Difficulty | undefined;
  const aiSide = process.argv.includes('--ai-sente') ? 'sente' : 'gote';

  let state = initialGameState();
  for (const move of parseKifu(kifu)) {
    const outcome = applyMoveWithDetail(state, move);
    state = outcome.state;
  }

  // AI の手番なら指させてから見せる
  while (ai && state.result.kind === 'playing' && state.turn === aiSide) {
    const found = findBestMove(state, DIFFICULTY[ai]);
    const move = found.move ?? { kind: 'pass' as const };
    const outcome = applyMoveWithDetail(state, move);
    console.log(`AI: ${formatMove(move)}${outcome.chainCount ? `  ${outcome.chainCount}連鎖 ${outcome.flips.length}枚` : ''}${outcome.captured ? `  ${KANJI[outcome.captured.type]}を取った` : ''}`);
    state = outcome.state;
  }

  if (state.result.kind !== 'playing') {
    console.log(`\n決着: ${JSON.stringify(state.result)}`);
    console.log(renderBoard(state));
    return;
  }
  show(state);
}

main();
