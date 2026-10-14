import { describe, expect, it } from 'vitest';
import { ProfileVaultApiError, ProfileVaultClient } from '../client.js';

/** Đích chạy contract test: ProfileVault thật hoặc `MockProfileVault` (SPEC-09 §5). */
export interface ContractTarget {
  baseUrl: string;
  /** Token có `accounts.read, jobs.read, jobs.write`, không lọc flow. */
  fullToken: string;
  /** Token chỉ có `jobs.read`. */
  readOnlyToken: string;
  /** Token có `jobs.write` nhưng chỉ được `youtube/upload`. */
  uploadOnlyToken: string;
  /** Tài khoản ở L1+ (gửi được `youtube/session-check`). */
  account: { platform: string; accountId: string };
  /** Tài khoản ở L0. */
  lowAccount: { platform: string; accountId: string };
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    return err instanceof ProfileVaultApiError ? `${err.status} ${err.code}` : String(err);
  }
}

/** Bộ contract test `profilevault/v1`: dùng trong test của app gọi, chạy với server giả lập hoặc server thật. */
export function defineContractSuite(name: string, target: () => ContractTarget): void {
  describe(`contract profilevault/v1 — ${name}`, () => {
    const client = (token: string) => new ProfileVaultClient({ baseUrl: target().baseUrl, token, maxRetries: 0 });

    it('health: contractVersion; token sai → 401 UNAUTHORIZED', async () => {
      const t = target();
      expect(await client(t.fullToken).health()).toMatchObject({ service: 'ok', contractVersion: 'profilevault/v1' });
      expect(await code(client('pv_wrongtok_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx').health())).toBe('401 UNAUTHORIZED');
    });

    it('accounts + flows đọc được và đúng schema', async () => {
      const t = target();
      const accounts = await client(t.fullToken).accounts(t.account.platform);
      expect(accounts.find((a) => a.accountId === t.account.accountId)?.flows.map((f) => f.flowId)).toContain(`${t.account.platform}/session-check`);
      expect((await client(t.fullToken).flows()).map((f) => f.flowId)).toContain(`${t.account.platform}/session-check`);
    });

    it('gửi job hợp lệ → 201; cùng idempotencyKey → job cũ (duplicate); đọc + hủy', async () => {
      const t = target();
      const c = client(t.fullToken);
      const key = `contract:${Date.now()}:${Math.random()}`;
      const first = await c.submitJob({ flowId: `${t.account.platform}/session-check`, account: t.account, idempotencyKey: key, source: { app: 'contract-suite' } });
      expect(first).toMatchObject({ duplicate: false, job: { status: 'queued', flowId: `${t.account.platform}/session-check`, account: t.account } });
      const again = await c.submitJob({ flowId: `${t.account.platform}/session-check`, account: t.account, idempotencyKey: key });
      expect(again.duplicate).toBe(true);
      expect(again.job.id).toBe(first.job.id);
      expect((await c.getJob(first.job.id)).id).toBe(first.job.id);
      expect((await c.listJobs({ limit: 5 })).jobs.map((j) => j.id)).toContain(first.job.id);
      expect((await c.cancelJob(first.job.id)).status).toBe('cancelled');
    });

    it('sai schema → 400 INPUT_INVALID; tài khoản chưa gắn → 404; mức thấp → 422 LEVEL_TOO_LOW', async () => {
      const t = target();
      const c = client(t.fullToken);
      expect(await code(c.submitJob({ flowId: 'không hợp lệ', account: t.account, idempotencyKey: 'x' }))).toBe('400 INPUT_INVALID');
      expect(await code(c.submitJob({ flowId: `${t.account.platform}/session-check`, account: { platform: t.account.platform, accountId: 'UCkhongcoaixxxxxxxxxxxx' }, idempotencyKey: 'nb' }))).toBe('404 ACCOUNT_NOT_BOUND');
      expect(await code(c.submitJob({ flowId: `${t.account.platform}/session-check`, account: t.lowAccount, idempotencyKey: `low:${Date.now()}` }))).toBe('422 LEVEL_TOO_LOW');
    });

    it('thiếu scope hoặc ngoài bộ lọc flow → 403 FORBIDDEN_SCOPE', async () => {
      const t = target();
      expect(await code(client(t.readOnlyToken).submitJob({ flowId: `${t.account.platform}/session-check`, account: t.account, idempotencyKey: 'ro' }))).toBe('403 FORBIDDEN_SCOPE');
      expect(await code(client(t.uploadOnlyToken).submitJob({ flowId: `${t.account.platform}/session-check`, account: t.account, idempotencyKey: 'flt' }))).toBe('403 FORBIDDEN_SCOPE');
    });
  });
}
