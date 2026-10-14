import { GenericSessionConfigSchema, SessionCheckInputSchema, SessionCheckOutputSchema } from '@sctech/profilevault-contract';
import { defineFlow } from '@sctech/profilevault-runner';
export const sessionCheck = defineFlow({ id: 'generic/session-check', version: '1.0.0', description: 'Kiểm phiên theo cấu hình nền tảng', minLevel: 1, site: ['studio.youtube.com', 'www.youtube.com', 'accounts.google.com'], timeoutMinutes: 5 }, SessionCheckInputSchema, SessionCheckOutputSchema, async (ctx) => {
  const config = GenericSessionConfigSchema.parse(ctx.binding.packConfig._generic);
  await ctx.step('open', () => ctx.ui.goto(config.session.url));
  return ctx.step('classify', async () => {
    const url = ctx.page.url();
    const state = new RegExp(config.session.challengeUrlPattern).test(url) ? 'challenge' : new RegExp(config.session.loggedOutUrlPattern).test(url) ? 'logged_out' : config.sites.includes(new URL(url).hostname) ? 'logged_in' : 'unknown';
    return { state };
  });
});
