/**
 * Schema CSDL theo SPEC-00 §8. Cột thời gian TEXT ISO 8601; cột `*_json` TEXT chứa JSON đã kiểm qua Zod.
 * Nguồn sự thật là SQL trong ./migrations; schema này phải khớp để truy vấn có kiểu.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const pvMigrations = sqliteTable('pv_migrations', {
  seq: integer('seq').primaryKey(),
  name: text('name').notNull(),
  appliedAt: text('applied_at').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const settingsHistory = sqliteTable('settings_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  oldJson: text('old_json'),
  newJson: text('new_json').notNull(),
  actor: text('actor').notNull(),
  createdAt: text('created_at').notNull(),
});

export const bindings = sqliteTable(
  'bindings',
  {
    id: text('id').primaryKey(),
    platform: text('platform').notNull(),
    accountId: text('account_id').notNull(),
    displayName: text('display_name').notNull(),
    furyProfileId: text('fury_profile_id').notNull().unique(),
    marketCountry: text('market_country').notNull(),
    packConfigJson: text('pack_config_json').notNull().default('{}'),
    allowedRootsJson: text('allowed_roots_json').notNull().default('[]'),
    level: integer('level').notNull().default(0),
    levelSince: text('level_since').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),
  },
  (t) => [
    unique('bindings_platform_account_unique').on(t.platform, t.accountId),
    check('bindings_level_check', sql`${t.level} BETWEEN 0 AND 3`),
  ],
);

export const bindingPauses = sqliteTable(
  'binding_pauses',
  {
    id: text('id').primaryKey(),
    bindingId: text('binding_id')
      .notNull()
      .references(() => bindings.id),
    reason: text('reason').notNull(),
    detailJson: text('detail_json').notNull().default('{}'),
    createdAt: text('created_at').notNull(),
    clearedAt: text('cleared_at'),
    clearedBy: text('cleared_by'),
  },
  (t) => [index('ix_pauses_open').on(t.bindingId).where(sql`${t.clearedAt} IS NULL`)],
);

export const levelChanges = sqliteTable(
  'level_changes',
  {
    id: text('id').primaryKey(),
    bindingId: text('binding_id')
      .notNull()
      .references(() => bindings.id),
    fromLevel: integer('from_level').notNull(),
    toLevel: integer('to_level').notNull(),
    kind: text('kind').notNull(),
    reason: text('reason').notNull(),
    detailJson: text('detail_json').notNull().default('{}'),
    actor: text('actor').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [check('level_changes_kind_check', sql`${t.kind} IN ('promote','demote')`)],
);

export const healthEvents = sqliteTable(
  'health_events',
  {
    id: text('id').primaryKey(),
    bindingId: text('binding_id').references(() => bindings.id),
    type: text('type').notNull(),
    severity: text('severity').notNull(),
    source: text('source').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    occurredAt: text('occurred_at').notNull(),
    recordedAt: text('recorded_at').notNull(),
  },
  (t) => [index('ix_events_binding_time').on(t.bindingId, t.occurredAt)],
);

export const proxyChecks = sqliteTable('proxy_checks', {
  id: text('id').primaryKey(),
  bindingId: text('binding_id')
    .notNull()
    .references(() => bindings.id),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  exitIp: text('exit_ip'),
  country: text('country'),
  city: text('city'),
  timezone: text('timezone'),
  asn: integer('asn'),
  asnOrg: text('asn_org'),
  asnType: text('asn_type'),
  latencyMs: integer('latency_ms'),
  error: text('error'),
  checkedAt: text('checked_at').notNull(),
});

export const asnAttestations = sqliteTable('asn_attestations', {
  asn: integer('asn').primaryKey(),
  asnType: text('asn_type').notNull(),
  note: text('note'),
  createdAt: text('created_at').notNull(),
});

export const probeResults = sqliteTable(
  'probe_results',
  {
    id: text('id').primaryKey(),
    bindingId: text('binding_id')
      .notNull()
      .references(() => bindings.id),
    furyVersion: text('fury_version').notNull(),
    source: text('source').notNull(),
    capturedAt: text('captured_at').notNull(),
    dataJson: text('data_json').notNull(),
    rawPath: text('raw_path').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [check('probe_results_source_check', sql`${t.source} IN ('manual_import','flow')`)],
);

export const detectSuiteResults = sqliteTable('detect_suite_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  furyVersion: text('fury_version').notNull(),
  bindingId: text('binding_id').references(() => bindings.id),
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  summary: text('summary'),
  recordedAt: text('recorded_at').notNull(),
});

export const accountChecklists = sqliteTable('account_checklists', {
  bindingId: text('binding_id')
    .primaryKey()
    .references(() => bindings.id),
  accountRegion: text('account_region'),
  channelCountry: text('channel_country'),
  accountLanguage: text('account_language'),
  recoveryEmailHmac: text('recovery_email_hmac'),
  recoveryPhoneHmac: text('recovery_phone_hmac'),
  twofaEnabled: integer('twofa_enabled', { mode: 'boolean' }),
  exclusiveLoginConfirmed: integer('exclusive_login_confirmed', { mode: 'boolean' }),
  studioLanguageSet: integer('studio_language_set', { mode: 'boolean' }),
  confirmedAt: text('confirmed_at'),
  expiresAt: text('expires_at'),
  updatedAt: text('updated_at').notNull(),
});

export const hostSnapshots = sqliteTable('host_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  os: text('os').notNull(),
  osVersion: text('os_version').notNull(),
  gpusJson: text('gpus_json').notNull(),
  displaysJson: text('displays_json').notNull(),
  ramMb: integer('ram_mb').notNull(),
  capturedAt: text('captured_at').notNull(),
});

export const consistencyRules = sqliteTable('consistency_rules', {
  id: text('id').primaryKey(),
  layer: text('layer').notNull(),
  severity: text('severity').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  paramsJson: text('params_json').notNull().default('{}'),
  updatedAt: text('updated_at').notNull(),
});

export const consistencyRuns = sqliteTable('consistency_runs', {
  id: text('id').primaryKey(),
  trigger: text('trigger').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
});

export const consistencyResults = sqliteTable(
  'consistency_results',
  {
    runId: text('run_id')
      .notNull()
      .references(() => consistencyRuns.id),
    bindingId: text('binding_id')
      .notNull()
      .references(() => bindings.id),
    ruleId: text('rule_id').notNull(),
    status: text('status').notNull(),
    severity: text('severity').notNull(),
    actualJson: text('actual_json'),
    expectedJson: text('expected_json'),
    hint: text('hint'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.bindingId, t.ruleId] })],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull(),
    flowId: text('flow_id').notNull(),
    bindingId: text('binding_id')
      .notNull()
      .references(() => bindings.id),
    idempotencyKey: text('idempotency_key').notNull(),
    inputJson: text('input_json').notNull(),
    mode: text('mode'),
    status: text('status').notNull(),
    resultJson: text('result_json'),
    errorCode: text('error_code'),
    errorDetailJson: text('error_detail_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [unique('jobs_client_idempotency_unique').on(t.clientId, t.idempotencyKey)],
);

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => jobs.id),
  bindingId: text('binding_id')
    .notNull()
    .references(() => bindings.id),
  flowId: text('flow_id').notNull(),
  flowVersion: text('flow_version').notNull(),
  status: text('status').notNull(),
  currentStep: text('current_step'),
  attempt: integer('attempt').notNull().default(1),
  checkpointJson: text('checkpoint_json'),
  needsUserJson: text('needs_user_json'),
  launchedByRun: integer('launched_by_run', { mode: 'boolean' }).notNull().default(false),
  queuedAt: text('queued_at').notNull(),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  errorCode: text('error_code'),
  errorDetailJson: text('error_detail_json'),
  artifactsDir: text('artifacts_dir'),
});

export const runSteps = sqliteTable(
  'run_steps',
  {
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    attempts: integer('attempts').notNull(),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    errorCode: text('error_code'),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey(),
  flowId: text('flow_id').notNull(),
  targetJson: text('target_json').notNull(),
  daysOfWeek: text('days_of_week').notNull(),
  windowStart: text('window_start').notNull(),
  windowEnd: text('window_end').notNull(),
  paramsJson: text('params_json').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  nextRunAt: text('next_run_at'),
  lastRunAt: text('last_run_at'),
  createdAt: text('created_at').notNull(),
});

export const clients = sqliteTable('clients', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenPrefix: text('token_prefix').notNull().unique(),
  tokenHash: text('token_hash').notNull(),
  scopesJson: text('scopes_json').notNull(),
  flowFilterJson: text('flow_filter_json').notNull().default('["*"]'),
  bindingFilterJson: text('binding_filter_json').notNull().default('["*"]'),
  rateLimitPerMin: integer('rate_limit_per_min').notNull().default(120),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
  lastUsedAt: text('last_used_at'),
});

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  detailJson: text('detail_json').notNull().default('{}'),
  createdAt: text('created_at').notNull(),
});

/** Tên 21 bảng nghiệp vụ theo SPEC-00 §8 (không gồm `pv_migrations`). */
export const SPEC_TABLE_NAMES = [
  'settings',
  'settings_history',
  'bindings',
  'binding_pauses',
  'level_changes',
  'health_events',
  'proxy_checks',
  'asn_attestations',
  'probe_results',
  'detect_suite_results',
  'account_checklists',
  'host_snapshots',
  'consistency_rules',
  'consistency_runs',
  'consistency_results',
  'jobs',
  'runs',
  'run_steps',
  'schedules',
  'clients',
  'audit_events',
] as const;

/** Bảng chỉ thêm, không sửa/xóa (trừ dọn theo retention). */
export const APPEND_ONLY_TABLES = ['health_events', 'level_changes', 'audit_events', 'settings_history'] as const;
