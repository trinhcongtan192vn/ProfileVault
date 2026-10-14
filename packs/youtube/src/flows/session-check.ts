import { SessionCheckInputSchema, SessionCheckOutputSchema } from '@sctech/profilevault-contract';
import { defineFlow } from '@sctech/profilevault-runner';
import locators from '../../data/locators.en.json' with { type: 'json' };
/** TODO(SPIKE-P4): xác minh URL/locator bằng Fury+kênh test; hiện test với fixture. */
export const sessionCheck = defineFlow({ id: 'youtube/session-check', version: '1.0.0', description: 'Kiểm phiên, đúng kênh và ngôn ngữ Studio', minLevel: 1, site: ['studio.youtube.com', 'www.youtube.com', 'accounts.google.com'], timeoutMinutes: 5 }, SessionCheckInputSchema, SessionCheckOutputSchema, async (ctx) => {
  await ctx.step('open', () => ctx.ui.goto('https://studio.youtube.com/'));
  const classification = await ctx.step('classify', async () => {
    const url = ctx.page.url();
    if (/\/challenge\//.test(url)) return { state: 'challenge' as const };
    if (new URL(url).hostname === 'accounts.google.com') return { state: 'logged_out' as const };
    const channelId = new RegExp(locators['studio.channelPattern']).exec(url)?.[1];
    return channelId ? { state: 'logged_in' as const, channelId } : { state: 'unknown' as const };
  });
  const state = await ctx.step('verify-channel', async () => classification.state === 'logged_in' && classification.channelId !== ctx.binding.accountId ? 'wrong_account' as const : classification.state);
  const studioLanguage = await ctx.step('read-language', async () => await ctx.page.locator(locators['studio.html']).getAttribute('lang') ?? '');
  return { ...classification, state, studioLanguage, studioLanguageOk: /^en(?:-|$)/i.test(studioLanguage) };
});
