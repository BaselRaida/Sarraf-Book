import { useCallback, useEffect, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { DataProvider, useData } from './data';
import { db } from './db/db';
import { Icon } from './components/icons';
import { ToastProvider, cx } from './components/ui';
import { useTheme } from './theme';
import type { PinRecord } from './lib/pin';
import Home from './pages/Home';
import NewOperation from './pages/NewOperation';
import OperationsLog from './pages/OperationsLog';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import CashBox from './pages/CashBox';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import LockScreen from './pages/LockScreen';

const NAV = [
  { to: '/', label: 'الرئيسية', icon: 'home' },
  { to: '/customers', label: 'الزبائن', icon: 'users' },
  { to: '/new', label: 'عملية', icon: 'plus', main: true },
  { to: '/log', label: 'السجل', icon: 'list' },
  { to: '/reports', label: 'التقارير', icon: 'chart' },
];

function Shell({ onLock, canLock }: { onLock: () => void; canLock: boolean }) {
  const { dark, toggle } = useTheme();
  const { ready } = useData();
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <div className="min-h-dvh pb-32 md:pb-10">
      <header className="hero no-print sticky top-0 z-30">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <NavLink to="/" className="flex items-center gap-2.5">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-9 w-9 rounded-[10px] shadow-sm ring-1 ring-white/25" />
            <span className="text-lg font-bold">صرّاف بوك</span>
          </NavLink>
          <nav className="ms-6 hidden gap-1 md:flex">
            {[...NAV, { to: '/cash', label: 'الصندوق', icon: 'wallet' }, { to: '/settings', label: 'الإعدادات', icon: 'gear' }].map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('rounded-xl px-3 py-1.5 text-sm font-bold transition hover:bg-white/10', isActive && 'bg-white/15')}>
                {n.to === '/new' ? 'عملية جديدة' : n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1">
            <NavLink to="/cash" className="rounded-xl p-2.5 hover:bg-white/10 md:hidden" aria-label="الصندوق">
              <Icon name="wallet" size={22} />
            </NavLink>
            <button className="rounded-xl p-2.5 hover:bg-white/10" onClick={toggle} aria-label="تبديل الوضع الداكن">
              <Icon name={dark ? 'sun' : 'moon'} size={22} />
            </button>
            {canLock && (
              <button className="rounded-xl p-2.5 hover:bg-white/10" onClick={onLock} aria-label="قفل التطبيق">
                <Icon name="lock" size={22} />
              </button>
            )}
            <NavLink to="/settings" className="rounded-xl p-2.5 hover:bg-white/10 md:hidden" aria-label="الإعدادات">
              <Icon name="gear" size={22} />
            </NavLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {ready && (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/new" element={<NewOperation />} />
            <Route path="/edit/:id" element={<NewOperation />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/log" element={<OperationsLog />} />
            <Route path="/cash" element={<CashBox />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Home />} />
          </Routes>
        )}
      </main>

      {/* شريط التنقل السفلي — عائم وناعم */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.6rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end rounded-[26px] border border-card-border/70 bg-card/90 px-1.5 py-1.5 shadow-[0_8px_30px_-8px_rgb(var(--shadow)/0.25)] backdrop-blur-xl">
          {NAV.map((n) =>
            n.main ? (
              <NavLink key={n.to} to={n.to} className="flex flex-col items-center gap-0.5" aria-label="عملية جديدة">
                <span className="-mt-7 flex h-[60px] w-[60px] items-center justify-center rounded-full text-gold-ink shadow-[0_8px_20px_-6px_rgb(var(--gold)/0.8)] ring-[5px] ring-paper" style={{ background: 'linear-gradient(180deg, rgb(var(--gold-2)), rgb(var(--gold)))' }}>
                  <Icon name="plus" size={28} />
                </span>
                <span className="text-[11px] font-semibold text-ink">{n.label}</span>
              </NavLink>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 rounded-2xl py-1.5 text-[11px] font-semibold transition', isActive ? 'bg-primary/10 text-primary dark:bg-gold/15 dark:text-gold' : 'text-muted')}>
                <Icon name={n.icon} size={23} />
                {n.label}
              </NavLink>
            ),
          )}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  // null = لا يوجد رمز، undefined = ما زال التحميل جارياً
  const pin = useLiveQuery(async () => (await db.settings.get('pin')) ?? null, []);
  const autoLock = useLiveQuery(() => db.settings.get('autoLockMinutes'), []);
  const pinRec = (pin?.value as PinRecord | undefined) ?? undefined;
  const [unlocked, setUnlocked] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  // قفل تلقائي بعد مدة في الخلفية
  useEffect(() => {
    const minutes = (autoLock?.value as number | undefined) ?? 2;
    const onVis = () => {
      if (document.hidden) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > minutes * 60_000) setUnlocked(false);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [autoLock]);

  const lock = useCallback(() => setUnlocked(false), []);

  if (pin === undefined) return null; // لا نعرض أي بيانات قبل معرفة حالة القفل
  const locked = !!pinRec && !unlocked;

  return (
    <ToastProvider>
      <DataProvider>
        {locked ? (
          <LockScreen pin={pinRec!} onUnlock={() => setUnlocked(true)} />
        ) : (
          <HashRouter>
            <Shell onLock={lock} canLock={!!pinRec} />
          </HashRouter>
        )}
      </DataProvider>
    </ToastProvider>
  );
}
