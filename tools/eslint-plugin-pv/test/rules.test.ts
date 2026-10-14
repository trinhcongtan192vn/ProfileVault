import { describe, expect, it } from 'vitest';
import { lintPackSource } from '../src/index.js';
describe('Linter pack SPEC-03 §7.2', () => {
  it.each(['locator.click()', 'page.keyboard.press("Enter")', 'page.goto("https://a.com")', 'locator["fill"]("x")', 'fetch("https://a.com")', 'import fs from "node:fs"', 'page.evaluate(source)', 'page.evaluate(() => fetch("https://a.com"))', 'const name = "Publish"', 'import("node:child_process")'])('chặn %s', (source) => { expect(lintPackSource(source).length).toBeGreaterThan(0); });
  it('cho SafeUi và evaluate tĩnh đọc dữ liệu', () => {
    expect(lintPackSource('await ctx.ui.click(ctx.page.getByRole("button", {name:"Save"})); const lang = await ctx.page.evaluate(() => document.documentElement.lang);')).toEqual([]);
  });
});
