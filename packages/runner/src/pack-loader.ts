import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { satisfies } from 'semver';
import { FLOW_API_VERSION, ForbiddenPatternsSchema, JsonObjectSchema, PackManifestSchema, PvError, YoutubeBindingConfigSchema, type FlowInfo, type PackManifest } from '@sctech/profilevault-contract';
import { Ajv, type ValidateFunction } from 'ajv';
import { lintPackSource } from '@sctech/eslint-plugin-pv';
import type { FlowDefinition } from './flow.js';

export interface LoadedPack { manifest: PackManifest; status: 'enabled' | 'disabled'; reason?: string; forbidden: string[]; flows: FlowDefinition[]; directory: string }
function sources(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['test', 'fixtures', 'node_modules', 'vitest.config.ts'].includes(entry.name)) return [];
    if (entry.isSymbolicLink()) throw new Error('Pack không được chứa liên kết tới mã ngoài thư mục');
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : /\.(?:ts|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [file] : [];
  });
}
export class PackLoader {
  readonly packs = new Map<string, LoadedPack>();
  private readonly lintCache = new Map<string, string[]>();
  private readonly bindingValidators = new Map<string, ValidateFunction>();
  constructor(private readonly furyVersion: () => string | undefined) {}
  async load(directory: string): Promise<LoadedPack> {
    const manifest = PackManifestSchema.parse(JSON.parse(readFileSync(path.join(directory, 'pack.json'), 'utf8')));
    const pack: LoadedPack = { manifest, status: 'enabled', forbidden: [], flows: [], directory };
    try {
      if (!satisfies(FLOW_API_VERSION, manifest.appApi)) throw new Error('Flow API không tương thích');
      const schemaPath = path.resolve(directory, manifest.bindingConfigSchema);
      if (!schemaPath.startsWith(path.resolve(directory) + path.sep)) throw new Error('Schema cấu hình pack ngoài thư mục');
      const schema = JsonObjectSchema.parse(JSON.parse(readFileSync(schemaPath, 'utf8')));
      this.bindingValidators.set(manifest.id, new Ajv({ allErrors: true, strict: false }).compile(schema));
      for (const file of manifest.forbiddenActions) {
        const resolved = path.resolve(directory, file);
        if (!resolved.startsWith(path.resolve(directory) + path.sep)) throw new Error('Đường dẫn pack ngoài thư mục');
        pack.forbidden.push(...ForbiddenPatternsSchema.parse(JSON.parse(readFileSync(resolved, 'utf8'))));
      }
      const files = sources(directory).sort();
      const hash = createHash('sha256'); for (const file of files) hash.update(file).update(readFileSync(file));
      const key = hash.digest('hex');
      for (const file of files) {
        const code = readFileSync(file, 'utf8');
        for (const match of code.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
          const source = match[1]!; if (!source.startsWith('.')) continue;
          const resolved = path.resolve(path.dirname(file), source);
          if (!resolved.startsWith(path.resolve(directory) + path.sep) || /(?:^|[\\/])(?:test|fixtures|node_modules)(?:[\\/]|$)|vitest\.config/.test(resolved)) throw new Error('Import của pack ra ngoài phạm vi mã đã lint');
        }
      }
      let errors = this.lintCache.get(key);
      if (!errors) { errors = files.flatMap((file) => lintPackSource(readFileSync(file, 'utf8'), path.basename(file))); this.lintCache.set(key, errors); }
      if (errors.length) throw new Error(errors.join('\n'));
      const module = await import(`${pathToFileURL(path.join(directory, 'dist', 'index.js')).href}?v=${key}`) as { flows: FlowDefinition[] };
      if (!Array.isArray(module.flows)) throw new Error('Pack thiếu flows');
      for (const flow of module.flows) {
        if (!manifest.flows.includes(flow.manifest.id.split('/')[1] ?? '') || !flow.manifest.id.startsWith(manifest.id + '/')) throw new Error('Flow không có trong manifest');
        if (!flow.input?.parse || !flow.output?.parse || typeof flow.run !== 'function') throw new Error('Flow contract không hợp lệ');
      }
      pack.flows = module.flows;
    } catch (err) { pack.status = 'disabled'; pack.reason = err instanceof Error ? err.message : String(err); }
    this.packs.set(manifest.id, pack);
    return pack;
  }
  get(id: string): { flow: FlowDefinition; pack: LoadedPack } | undefined {
    for (const pack of this.packs.values()) { const flow = pack.flows.find((f) => f.manifest.id === id); if (flow) return { flow, pack }; }
    return undefined;
  }
  assertEnabled(id: string, actualVersion?: string): { flow: FlowDefinition; pack: LoadedPack } {
    const found = this.get(id);
    if (!found) {
      const pack = this.packs.get(id.split('/')[0] ?? '');
      if (pack?.status === 'disabled' && pack.manifest.flows.includes(id.split('/')[1] ?? '')) throw new PvError('FLOW_DISABLED', 'Pack bị vô hiệu', { flowId: id, reason: pack.reason });
      throw new PvError('FLOW_NOT_FOUND', 'Không có flow', { flowId: id });
    }
    const version = actualVersion ?? this.furyVersion();
    if (found.pack.status !== 'enabled' || version && !satisfies(version, found.pack.manifest.furyVersions)) throw new PvError('FLOW_DISABLED', 'Pack bị vô hiệu', { flowId: id, reason: found.pack.reason ?? 'fury_version' });
    return found;
  }
  validateBinding(platform: string, config: unknown): void {
    const pack = [...this.packs.values()].find((p) => p.manifest.platform === platform);
    const validate = pack && this.bindingValidators.get(pack.manifest.id);
    if (pack?.status === 'disabled') throw new PvError('FLOW_DISABLED', 'Pack nền tảng bị vô hiệu');
    if (validate && !validate(config)) throw new PvError('INPUT_INVALID', 'Cấu hình binding không đúng schema pack', { fields: validate.errors?.map((e) => e.instancePath) });
    if (!validate && platform === 'youtube') YoutubeBindingConfigSchema.parse(config);
  }
  listFlows(): FlowInfo[] {
    return [...this.packs.values()].flatMap((p) => p.manifest.flows.map((name) => {
      const flow = p.flows.find((f) => f.manifest.id === `${p.manifest.id}/${name}`);
      const supported = !this.furyVersion() || satisfies(this.furyVersion()!, p.manifest.furyVersions);
      return { id: `${p.manifest.id}/${name}`, version: flow?.manifest.version ?? p.manifest.version, minLevel: flow?.manifest.minLevel ?? 1, modes: flow?.manifest.modes ?? [], description: flow?.manifest.description, countsAsUpload: flow?.manifest.countsAsUpload ?? false, status: p.status === 'enabled' && supported ? 'enabled' : 'disabled', reason: p.reason ?? (!supported ? 'Phiên bản Fury không tương thích' : undefined) };
    }));
  }
}
