/**
 * プレイヤー識別。ログイン不要にするため、サーバが発行した ID と署名トークンを
 * クライアントの localStorage に持たせる。
 *
 * トークンは `<playerId>.<署名>` の形。署名はサーバの秘密鍵での HMAC-SHA256 なので、
 * クライアントが他人の ID を名乗ることはできない。
 */

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function keyOf(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function sign(playerId: string, secret: string): Promise<string> {
  const key = await keyOf(secret);
  return toBase64Url(await crypto.subtle.sign('HMAC', key, encoder.encode(playerId)));
}

/** 新しいプレイヤー ID を作る。 */
export function createPlayerId(): string {
  return crypto.randomUUID();
}

/** ID からトークンを作る。 */
export async function issueToken(playerId: string, secret: string): Promise<string> {
  return `${playerId}.${await sign(playerId, secret)}`;
}

/**
 * トークンを検証して、中のプレイヤー ID を返す。偽物なら null。
 * 比較は、署名が合っているかを最後まで見る定数時間比較にしている。
 */
export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const playerId = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = await sign(playerId, secret);

  if (provided.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0 ? playerId : null;
}

/** `Authorization: Bearer <token>` からトークンを取り出す。 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token === '' ? null : token;
}

/** 名前の既定値。 */
export const DEFAULT_NAME = '名無し';

/** 表示名を整える。制御文字を落とし、長すぎるものは切る。 */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NAME;
  // 制御文字（改行を含む）を落としてから前後の空白を取る
  const cleaned = raw.replace(/\p{Cc}/gu, '').trim();
  if (cleaned === '') return DEFAULT_NAME;
  // 絵文字を途中で割らないよう、コードポイント単位で数える
  return [...cleaned].slice(0, 20).join('');
}
