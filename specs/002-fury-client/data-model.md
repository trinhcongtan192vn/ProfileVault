# Data model: 002

Không có bảng CSDL mới. Kiểu dữ liệu (Zod trong `packages/contract/src/fury.ts`) theo **SPEC-01 §3**:

| Schema | Ghi chú |
|---|---|
| `FuryHealthSchema` | `{ reachable, version?, supported, checkedAt, error? }` — thêm `error?: string` cho lý do không reachable (`url_invalid`, `timeout`, `network`, `auth`, `bad_response`) |
| `FuryProfileSummarySchema` | `{ id, name, tags: string[], personaId?, osFamily?: 'windows'\|'macos'\|'other' }` |
| `FuryProfileDetailSchema` | Summary + `persona?`, `seed?`, `timezone?`, `languages?`, `geolocation?`, `webrtcMode?`, `proxyRef?` |
| `FuryProfileStatusSchema` | `{ open, via?: 'app'\|'api'\|'mcp'\|'unknown', since? }` |
| `FuryLaunchResultSchema` | `{ cdpEndpoint, sessionRef }` |
| `ExitInfoSchema` | `{ ok, ip?, country?, city?, timezone?, asn?, asnOrg?, asnType?, latencyMs?, error?, checkedAt }` |
| `AsnTypeSchema` | `'isp'\|'residential'\|'mobile'\|'hosting'\|'unknown'` |
| `FuryCapabilityNameSchema` | 8 tên năng lực |
| `FuryCapabilitiesSchema` | `Record<name, 'native'\|'fallback'\|'missing'>` |

Trạng thái poller (bộ nhớ): `lastHealth: FuryHealth | null`, `lastOpen: Map<string, boolean>`.

FakeFury state (bộ nhớ): `version`, `authRequired`, `token`, `profiles: Map<id, FakeProfile>`, `open: Map<id, { open, via, since }>`, `exits: Map<id, ExitScenario>`, `latencyMs`, `failQueue: number[]`, `capabilities: Set<Capability>`, `requests[]`.
