# Hợp đồng: `@sctech/profilevault-health` (phần 003)

```ts
interface HealthService {
  // binding
  createBinding(input: CreateBindingInput, actor?: 'user' | 'client'): Promise<Binding>;
  updateBinding(id: string, patch: UpdateBindingInput, actor?: 'user' | 'client'): Promise<Binding>;
  archiveBinding(id: string, actor?: 'user'): Promise<void>;
  getBinding(id: string): Binding | undefined;
  getBindingByProfile(furyProfileId: string): Binding | undefined;
  listBindings(opts?: { includeArchived?: boolean }): Binding[];
  // sự kiện
  recordManualEvent(bindingId: string, type: ManualEventType, occurredAt?: string, note?: string, actor?: string): Promise<HealthEventRecord>;
  recordDetectSuite(input: DetectSuiteInput, actor?: 'user'): Promise<void>;
  recordSessionCheck(bindingId: string, outcome: SessionCheckOutcome): Promise<void>;
  recordRunOutcome(input: RunOutcomeInput): Promise<void>;
  recordFuryProfileStatus(profileId: string, open: boolean, at: string): Promise<void>;
  recordFuryVersionChanged(from: string | undefined, to: string | undefined): Promise<void>;
  listEvents(bindingId: string | null, filter?: { types?: string[]; since?: string; until?: string; limit?: number }): HealthEventRecord[];
  // mức
  evaluateReadiness(bindingId: string, opts?: { fresh?: boolean }): Promise<Readiness>;
  promote(bindingId: string, actor: 'user'): Promise<LevelChange>;
  pause(bindingId: string, actor: 'user', note?: string): Promise<Pause>;
  clearPause(pauseId: string, actor: 'user'): Promise<void>;
  listPauses(bindingId: string, opts?: { open?: boolean }): Pause[];
  listLevelChanges(bindingId: string): LevelChange[];
  getThresholds(): Thresholds; setThresholds(t: Thresholds, actor: 'user'): void;
  registerConditionEvaluator(kind: 'consistency_clear' | 'checklist_valid', fn: ConditionEvaluator): void;
  onReadinessReached(listener: (bindingId: string, toLevel: AutomationLevel) => void): () => void;
  // proxy
  runProxyCheckNow(bindingId: string): Promise<ProxyCheck>;
  listProxyChecks(bindingId: string, limit?: number): ProxyCheck[];
  // vòng đời
  start(): void; stop(): void;
}
```

`createHealth(deps: { database; bus; clock; timers?; fury: FuryClient; logger; config: Config; audit: AuditRepo; settings: SettingsRepo; random?: () => number; schedulerSeed?: number }) → { health: HealthService; policy: LevelPolicy; proxy: ProxyCheckService; scheduler: HealthScheduler; thresholdsSeeder: Seeder }`

Nối poller: `health.recordFuryProfileStatus` ← `PollerOptions.onProfileStatusChanged`; `health.recordFuryVersionChanged` ← `onVersionChanged`.
