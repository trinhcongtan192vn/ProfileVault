import { PvError, YoutubeUploadInputSchema, YoutubeUploadOutputSchema, type LocatorSpec, type YoutubeUploadInput } from '@sctech/profilevault-contract';
import { defineFlow, locate, type FlowContext } from '@sctech/profilevault-runner';
import locators from '../../data/locators.en.json' with { type: 'json' };

type Key = { [K in keyof typeof locators]: (typeof locators)[K] extends string ? never : K }[keyof typeof locators];
const L = (ctx: FlowContext<YoutubeUploadInput>, key: Key) => locate(ctx.page, locators[key]).first();
const STUDIO = 'https://studio.youtube.com/';
const DAY = 86_400_000;

/** "https://youtu.be/<id>" | ".../watch?v=<id>" | ".../video/<id>/..." → id. */
export function videoIdFrom(text: string): string | undefined {
  return /(?:youtu\.be\/|[?&]v=|\/video\/)([A-Za-z0-9_-]{6,})/.exec(text)?.[1];
}

/** Ngày trong cột Content của Studio ("Oct 14, 2026"); không đọc được → coi như gần đây (bảo thủ). */
export function isRecent(dateText: string, nowMs: number, days = 7): boolean {
  const t = Date.parse(dateText.replace(/^(Uploaded|Published|Scheduled|Premiered)\s*/i, '').trim());
  return Number.isNaN(t) || nowMs - t <= days * DAY;
}

/** Sự cố phiên (SPEC-04 §5.4): gate để người xử lý trong cửa sổ profile, rồi kết thúc run bằng mã lỗi; Health hạ mức. */
async function sessionProblem(ctx: FlowContext<YoutubeUploadInput>, code: 'SESSION_EXPIRED' | 'CHALLENGE' | 'WRONG_ACCOUNT', message: string): Promise<never> {
  const reason = code === 'SESSION_EXPIRED' ? 'session_expired' : code === 'CHALLENGE' ? 'challenge' : 'wrong_account';
  await ctx.humanGate({ reason, message, choices: [{ id: 'handled', label: 'Đã xử lý, đóng' }, { id: 'cancel', label: 'Hủy' }], keepProfileOpen: true });
  return ctx.fail(code, message);
}

/**
 * `youtube/upload` (SPEC-04 §5): upload video riêng tư. L2: Runner chèn gate `review_before_final` trước bước `final`
 * (người tự bấm Save); L3: chạy cả 11 bước. Không bao giờ chọn Public/Unlisted/Schedule (SafeUi + forbidden.json chặn).
 * TODO(SPIKE-P4): locator/URL/thời gian chờ trong data/locators.en.json chốt trên kênh test.
 */
