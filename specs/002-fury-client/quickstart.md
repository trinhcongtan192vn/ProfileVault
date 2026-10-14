# Quickstart: 002 FuryClient

```powershell
pnpm build
pnpm exec vitest run --project fury-client
```

Mong đợi: test `version`, `adapter`, `http-client`, `poller`, `fake-fury` xanh; không cần Fury thật.

Dùng thử nhanh với FakeFury (script tạm):

```ts
import { HttpFuryClient } from '@sctech/profilevault-fury-client';
import { FakeFury } from '@sctech/profilevault-fury-client/testing';
const fake = new FakeFury({ version: '0.2.23' });
const baseUrl = await fake.start();
fake.setProfiles([{ id: 'p1', name: 'Kênh A', timezone: 'Europe/Berlin' }]);
const client = new HttpFuryClient({ baseUrl, supportedVersions: '>=0.2.21 <0.4.0' });
console.log(await client.health(), await client.getProfile('p1'));
await fake.stop();
```
