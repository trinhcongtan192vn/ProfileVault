import type { FuryInstallStatus } from '@sctech/profilevault-contract';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage, get, post } from '../lib/api';
import { qk } from '../lib/sse';
import { useUi } from './ui';

const BUSY: FuryInstallStatus['state'][] = ['checking', 'downloading', 'installing'];

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/** Câu hiển thị cho trạng thái tự cài Fury; `null` = không cần banner. Hàm thuần để test. */
export function furyInstallMessage(s: FuryInstallStatus): string | null {
  const what = s.step === 'core' ? 'trình duyệt Fury' : 'ứng dụng Fury';
  switch (s.state) {
    case 'downloading':
      return s.progress ? `Đang tải ${what} ${s.pinnedVersion}: ${mb(s.progress.received)}/${mb(s.progress.total)} MB` : `Đang tải ${what} ${s.pinnedVersion}…`;
    case 'installing':
      return `Đang cài ${what} ${s.pinnedVersion}…`;
    case 'failed':
      return `Chưa cài được Fury: ${s.error ?? 'lỗi không rõ'}`;
    default:
      return null;
  }
}

/** Banner trên mọi trang khi ProfileVault đang tự cài Fury hoặc cài lỗi (SPEC-00 §11.1). */
export function FuryInstallBanner() {
  const qc = useQueryClient();
  const { toast } = useUi();
  const q = useQuery({
    queryKey: qk.furyInstall,
    queryFn: () => get<FuryInstallStatus>('/internal/fury/install'),
    refetchInterval: (query) => (query.state.data && BUSY.includes(query.state.data.state) ? 2000 : 30_000),
  });
  const retry = useMutation({
    mutationFn: () => post<FuryInstallStatus>('/internal/fury/install'),
    onSuccess: (s) => qc.setQueryData(qk.furyInstall, s),
    onError: (e) => toast(errorMessage(e), { kind: 'error' }),
  });
  const message = q.data ? furyInstallMessage(q.data) : null;
  if (!message) return null;
  return (
    <div className="banner">
      {message}
      {q.data?.state === 'failed' && (
        <>
          {' '}
          <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending}>
            Thử lại
          </button>
        </>
      )}
    </div>
  );
}
