import { OpenAndWaitInputSchema, OpenAndWaitOutputSchema } from '@sctech/profilevault-contract';
import { defineFlow } from '@sctech/profilevault-runner';

/** `generic/open-and-wait` (SPEC-04 §2.5): mở một trang trong profile rồi chờ người làm tay. Không dùng để đăng nhập. */
export const openAndWait = defineFlow({ id: 'generic/open-and-wait', version: '1.0.0', description: 'Mở trang rồi chờ người thao tác', minLevel: 1, site: ['studio.youtube.com', 'www.youtube.com'], timeoutMinutes: 10 }, OpenAndWaitInputSchema, OpenAndWaitOutputSchema, async (ctx) => {
  await ctx.step('open', () => ctx.ui.goto(ctx.input.url));
  const answer = await ctx.step('wait', () => ctx.humanGate({ reason: 'custom', message: ctx.input.message, choices: [{ id: 'done', label: 'Xong' }, { id: 'cancel', label: 'Hủy' }], keepProfileOpen: true }));
  return { choice: 'done' as const, ...(answer.note ? { note: answer.note } : {}) };
});
