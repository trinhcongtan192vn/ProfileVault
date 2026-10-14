import { ReadPageInputSchema, ReadPageOutputSchema } from '@sctech/profilevault-contract';
import { defineFlow, locate } from '@sctech/profilevault-runner';

/** `generic/read-page` (SPEC-04 §2.4): chỉ đọc, không click. URL phải thuộc domain của nền tảng binding (Runner + SafeUi kiểm). */
export const readPage = defineFlow({ id: 'generic/read-page', version: '1.0.0', description: 'Đọc giá trị từ một trang của nền tảng', minLevel: 1, site: ['studio.youtube.com', 'www.youtube.com'], timeoutMinutes: 5 }, ReadPageInputSchema, ReadPageOutputSchema, async (ctx) => {
  await ctx.step('open', () => ctx.ui.goto(ctx.input.url));
  const values = await ctx.step('read', async () => {
    const out: Record<string, string | null> = {};
    for (const field of ctx.input.fields) {
      const target = locate(ctx.page, field.locator).first();
      out[field.name] = (await ctx.ui.exists(target, 5)) ? (await ctx.ui.read(target)).trim() : null;
    }
    return out;
  });
  return { values };
});
