import type { LocatorSpec } from '@sctech/profilevault-contract';
import type { Locator, Page } from 'playwright';

/** LocatorSpec (role + name, text, hoặc CSS) → Locator. Chỉ tạo locator; thao tác vẫn qua `ctx.ui`. */
export function locate(page: Page, spec: LocatorSpec, opts: { exact?: boolean } = {}): Locator {
  if (spec.role) return page.getByRole(spec.role as Parameters<Page['getByRole']>[0], spec.name !== undefined ? { name: spec.name, exact: opts.exact ?? true } : {});
  if (spec.text !== undefined) return page.getByText(spec.text, { exact: opts.exact ?? true });
  if (spec.css !== undefined) return page.locator(spec.css);
  return page.getByLabel(spec.name ?? '', { exact: opts.exact ?? true });
}
