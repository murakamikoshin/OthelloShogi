/**
 * 棋譜を流し込んで局面を確認する CLI（Phase 0 の動作確認用）。
 *
 *   npm run cli -- kifu/sample.kifu          … 最終局面だけ表示
 *   npm run cli -- kifu/sample.kifu --steps  … 1手ごとに盤を表示
 *   npm run cli -- --moves                   … 初期局面の合法手を一覧表示
 *
 * 棋譜の書き方（row と col は 0〜5、必ず row → col の順）:
 *   P*13   歩を row1 col3 に打つ（P=歩 R=飛 B=角）
 *   42-32  row4 col2 の駒を row3 col2 に動かす
 *   pass   パス（合法手が1つも無いときだけ）
 *   '#' 以降は行コメント
 */
import { readFileSync } from 'node:fs';
import type { Board, GameResult, GameState, Move, PieceType } from '../src/core/index.ts';
import {
  BOARD_SIZE,
  applyMoveWithDetail,
  countPieces,
  formatMove,
  formatPos,
  initialGameState,
  legalMoves,
  parseKifu,
} from '../src/core/index.ts';

const KANJI: Record<PieceType, string> = {
  K: '玉',
  P: '歩',
  R: '飛',
  B: '角',
  '+P': 'と',
  '+R': '竜',
  '+B': '馬',
};

function renderBoard(board: Board): string {
  const lines: string[] = [];
  const header = Array.from({ length: BOARD_SIZE }, (_, col) => ` c${col} `).join('');
  lines.push(`    ${header}`);
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const cells: string[] = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const square = board[row * BOARD_SIZE + col] ?? null;
      if (!square) {
        cells.push(' ・ ');
      } else {
        const mark = square.owner === 'sente' ? '^' : 'v';
        cells.push(`${mark}${KANJI[square.type]} `);
      }
    }
    lines.push(`r${row}  ${cells.join('')}`);
  }
  return lines.join('\n');
}

function renderHands(state: GameState): string {
  const one = (color: 'sente' | 'gote'): string => {
    const hand = state.hands[color];
    const parts = [
      hand.P > 0 ? `歩x${hand.P}` : '',
      hand.R > 0 ? `飛x${hand.R}` : '',
      hand.B > 0 ? `角x${hand.B}` : '',
    ].filter((part) => part !== '');
    return parts.length > 0 ? parts.join(' ') : 'なし';
  };
  return `先手の持ち駒: ${one('sente')}\n後手の持ち駒: ${one('gote')}`;
}

function renderResult(result: GameResult): string {
  if (result.kind === 'playing') return '対局中';
  const reasons: Record<string, string> = {
    king_captured: '玉を取った',
    pass_count: '両者連続パス → 駒数判定',
    repetition_count: '同一局面4回 → 駒数判定',
    resign: '投了',
    timeout: '時間切れ',
    illegal_move: '反則',
  };
  if (result.kind === 'draw') return `引き分け（${reasons[result.reason] ?? result.reason}）`;
  const winner = result.winner === 'sente' ? '先手' : '後手';
  return `${winner}の勝ち（${reasons[result.reason] ?? result.reason}）`;
}

function describeMove(move: Move): string {
  switch (move.kind) {
    case 'pass':
      return 'パス';
    case 'drop':
      return `${KANJI[move.piece]}を ${formatPos(move.to)} に打つ`;
    case 'move':
      return `${formatPos(move.from)} → ${formatPos(move.to)} に動かす`;
    default:
      return formatMove(move);
  }
}

function printState(state: GameState): void {
  const counts = countPieces(state.board);
  console.log(renderBoard(state.board));
  console.log(renderHands(state));
  console.log(`盤上の駒数: 先手 ${counts.sente} / 後手 ${counts.gote}`);
  console.log(`手番: ${state.turn === 'sente' ? '先手' : '後手'}  (${state.ply} 手目まで進行)`);
  console.log(
    `最大連鎖数: 先手 ${state.maxChainCount.sente} / 後手 ${state.maxChainCount.gote}`,
  );
  console.log(`状態: ${renderResult(state.result)}`);
}

function listMoves(state: GameState): void {
  const moves = legalMoves(state);
  console.log(`合法手 ${moves.length} 通り:`);
  for (const move of moves) {
    console.log(`  ${formatMove(move).padEnd(6)} ${describeMove(move)}`);
  }
  if (moves.length === 0) console.log('  （合法手なし → パス）');
}

function main(): void {
  const args = process.argv.slice(2);
  const showSteps = args.includes('--steps');
  const showMoves = args.includes('--moves');
  const path = args.find((arg: string) => !arg.startsWith('--'));

  let state = initialGameState();

  if (!path) {
    console.log('=== 初期局面 ===');
    printState(state);
    if (showMoves) {
      console.log('');
      listMoves(state);
    }
    return;
  }

  const moves = parseKifu(readFileSync(path, 'utf8'));
  console.log(`=== 棋譜: ${path}（${moves.length} 手）===\n`);
  console.log('--- 初期局面 ---');
  printState(state);

  for (const [index, move] of moves.entries()) {
    let outcome;
    try {
      outcome = applyMoveWithDetail(state, move);
    } catch (error) {
      console.error(
        `\n${index + 1} 手目 "${formatMove(move)}" で失敗: ${(error as Error).message}`,
      );
      console.error('ここで棋譜の読み込みを中止しました。');
      process.exitCode = 1;
      return;
    }
    state = outcome.state;

    const header = `${index + 1} 手目: ${formatMove(move)}  (${describeMove(move)})`;
    if (showSteps) {
      console.log(`\n--- ${header} ---`);
      if (outcome.chainCount > 0) {
        console.log(`${outcome.chainCount} 連鎖:`);
        outcome.flipSteps.forEach((step, level) => {
          console.log(`  ${level + 1}段目: ${step.map(formatPos).join(' ')}`);
        });
      }
      if (outcome.captured) {
        console.log(`取った駒: ${KANJI[outcome.captured.type]}`);
      }
      printState(state);
    } else {
      const flipNote =
        outcome.chainCount > 0
          ? `  ${outcome.chainCount} 連鎖 / 反転 ${outcome.flips.length} 枚`
          : '';
      const captureNote = outcome.captured ? `  ${KANJI[outcome.captured.type]}を取った` : '';
      console.log(`${header}${flipNote}${captureNote}`);
    }

    if (state.result.kind !== 'playing') {
      console.log(`\n対局終了: ${renderResult(state.result)}`);
      break;
    }
  }

  if (!showSteps) {
    console.log('\n--- 最終局面 ---');
    printState(state);
  }

  if (showMoves) {
    console.log('');
    listMoves(state);
  }
}

main();
