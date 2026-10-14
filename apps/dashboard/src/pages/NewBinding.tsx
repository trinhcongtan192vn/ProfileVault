import type { Binding, FuryProfileListItem } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChecklistForm, ConsistencyTable, ProbePanel, type ConsistencyView } from '../components/Consistency';
import { ErrorBox, Loading, useUi } from '../components/ui';
import { errorMessage, get, post } from '../lib/api';
import { qk } from '../lib/sse';

export const WIZARD_STEPS = ['Chọn profile Fury', 'Tài khoản', 'Cấu hình', 'Checklist tài khoản', 'Probe', 'Kết quả kiểm tra'] as const;

export interface AccountForm {
  platform: string;
  accountId: string;
  displayName: string;
  marketCountry: string;
}

/** Kiểm bước 2 trước khi tạo binding. Hàm thuần để test. */
export function validateAccount(a: AccountForm): string | null {
  if (!a.displayName.trim()) return 'Nhập tên hiển thị';
  if (!/^[A-Z]{2}$/.test(a.marketCountry)) return 'Thị trường phải là mã quốc gia 2 chữ in hoa (ví dụ DE)';
  if (a.platform === 'youtube' && !/^UC[\w-]{10,}$/.test(a.accountId)) return 'Channel ID YouTube bắt đầu bằng UC…';
  if (!a.accountId.trim()) return 'Nhập ID tài khoản';
  return null;
}

/** Wizard gắn kênh 6 bước (SPEC-07 §4.3). Binding được tạo ở cuối bước 3 (L0), các bước sau bổ sung dữ liệu. */
export default function NewBinding() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useUi();
  const [step, setStep] = useState(0);
  const [profileId, setProfileId] = useState('');
  const [acc, setAcc] = useState<AccountForm>({ platform: 'youtube', accountId: '', displayName: '', marketCountry: '' });
  const [studioLanguage, setStudioLanguage] = useState('en');
  const [roots, setRoots] = useState('');
  const [binding, setBinding] = useState<Binding | null>(null);
  const profiles = useQuery({ queryKey: ['fury-profiles'], queryFn: () => get<{ profiles: FuryProfileListItem[] }>('/internal/fury/profiles'), retry: false });
  const create = useMutation({
    mutationFn: () =>
      post<Binding>('/internal/bindings', {
        ...acc,
        furyProfileId: profileId,
        packConfig: acc.platform === 'youtube' ? { studioLanguage } : {},
        allowedRoots: roots.split('\n').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: (b) => {
      setBinding(b);
      toast('Đã gắn kênh ở L0');
      void qc.invalidateQueries({ queryKey: qk.overview });
      setStep(3);
    },
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  const consistency = useQuery({ queryKey: binding ? qk.consistency(binding.id) : ['none'], queryFn: () => get<ConsistencyView>(`/internal/bindings/${binding!.id}/consistency`), enabled: !!binding && step === 5 });
  const accErr = validateAccount(acc);

  return (
    <div>
      <h1>Gắn kênh mới</h1>
      <ol className="steps">
        {WIZARD_STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'active' : i < step ? 'done' : undefined}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="card">
          {profiles.isLoading ? (
            <Loading />
          ) : profiles.error ? (
            <ErrorBox error={profiles.error} />
          ) : (
            <>
              <p>Chọn profile Fury đã tạo cho kênh (persona Windows, proxy ISP/residential tĩnh đúng thị trường, đã đăng nhập email của kênh).</p>
              <select size={8} className="wide" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                {(profiles.data?.profiles ?? [])
                  .filter((p) => !p.bound)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id}) {p.tags.join(', ')}
                    </option>
                  ))}
              </select>
              <div className="actions">
                <button className="primary" disabled={!profileId} onClick={() => setStep(1)}>
                  Tiếp
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step === 1 && (
        <section className="card form-grid">
          <label className="field">
            Nền tảng
            <select value={acc.platform} onChange={(e) => setAcc({ ...acc, platform: e.target.value })}>
              <option value="youtube">youtube</option>
            </select>
          </label>
          <label className="field">
            ID tài khoản (YouTube: channel ID UC…)
            <input value={acc.accountId} onChange={(e) => setAcc({ ...acc, accountId: e.target.value.trim() })} />
          </label>
          <label className="field">
            Tên hiển thị
            <input value={acc.displayName} onChange={(e) => setAcc({ ...acc, displayName: e.target.value })} />
          </label>
          <label className="field">
            Thị trường (quốc gia, ISO2)
            <input value={acc.marketCountry} maxLength={2} onChange={(e) => setAcc({ ...acc, marketCountry: e.target.value.toUpperCase() })} />
          </label>
          {accErr && <p className="muted">{accErr}</p>}
          <div className="actions">
            <button onClick={() => setStep(0)}>Quay lại</button>
            <button className="primary" disabled={!!accErr} onClick={() => setStep(2)}>
              Tiếp
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="card form-grid">
          {acc.platform === 'youtube' && (
            <label className="field">
              Ngôn ngữ Studio (ghim English để selector ổn định)
              <select value={studioLanguage} onChange={(e) => setStudioLanguage(e.target.value)}>
                <option value="en">en</option>
              </select>
            </label>
          )}
          <label className="field">
            Thư mục file cho phép (mỗi dòng một thư mục, dùng cho upload ở M1)
            <textarea rows={3} value={roots} onChange={(e) => setRoots(e.target.value)} placeholder="E:\exports" />
          </label>
          <div className="actions">
            <button onClick={() => setStep(1)}>Quay lại</button>
            <button className="primary" disabled={create.isPending} onClick={() => create.mutate()}>
              Gắn kênh (L0)
            </button>
          </div>
        </section>
      )}

      {step === 3 && binding && (
        <section className="card">
          <ChecklistForm bindingId={binding.id} />
          <div className="actions">
            <button className="primary" onClick={() => setStep(4)}>
              Tiếp
            </button>
          </div>
        </section>
      )}

      {step === 4 && binding && (
        <section className="card">
          <ProbePanel bindingId={binding.id} onImported={() => setStep(5)} />
          <div className="actions">
            <button onClick={() => setStep(5)}>Bỏ qua, làm sau</button>
          </div>
        </section>
      )}

      {step === 5 && binding && (
        <section className="card">
          <p>
            Kênh <strong>{binding.displayName}</strong> đã ở L0. Sửa các luật trượt trong Fury rồi bấm “Kiểm tra lại” ở trang chi tiết. Nhớ khai báo mỗi lần upload tay.
          </p>
          {consistency.data ? <ConsistencyTable view={consistency.data} /> : <Loading />}
          <div className="actions">
            <button className="primary" onClick={() => { void nav(`/bindings/${binding.id}`); }}>
              Mở chi tiết kênh
            </button>
            <Link to="/">Về tổng quan</Link>
          </div>
        </section>
      )}
    </div>
  );
}
