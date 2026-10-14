// Mẫu flow chỉ đọc: tiêu đề N video gần nhất (AT-M2-4). Chép vào src/flows/<tên>.ts của pack người dùng.
import { LocatorSpecSchema, z } from '@sctech/profilevault-contract';
import { defineFlow, locate } from '@sctech/profilevault-runner';
import locators from '../../data/locators.en.json' with { type: 'json' };

const Input = z.object({ count: z.number().int().min(1).max(20).default(5) });
const Output = z.object({ titles: z.array(z.string()) });

export const recentTitles = defineFlow(
  { id: 'mypack/recent-titles', version: '1.0.0', description: 'Đọc tiêu đề các video gần nhất', minLevel: 1, site: ['studio.youtube.com'], timeoutMinutes: 5 },
  Input,
  Output,
  async (ctx) => {
    await ctx.step('open', async () => {
      await ctx.ui.goto(`https://studio.youtube.com/channel/${ctx.binding.accountId}/videos/upload`);
      // Hậu kiểm: danh sách đã hiện
      await ctx.ui.waitFor(locate(ctx.page, LocatorSpecSchema.parse(locators['content.rowTitle'])).first(), { timeoutSeconds: 30 });
    });
    const titles = await ctx.step('read', async () => {
      const all = await locate(ctx.page, LocatorSpecSchema.parse(locators['content.rowTitle'])).allTextContents();
      if (all.length === 0) return ctx.fail('SITE_CHANGED', 'Không thấy danh sách video');
      return all.slice(0, ctx.input.count).map((t) => t.trim());
    });
    return { titles };
  },
);
