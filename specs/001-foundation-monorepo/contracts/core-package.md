# Hợp đồng: `@sctech/profilevault-core` và `@sctech/profilevault-db` (bề mặt xuất ở 001)

## `@sctech/profilevault-db`
- `schema` (namespace mọi bảng Drizzle) và từng bảng: `settings`, `settingsHistory`, `bindings`, `bindingPauses`, `levelChanges`, `healthEvents`, `proxyChecks`, `asnAttestations`, `probeResults`, `detectSuiteResults`, `accountChecklists`, `hostSnapshots`, `consistencyRules`, `consistencyRuns`, `consistencyResults`, `jobs`, `runs`, `runSteps`, `schedules`, `clients`, `auditEvents`, `pvMigrations`
- `openDatabase({ file, migrate?: boolean }): Database` với `Database = { sqlite: BetterSqlite3.Database; db: DrizzleDb; close(): void }`
- `applyMigrations(sqlite, migrationsDir?): { applied: string[]; current: number }`
- `class MigrationNewerThanCodeError extends PvError` (code `INTERNAL`, detail `{ dbVersion, codeVersion }`)
- `SettingsRepo`: `get<T>(key, schema?): T | undefined`, `set(key, value, actor)`, `history(key)`
- `AuditRepo`: `append({ actorType, actorId?, action, targetType?, targetId?, detail? })`, `list({ action?, since?, limit? })`
- `pruneAppendOnly(db, { retentionMonths, now })`
- `openTestDatabase(): { database: Database; file: string; cleanup(): void }`
- `MIGRATIONS_DIR` (đường dẫn tuyệt đối thư mục migrations trong package)

## `@sctech/profilevault-core`
- `resolvePaths(env = process.env): Paths`
- `loadConfig(paths, env = process.env): Config` (ném `PvError('INPUT_INVALID')`)
- `interface SecretStore { get(key: SecretKey): Promise<string | undefined>; set(key, value): Promise<void>; delete(key): Promise<void>; keys(): Promise<SecretKey[]>; values(): Promise<string[]> }`
- `class DpapiSecretStore implements SecretStore` (`constructor(file: string)`)
- `class MemorySecretStore implements SecretStore`
- `ensureHmacKey(store): Promise<{ created: boolean }>`
- `class EventBus { on(name, fn): () => void; once(name, fn); off(name, fn); emit(name, payload): void; listenerCount(name) }`
- `acquireInstanceLock(file, { pidAlive? }): InstanceLock` với `InstanceLock = { pid; release(): void }`; `class InstanceAlreadyRunningError`
- `createLogger({ dir, clock?, level?, redact?: () => string[], retentionDays = 7 }): Logger`; `Logger = { debug|info|warn|error(msg, data?); child(bindings); flush(); close() }`
- `class SeederRegistry { register(name, fn: (ctx: SeedContext) => void | Promise<void>); run(ctx): Promise<string[]> }` với `SeedContext = { db: Database; settings: SettingsRepo; clock: Clock; logger: Logger }`

## `@sctech/profilevault-service`
- `bootstrap(opts?: { env?; secretStore?; clock?; seeders?: SeederRegistry; logger? }): Promise<ServiceContext>`
- `ServiceContext = { paths; config; database; bus; logger; secrets; clock; firstRun: boolean; shutdown(): Promise<void> }`
- `main()` (entry `dist/main.js`): bootstrap + chờ tín hiệu
