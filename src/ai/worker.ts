/// <reference lib="webworker" />
/**
 * AI の思考を別スレッドで走らせる Web Worker。
 * これがないと思考中に画面が固まる。
 *
 * ルールも探索もここでは書かない。src/core と src/ai/search.ts をそのまま呼ぶだけ。
 */
import type { GameState, Move } from '../core/index.ts';
import { findBestMove, type SearchOptions } from './search.ts';

export interface AiRequest {
  readonly id: number;
  readonly state: GameState;
  readonly options: SearchOptions;
}

export interface AiResponse {
  readonly id: number;
  readonly move: Move | null;
  readonly score: number;
  readonly depth: number;
  readonly nodes: number;
  readonly elapsedMs: number;
}

self.addEventListener('message', (event: MessageEvent<AiRequest>) => {
  const { id, state, options } = event.data;
  const result = findBestMove(state, options);
  const response: AiResponse = {
    id,
    move: result.move,
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  };
  self.postMessage(response);
});
