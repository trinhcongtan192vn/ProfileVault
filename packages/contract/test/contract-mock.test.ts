import { afterAll, beforeAll } from 'vitest';
import { MockProfileVault, defineContractSuite } from '../src/testing/index.js';

/** Contract test với server giả lập trong package (SPEC-09 §5). */
const mock = new MockProfileVault({
  clients: [
    { token: 'pv_fulltest_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', scopes: ['accounts.read', 'jobs.read', 'jobs.write'] },
    { token: 'pv_readonly_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', scopes: ['jobs.read'] },
    { token: 'pv_uploadon_ccccccccccccccccccccccccccccccccccccccccccc', scopes: ['jobs.read', 'jobs.write'], flowFilter: ['youtube/upload'] },
  ],
  accounts: [
    { platform: 'youtube', accountId: 'UCcontractl1xxxxxxxxxx', displayName: 'L1', level: 1, paused: false },
    { platform: 'youtube', accountId: 'UCcontractl0xxxxxxxxxx', displayName: 'L0', level: 0, paused: false },
  ],
});
beforeAll(() => mock.start());
afterAll(() => mock.stop());

defineContractSuite('server giả lập', () => ({
  baseUrl: mock.baseUrl,
  fullToken: 'pv_fulltest_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  readOnlyToken: 'pv_readonly_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  uploadOnlyToken: 'pv_uploadon_ccccccccccccccccccccccccccccccccccccccccccc',
  account: { platform: 'youtube', accountId: 'UCcontractl1xxxxxxxxxx' },
  lowAccount: { platform: 'youtube', accountId: 'UCcontractl0xxxxxxxxxx' },
}));
