import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('khung workspace (spec 001 US1)', () => {
  it('tsconfig.base.json strict', () => {
    const base = JSON.parse(readFileSync(path.join(root, 'tsconfig.base.json'), 'utf8')) as { compilerOptions: Record<string, unknown> };
    expect(base.compilerOptions.strict).toBe(true);
    expect(base.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(base.compilerOptions.module).toBe('NodeNext');
  });

  it('pnpm-workspace.yaml đủ 4 glob', () => {
    const y = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    for (const g of ['apps/*', 'packages/*', 'packs/*', 'tools/*']) expect(y).toContain(g);
  });

  it('.gitignore chặn secrets.bin, CSDL, runs', () => {
    const g = readFileSync(path.join(root, '.gitignore'), 'utf8');
    for (const p of ['secrets.bin', '*.db', 'runs/']) expect(g).toContain(p);
  });
});
