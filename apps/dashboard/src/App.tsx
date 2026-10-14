import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { UiProvider } from './components/ui';
import { onSessionExpired } from './lib/api';
import { connectSse, type SseStatus } from './lib/sse';
import BindingDetail from './pages/BindingDetail';
import Inbox from './pages/Inbox';
import { Jobs, RunDetail } from './pages/Jobs';
import NewBinding from './pages/NewBinding';
import Overview from './pages/Overview';
import Schedules from './pages/Schedules';
import Settings from './pages/Settings';
import System from './pages/System';
import { makeQueryClient } from './lib/query';

export { makeQueryClient } from './lib/query';

/** 8 trang SPEC-07 §3. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/bindings/new" element={<NewBinding />} />
      <Route path="/bindings/:id" element={<BindingDetail />} />
      <Route path="/inbox" element={<Inbox />} />
      <Route path="/jobs" element={<Jobs />} />
      <Route path="/runs/:id" element={<RunDetail />} />
      <Route path="/system" element={<System />} />
      <Route path="/schedules" element={<Schedules />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/settings/*" element={<Settings />} />
      <Route path="*" element={<Overview />} />
    </Routes>
  );
}

function Shell() {
  const qc = useQueryClient();
  const [sse, setSse] = useState<SseStatus>('connecting');
  const [expired, setExpired] = useState(false);
  useEffect(() => connectSse(qc, setSse), [qc]);
  useEffect(() => onSessionExpired(() => setExpired(true)), []);
  return (
    <>
      <TopBar sse={sse} />
      {expired && <div className="banner">Phiên dashboard đã hết hạn. Mở lại dashboard từ biểu tượng ProfileVault trên khay hệ thống.</div>}
      <main>
        <AppRoutes />
      </main>
    </>
  );
}

export default function App() {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <UiProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </UiProvider>
    </QueryClientProvider>
  );
}
