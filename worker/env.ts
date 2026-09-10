/**
 * Worker に渡されるバインディング。wrangler.jsonc と対応している。
 */
export interface Env {
  /** D1（SQLite）。プレイヤーと対局履歴 */
  readonly DB: D1Database;
  /** 対局ごとの Durable Object */
  readonly MATCH: DurableObjectNamespace;
  /** マッチング待ちの行列を持つ Durable Object（インスタンスは1個だけ使う） */
  readonly LOBBY: DurableObjectNamespace;
  /** 署名トークンの秘密鍵。`npx wrangler secret put TOKEN_SECRET` で設定する */
  readonly TOKEN_SECRET: string;
}
