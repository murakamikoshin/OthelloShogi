/**
 * UI から AI を呼ぶための薄いラッパ。Worker とのやりとりを Promise にする。
 */
import type { GameState, Move } from '../core/index.ts';
import { DIFFICULTY, type Difficulty } from '../ai/search.ts';
import type { AiRequest, AiResponse } from '../ai/worker.ts';

export interface AiThought {
  readonly move: Move | null;
  readonly depth: number;
  readonly nodes: number;
  readonly elapsedMs: number;
}

export class AiClient {
  private worker: Worker | null = null;
  private nextId = 1;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../ai/worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return this.worker;
  }

  /** 指し手を1つ考えてもらう。 */
  think(state: GameState, difficulty: Difficulty): Promise<AiThought> {
    const worker = this.ensureWorker();
    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent<AiResponse>): void => {
        if (event.data.id !== id) return;
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        resolve(event.data);
      };
      const onError = (event: ErrorEvent): void => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        reject(new Error(event.message));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);

      const request: AiRequest = { id, state, options: DIFFICULTY[difficulty] };
      worker.postMessage(request);
    });
  }

  /** 考え中の思考を捨てる（待った・投了・再対局のとき）。 */
  reset(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
