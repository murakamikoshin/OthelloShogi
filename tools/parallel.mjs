/**
 * analyze.ts を本当に並列で走らせるための小さなヘルパー。
 * execFileSync だと順番に走ってしまい、4並列のつもりが4倍遅くなる。
 */
import { spawn } from 'node:child_process';

const ANALYZE = new URL('./analyze.ts', import.meta.url).pathname;

/** 1プロセス分を走らせて、結果の配列を返す。 */
function runChunk(games, depth, offset) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', ANALYZE, String(games), String(depth), String(offset), '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`analyze が終了コード ${code} で落ちました\n${err.slice(-2000)}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim().split('\n').at(-1)));
      } catch (error) {
        reject(new Error(`出力を読めませんでした: ${String(error)}\n${out.slice(-500)}`));
      }
    });
  });
}

/** 指定した局数を workers 個のプロセスに分けて、まとめて走らせる。 */
export async function playMany(total, depth, workers = 4) {
  const per = Math.ceil(total / workers);
  const chunks = await Promise.all(
    Array.from({ length: workers }, (_, index) => runChunk(per, depth, index * per)),
  );
  return chunks.flat().slice(0, total);
}
