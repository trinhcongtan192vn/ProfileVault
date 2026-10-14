import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireInstanceLock, DpapiSecretStore, ensureHmacKey, InstanceAlreadyRunningError, MemorySecretStore } from '../src/index.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-sec-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('MemorySecretStore + ensureHmacKey', () => {
  it('ghi/đọc; ensureHmacKey chỉ sinh một lần, 32 byte', async () => {
    const s = new MemorySecretStore();
    await s.set('fury.token', 'tok');
    expect(await s.get('fury.token')).toBe('tok');
    expect((await ensureHmacKey(s)).created).toBe(true);
    const key = await s.get('hmac.key');
    expect(Buffer.from(key ?? '', 'base64')).toHaveLength(32);
    expect((await ensureHmacKey(s)).created).toBe(false);
    expect(await s.get('hmac.key')).toBe(key);
    expect((await s.keys()).sort()).toEqual(['fury.token', 'hmac.key']);
    await s.delete('fury.token');
    expect(await s.values()).toEqual([key]);
  });
});

describe.skipIf(process.platform !== 'win32')('DpapiSecretStore (chỉ Windows)', () => {
  it('ghi/đọc qua DPAPI; file không chứa giá trị gốc', async () => {
    const file = path.join(tmp(), 'secrets.bin');
    const s = new DpapiSecretStore(file);
    expect(await s.get('fury.token')).toBeUndefined();
    await s.set('fury.token', 'super-secret-token-XYZ');
    await s.set('llm.apiKey', 'sk-abc');
    expect(await s.get('fury.token')).toBe('super-secret-token-XYZ');
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('super-secret-token-XYZ');
    expect(raw).not.toContain('sk-abc');
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
    await s.delete('llm.apiKey');
    expect(await s.keys()).toEqual(['fury.token']);
    const s2 = new DpapiSecretStore(file);
    expect(await s2.get('fury.token')).toBe('super-secret-token-XYZ');
  });

  it('file hỏng → lỗi rõ ràng, không xóa tự động', async () => {
    const file = path.join(tmp(), 'secrets.bin');
    writeFileSync(file, 'not json');
    const s = new DpapiSecretStore(file);
    await expect(s.get('fury.token')).rejects.toThrow(/secrets.bin hỏng/);
    expect(existsSync(file)).toBe(true);
  });

  it('blob không giải mã được → secrets_undecryptable', async () => {
    const file = path.join(tmp(), 'secrets.bin');
    writeFileSync(file, JSON.stringify({ version: 1, entries: { 'fury.token': Buffer.from('garbage').toString('base64') } }));
    const s = new DpapiSecretStore(file);
    await expect(s.get('fury.token')).rejects.toThrow(/Không giải mã được/);
  });
});

describe('acquireInstanceLock (SPEC-00 §11)', () => {
  it('chiếm, từ chối tiến trình thứ hai khi PID sống, chiếm lại khi PID chết, release xóa file', () => {
    const file = path.join(tmp(), 'service.lock');
    const a = acquireInstanceLock(file, { pid: 111, pidAlive: () => true });
    expect(existsSync(file)).toBe(true);
    expect(() => acquireInstanceLock(file, { pid: 222, pidAlive: () => true })).toThrow(InstanceAlreadyRunningError);
    a.release();
    expect(existsSync(file)).toBe(false);

    writeFileSync(file, JSON.stringify({ pid: 999999, startedAt: 'x' }));
    const b = acquireInstanceLock(file, { pid: 333, pidAlive: () => false });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ pid: 333 });
    b.release();
  });

  it('file khóa hỏng → chiếm lại', () => {
    const file = path.join(tmp(), 'service.lock');
    writeFileSync(file, 'garbage');
    const c = acquireInstanceLock(file, { pid: 1, pidAlive: () => true });
    expect(c.pid).toBe(1);
    c.release();
  });
});
