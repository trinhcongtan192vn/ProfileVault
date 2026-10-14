import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@sctech/profilevault-contract';
import { ClientsRepo, openTestDatabase, stripHash, type TestDatabase } from '../src/index.js';

let t: TestDatabase;
beforeEach(() => {
  t = openTestDatabase();
});
afterEach(() => t.cleanup());

describe('ClientsRepo', () => {
  it('insert/get/byPrefix/list/revoke/touch; stripHash bỏ tokenHash; prefix UNIQUE', () => {
    const repo = new ClientsRepo(t.database.db);
    const row = { id: newId('client'), name: 'app', tokenPrefix: 'abcdefgh', tokenHash: '$argon2id$x', scopes: ['jobs.read' as const], flowFilter: ['*'], bindingFilter: ['*'], rateLimitPerMin: 120, createdAt: '2026-10-14T00:00:00.000Z', revokedAt: null, lastUsedAt: null };
    repo.insert(row);
    expect(repo.get(row.id)).toEqual(row);
    expect(repo.byPrefix('abcdefgh')?.id).toBe(row.id);
    expect(Object.keys(stripHash(row))).not.toContain('tokenHash');
    repo.touch(row.id, '2026-10-15T00:00:00.000Z');
    repo.revoke(row.id, '2026-10-16T00:00:00.000Z');
    expect(repo.list()[0]).toMatchObject({ lastUsedAt: '2026-10-15T00:00:00.000Z', revokedAt: '2026-10-16T00:00:00.000Z' });
    expect(() => repo.insert({ ...row, id: newId('client') })).toThrow(/UNIQUE/);
  });
});