export const upload = defineFlow(
  { id: 'youtube/upload', version: '1.0.0', description: 'Upload video lên YouTube Studio, để riêng tư', minLevel: 2, modes: ['L2', 'L3'], site: ['studio.youtube.com', 'www.youtube.com', 'accounts.google.com'], timeoutMinutes: 90, countsAsUpload: true, errors: ['YOUTUBE_UPLOAD_LIMIT', 'YOUTUBE_PROCESSING_FAILED'] },
  YoutubeUploadInputSchema,
  YoutubeUploadOutputSchema,
  async (ctx) => {
    const input = ctx.input;
    const state = ctx.state as { uploadStarted?: boolean; videoId?: string; warnings?: string[] };
    state.warnings ??= [];
    const warn = (w: string) => { if (!state.warnings!.includes(w)) state.warnings!.push(w); };
    try {
      // 1. Mở Studio + logic session-check
      const channelId = await ctx.step('open-studio', async () => {
        await ctx.ui.goto(STUDIO);
        const url = ctx.page.url();
        if (/\/challenge\//.test(url)) return sessionProblem(ctx, 'CHALLENGE', 'Google yêu cầu xác minh. Xử lý trong cửa sổ profile.');
        if (new URL(url).hostname === 'accounts.google.com') return sessionProblem(ctx, 'SESSION_EXPIRED', 'Phiên đăng nhập đã hết. Đăng nhập lại trong Fury (không qua ProfileVault).');
        const id = new RegExp(locators['studio.channelPattern']).exec(url)?.[1];
        if (!id) return ctx.fail('SITE_CHANGED', 'Không đọc được channel ID từ Studio');
        if (id !== ctx.binding.accountId) return sessionProblem(ctx, 'WRONG_ACCOUNT', `Profile đang ở kênh ${id}, không phải ${ctx.binding.accountId}.`);
        return id;
      });

      // 2. Kiểm trùng tiêu đề trong 7 ngày
      await ctx.step('duplicate-check', async () => {
        await ctx.ui.goto(locators['content.url'].replace('{channelId}', channelId));
        const titles = (await locate(ctx.page, locators['content.rowTitle'] as LocatorSpec).allTextContents()).map((t) => t.trim());
        const dates = await locate(ctx.page, locators['content.rowDate']).allTextContents();
        const now = Date.now();
        const dup = titles.some((t, i) => t === input.title.trim() && isRecent(dates[i] ?? '', now));
        if (dup) {
          await ctx.humanGate({ reason: 'duplicate_suspected', message: `Đã có video "${input.title}" trong 7 ngày qua. Vẫn upload?`, choices: [{ id: 'continue', label: 'Vẫn upload' }, { id: 'cancel', label: 'Hủy' }], keepProfileOpen: false });
        }
      });

      // 3. Chọn file (không idempotent: bắt đầu tải lên)
      await ctx.step(
        'select-file',
        async () => {
          await ctx.ui.goto(STUDIO);
          await ctx.ui.click(L(ctx, 'upload.createButton'), { visible: L(ctx, 'upload.uploadMenuItem') });
          await ctx.ui.click(L(ctx, 'upload.uploadMenuItem'));
          state.uploadStarted = true;
          await ctx.ui.upload(L(ctx, 'upload.fileInput'), input.video.path);
          await ctx.ui.waitFor(L(ctx, 'details.title'), { timeoutSeconds: 120 });
        },
        { idempotent: false, retry: 0 },
      );

      // 4. Video ID
      state.videoId = await ctx.step('read-video-id', async () => {
        const target = L(ctx, 'details.videoLink');
        await ctx.ui.waitFor(target, { timeoutSeconds: 120 });
        const id = videoIdFrom((await ctx.ui.read(target)).trim()) ?? videoIdFrom((await target.getAttribute('href')) ?? '');
        if (!id) return ctx.fail('SITE_CHANGED', 'Không đọc được video ID trong hộp thoại upload');
        return id;
      });

      // 5. Chi tiết
      await ctx.step('fill-details', async () => {
        await ctx.ui.fill(L(ctx, 'details.title'), input.title);
        await ctx.ui.fill(L(ctx, 'details.description'), input.description);
        if (input.thumbnail) await ctx.ui.upload(L(ctx, 'details.thumbnailInput'), input.thumbnail.path);
        if (input.playlistNames?.length) {
          await ctx.ui.click(L(ctx, 'details.playlistDropdown'));
          for (const name of input.playlistNames) {
            const box = ctx.page.getByRole('checkbox', { name, exact: true }).first();
            if (await ctx.ui.exists(box, 3)) await ctx.ui.check(box);
            else warn(`playlist '${name}' không tồn tại, đã bỏ qua`);
          }
          await ctx.ui.click(L(ctx, 'details.playlistDone'));
        }
        await ctx.ui.check(L(ctx, input.madeForKids ? 'details.madeForKidsYes' : 'details.madeForKidsNo'));
        if ((await ctx.ui.read(L(ctx, 'details.title'))).trim() !== input.title.trim()) return ctx.fail('SITE_CHANGED', 'Tiêu đề đọc lại không khớp');
        if ((await ctx.ui.read(L(ctx, 'details.description'))).trim() !== input.description.trim()) return ctx.fail('SITE_CHANGED', 'Mô tả đọc lại không khớp');
      });

      // 6. Show more: tag, ngôn ngữ, nội dung đã chỉnh sửa
      await ctx.step('fill-more', async () => {
        if (!input.tags?.length && input.videoLanguage === undefined && input.alteredContent === undefined) return;
        await ctx.ui.click(L(ctx, 'details.showMore'));
        if (input.tags?.length) {
          await ctx.ui.fill(L(ctx, 'details.tags'), `${input.tags.join(',')},`);
        }
        if (input.videoLanguage !== undefined) {
          await ctx.ui.click(L(ctx, 'details.videoLanguage'));
          const option = ctx.page.getByRole('option', { name: input.videoLanguage }).first();
          if (await ctx.ui.exists(option, 3)) await ctx.ui.click(option);
          else { warn(`ngôn ngữ video '${input.videoLanguage}' không có trong danh sách, đã bỏ qua`); await ctx.ui.press('Escape'); }
        }
        if (input.alteredContent !== undefined) await ctx.ui.check(L(ctx, input.alteredContent ? 'details.alteredYes' : 'details.alteredNo'));
      });

      // 7. Phụ đề (bước Video elements)
      await ctx.step('captions', async () => {
        await ctx.ui.click(L(ctx, 'dialog.next'));
        for (const c of input.captions ?? []) {
          await ctx.ui.click(L(ctx, 'elements.addSubtitles'));
          await ctx.ui.upload(L(ctx, 'elements.captionsFileInput'), c.path);
          const listed = ctx.page.locator(`${(locators['elements.captionsList']).css} >> text=${c.language}`).first();
          if (!(await ctx.ui.exists(listed, 30))) warn(`phụ đề ${c.language} chưa hiện trong danh sách`);
        }
      });

      // 8. Riêng tư
      await ctx.step('visibility', async () => {
        // Video elements → Checks → Visibility
        await ctx.ui.click(L(ctx, 'dialog.next'));
        await ctx.ui.click(L(ctx, 'dialog.next'), { visible: L(ctx, 'visibility.private') });
        await ctx.ui.check(L(ctx, 'visibility.private'));
        if (!(await L(ctx, 'visibility.private').isChecked())) return ctx.fail('SITE_CHANGED', 'Không chọn được Private');
        if (await L(ctx, 'visibility.schedule').isChecked().catch(() => false)) return ctx.fail('FORBIDDEN_ACTION', 'Đang có lịch hẹn công khai');
      });

      // 9. Chờ tải lên xong (không chờ xử lý)
      await ctx.step(
        'wait-upload',
        async () => {
          const progress = L(ctx, 'dialog.progress');
          const errorArea = L(ctx, 'dialog.error');
          const deadline = Date.now() + 45 * 60_000;
          for (;;) {
            if (await ctx.ui.exists(errorArea, 0.2)) {
              const msg = (await ctx.ui.read(errorArea)).trim();
              if (msg) {
                if (new RegExp(locators['text.uploadLimit'], 'i').test(msg)) return ctx.fail('YOUTUBE_UPLOAD_LIMIT', msg);
                return ctx.fail('UPLOAD_REJECTED', msg);
              }
            }
            const text = (await ctx.ui.exists(progress, 0.2)) ? (await ctx.ui.read(progress)).trim() : '';
            if (new RegExp(locators['text.uploadFailed'], 'i').test(text)) return ctx.fail('UPLOAD_REJECTED', text);
            if (new RegExp(locators['text.uploadComplete'], 'i').test(text)) return;
            if (Date.now() > deadline) return ctx.fail('TIMEOUT', 'Tải lên quá 45 phút');
            await ctx.page.waitForTimeout(1000);
          }
        },
        { timeoutSeconds: 45 * 60 + 60 },
      );

      // 10. Bấm Save (L2: Runner không chạy bước này, người tự bấm sau gate review_before_final)
      await ctx.step(
        'final',
        async () => {
          await ctx.ui.click(L(ctx, 'dialog.save'));
          await ctx.ui.waitFor(L(ctx, 'details.dialog'), { state: 'hidden', timeoutSeconds: 60 });
        },
        { final: true, idempotent: false },
      );

      // 11. Đọc lại trang sửa video
      await ctx.step('read-back', async () => {
        await ctx.ui.goto(locators['edit.url'].replace('{videoId}', state.videoId!));
        await ctx.ui.waitFor(L(ctx, 'edit.title'), { timeoutSeconds: 60 });
        if ((await ctx.ui.read(L(ctx, 'edit.title'))).trim() !== input.title.trim()) return ctx.fail('SITE_CHANGED', 'Tiêu đề trên trang sửa không khớp (kiểm bản nháp trong Studio)');
        if (!/private/i.test(await ctx.ui.read(L(ctx, 'edit.visibility')))) return ctx.fail('SITE_CHANGED', 'Video không ở chế độ Private');
      });

      return { videoId: state.videoId, studioUrl: locators['edit.url'].replace('{videoId}', state.videoId), visibility: 'private' as const, warnings: state.warnings };
    } catch (err) {
      // Lỗi sau khi bắt đầu tải lên: kèm videoId để người kiểm bản nháp (SPEC-04 §5.4)
      if (state.uploadStarted && state.videoId && err instanceof PvError) throw new PvError(err.code, err.message, { ...(err.detail ?? {}), videoId: state.videoId });
      throw err;
    }
  },
);
