import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintPackSource } from '../src/index.js';

/** Plugin skill M2 (SPEC-08): metadata hợp lệ, mẫu flow qua linter pack, không skill nào được làm hành động chỉ-dành-cho-người. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../skills/profilevault');
const skillsDir = path.join(root, 'skills');

describe('plugin skill ProfileVault (SPEC-08)', () => {
  it('plugin.json liệt kê đúng 5 skill có SKILL.md; frontmatter name khớp thư mục, có description', () => {
    const plugin = JSON.parse(readFileSync(path.join(root, 'plugin.json'), 'utf8')) as { skills: string[] };
    const names = readdirSync(skillsDir).sort();
    expect(names).toEqual(['account-setup', 'flow-author', 'health-check', 'job-planner', 'profilevault']);
    expect(plugin.skills.map((s) => path.basename(s)).sort()).toEqual(names);
    for (const name of names) {
      const md = readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---\n/.exec(md.replace(/\r\n/g, '\n'))?.[1] ?? '';
      expect(/^name:\s*(.+)$/m.exec(fm)?.[1]?.trim()).toBe(name);
      expect((/^description:\s*(.+)$/m.exec(fm)?.[1] ?? '').length).toBeGreaterThan(40);
    }
  });

  it('mọi tool MCP nhắc trong skill đều có thật; không có tool lên mức/gỡ dừng/xác nhận', () => {
    const real = new Set(['pv_accounts_list', 'pv_flows_list', 'pv_jobs_submit', 'pv_jobs_get', 'pv_jobs_list', 'pv_jobs_cancel', 'pv_jobs_wait', 'pv_readiness_overview', 'pv_binding_detail', 'pv_consistency_report', 'pv_events_list', 'pv_binding_create', 'pv_event_record', 'pv_probe_import', 'pv_consistency_run']);
    for (const name of readdirSync(skillsDir)) {
      const md = readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8');
      for (const tool of md.match(/\bpv_[a-z_]+/g) ?? []) expect(real, `${name}: ${tool}`).toContain(tool);
    }
  });

  it('mẫu flow của flow-author qua linter pack', () => {
    const file = path.join(skillsDir, 'flow-author', 'references', 'template.ts');
    expect(existsSync(file)).toBe(true);
    expect(lintPackSource(readFileSync(file, 'utf8'), 'template.ts')).toEqual([]);
  });
});
