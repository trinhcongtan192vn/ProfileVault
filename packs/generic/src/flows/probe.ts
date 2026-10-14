import { ProbeFlowInputSchema, ProbeFlowOutputSchema } from '@sctech/profilevault-contract';
import { defineFlow } from '@sctech/profilevault-runner';

/**
 * `generic/probe` (SPEC-04 §2.3, SPIKE-P3): mở trang probe detect-suite của chính profile (Fury trả địa chỉ khi mở,
 * relay loopback) và đọc kết quả bằng hàm tĩnh `window.furyProbe()` của trang. Runner chuyển `raw` cho Health.
 */
export const probe = defineFlow({ id: 'generic/probe', version: '1.0.0', description: 'Chạy trang probe của Fury, trả dữ liệu cho kiểm tra nhất quán', minLevel: 1, site: ['127.0.0.1'], timeoutMinutes: 5 }, ProbeFlowInputSchema, ProbeFlowOutputSchema, async (ctx) => {
  await ctx.step('open', async () => {
    const url = ctx.fury.probeUrl;
    if (!url) return ctx.fail('FURY_CAPABILITY_MISSING', 'Fury không trả địa chỉ trang probe khi mở profile');
    await ctx.ui.goto(url);
  });
  const raw = await ctx.step(
    'capture',
    async () => {
      await ctx.page.waitForFunction(() => typeof (window as unknown as { furyProbe?: unknown }).furyProbe === 'function', undefined, { timeout: 30_000 });
      return await ctx.page.evaluate(() => (window as unknown as { furyProbe: () => Promise<Record<string, unknown>> }).furyProbe());
    },
    { timeoutSeconds: 120 },
  );
  if (typeof raw !== 'object' || raw === null || (raw as { __schema?: unknown }).__schema !== 1) ctx.fail('SITE_CHANGED', 'Trang probe trả định dạng lạ (cần __schema = 1)');
  return { raw };
});
