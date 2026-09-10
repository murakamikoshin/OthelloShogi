import { describe, expect, it } from 'vitest';
import { DEFAULT_NAME, createPlayerId, issueToken, sanitizeName, verifyToken } from './auth.ts';

const SECRET = 'テスト用の秘密鍵';

describe('署名トークン', () => {
  it('発行したトークンは検証を通り、同じ ID が取り出せる', async () => {
    const id = createPlayerId();
    const token = await issueToken(id, SECRET);
    expect(await verifyToken(token, SECRET)).toBe(id);
  });

  it('署名を書き換えると通らない', async () => {
    const id = createPlayerId();
    const token = await issueToken(id, SECRET);
    const last = token.at(-1);
    const tampered = `${token.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    expect(await verifyToken(tampered, SECRET)).toBeNull();
  });

  it('他人の ID を名乗ろうとしても通らない', async () => {
    const token = await issueToken(createPlayerId(), SECRET);
    const signature = token.slice(token.lastIndexOf('.') + 1);
    expect(await verifyToken(`${createPlayerId()}.${signature}`, SECRET)).toBeNull();
  });

  it('別の秘密鍵では通らない', async () => {
    const token = await issueToken(createPlayerId(), SECRET);
    expect(await verifyToken(token, 'ちがう鍵')).toBeNull();
  });

  it('壊れた形のトークンは通らない', async () => {
    for (const bad of ['', '.', '署名なし', '.署名だけ']) {
      expect(await verifyToken(bad, SECRET)).toBeNull();
    }
  });
});

describe('表示名の整形', () => {
  it('前後の空白を落とす', () => {
    expect(sanitizeName('  こしん  ')).toBe('こしん');
  });

  it('空なら既定名にする', () => {
    expect(sanitizeName('')).toBe(DEFAULT_NAME);
    expect(sanitizeName('   ')).toBe(DEFAULT_NAME);
    expect(sanitizeName(undefined)).toBe(DEFAULT_NAME);
    expect(sanitizeName(123)).toBe(DEFAULT_NAME);
  });

  it('制御文字を落とす', () => {
    expect(sanitizeName('あ\nい\tう')).toBe('あいう');
  });

  it('長すぎる名前は20文字に切る', () => {
    expect([...sanitizeName('あ'.repeat(50))]).toHaveLength(20);
  });

  it('絵文字を途中で割らない', () => {
    const name = sanitizeName('👑'.repeat(30));
    expect([...name]).toHaveLength(20);
    expect(name.includes('�')).toBe(false);
  });
});
