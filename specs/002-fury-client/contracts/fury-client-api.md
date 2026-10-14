# Hợp đồng: `@sctech/profilevault-fury-client`

## Xuất chính (`.`)
- `interface FuryClient` (SPEC-01 §3): `health()`, `listProfiles()`, `getProfile(id)`, `getStatus(id)`, `launch(id, { cdp: true })`, `stop(id)`, `checkExit(id)`, `capabilities()`
- `FURY_TIMEOUTS_MS = { health: 3000, listProfiles: 5000, getProfile: 5000, getStatus: 5000, checkExit: 30000, launch: 60000, stop: 15000 }`
- `class HttpFuryClient implements FuryClient` — `constructor(opts: HttpFuryClientOptions)`
  - `HttpFuryClientOptions = { baseUrl: string; supportedVersions: string; getToken?: () => Promise<string | undefined>; fetch?: typeof fetch; timers?: Timers; clock?: Clock; logger?: Logger; endpoints?: FuryEndpointMap; profileConfigSource?: ProfileConfigFileSource }`
- `isSupportedVersion(version: string | undefined, range: string): boolean`
- `DEFAULT_ENDPOINT_MAP: FuryEndpointMap`; kiểu `FuryEndpointMap`, `EndpointSpec`, `FuryCapability`
- `interface ProfileConfigFileSource { read(profileId): Promise<Partial<FuryProfileDetail> | undefined> }`; `class FsProfileConfigFileSource`
- `class FuryStatusPoller` — `constructor(opts: PollerOptions)`; `start()`, `stop()`, `tickHealth(): Promise<FuryHealth>`, `tickStatus(): Promise<void>`, `lastHealth`
  - `PollerOptions = { client: FuryClient; bus: EventBus; clock?: Clock; timers?: Timers; logger?: Logger; listBoundProfileIds: () => string[] | Promise<string[]>; onProfileStatusChanged?: (profileId, open, at: string) => void; onVersionChanged?: (from: string | undefined, to: string | undefined) => void; healthIntervalMs?: number (60000); statusIntervalMs?: number (300000) }`
- `interface Timers { sleep(ms): Promise<void>; setInterval(fn, ms): () => void }`, `realTimers`, `class FakeTimers`
- `fromSecretStore(store: SecretStore): () => Promise<string | undefined>`

## Xuất `./testing`
- `class FakeFury`: `start(): Promise<string>` (trả baseUrl), `stop()`, `baseUrl`, `setVersion(v)`, `setAuthRequired(on, token?)`, `setProfiles(list: FakeProfile[])`, `upsertProfile(p)`, `setOpen(id, open, via?)`, `isOpen(id)`, `setExit(id, exit | { error })`, `setCapability(cap, enabled)`, `setLatency(ms)`, `failNext(n, status = 500)`, `requests()`, `clearRequests()`, `launchHandler?`, `stopHandler?`
- `FakeProfile = { id; name; tags?; personaId?; os?; persona?; seed?; timezone?; languages?; geolocation?; webrtc?; proxy?: { id; host?; username?; password? } }` (proxy credentials có mặt để test bộ chuyển đổi loại bỏ)
