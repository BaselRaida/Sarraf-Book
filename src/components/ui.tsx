import { createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { useData } from '../data';
import { nonZero, type Amounts } from '../lib/aggregate';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/** مبلغ منسّق بأرقام متساوية العرض */
export function Money({ value, currency, className, symbol = true, tone }: { value: number; currency: string; className?: string; symbol?: boolean; tone?: 'income' | 'muted' }) {
  const { fmt } = useData();
  return <span className={cx('num whitespace-nowrap', tone === 'income' && 'text-income', tone === 'muted' && 'text-muted', className)}>{fmt(value, currency, symbol)}</span>;
}

/** عدة مبالغ بعملات مختلفة (مثلاً أرباح اليوم بالشيكل والدولار) */
export function MoneyList({ values, className, tone, empty = '0', vertical }: { values: Amounts; className?: string; tone?: 'income' | 'muted'; empty?: ReactNode; vertical?: boolean }) {
  const list = nonZero(values);
  if (!list.length) return <span className={cx('num', tone === 'income' && 'text-income', className)}>{empty}</span>;
  return (
    <span className={cx('flex flex-wrap gap-x-4 gap-y-0.5', vertical && 'flex-col')}>
      {list.map(([c, v]) => (
        <Money key={c} value={v} currency={c} tone={tone} className={className} />
      ))}
    </span>
  );
}

/** دائرة الزبون بالحرف الأول — لون ثابت لكل اسم */
const AVATAR_COLORS = ['#0E4D3A', '#16765A', '#9A7B1F', '#2F6F8F', '#7A4E8C', '#A0522D', '#3D6B4F', '#5B6B9A'];
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const letter = name.trim().charAt(0) || '؟';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-extrabold text-white" style={{ width: size, height: size, background: AVATAR_COLORS[h % AVATAR_COLORS.length], fontSize: size * 0.42 }} aria-hidden="true">
      {letter}
    </span>
  );
}

export function Field({ label, children, hint, error, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; error?: string | null; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm font-semibold text-danger">{error}</span> : hint ? <span className="mt-1 block text-sm text-muted">{hint}</span> : null}
    </label>
  );
}

/** حقل مبلغ: لوحة أرقام عشرية على الهاتف */
export const MoneyInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function MoneyInput(props, ref) {
  return <input ref={ref} inputMode="decimal" autoComplete="off" dir="ltr" {...props} className={cx('input num text-left', props.className)} />;
});

export function Chips<T extends string>({ options, value, onChange, className, small }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string; small?: boolean }) {
  return (
    <div className={cx('flex flex-wrap gap-2', className)} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx('chip', small && 'px-3 py-1.5 text-sm', value === o.value && 'chip-on')} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** نافذة منبثقة: لوح سفلي على الجوال، ونافذة في الوسط على الشاشات الكبيرة */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('sheet-up flex max-h-[92dvh] w-full flex-col rounded-t-[28px] bg-paper shadow-2xl sm:rounded-[28px]', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')} role="dialog" aria-modal="true">
        <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-ink/15 sm:hidden" />
        <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-3">
          <h2 className="text-xl font-extrabold">{title}</h2>
          <button className="flex h-10 w-10 items-center justify-center rounded-full bg-ink/5 text-2xl leading-none text-muted hover:bg-ink/10" onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-4 pt-1">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-card-border px-5 py-3 pb-[max(0.85rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl border-2 border-dashed border-card-border p-8 text-center text-base text-muted">{children}</div>;
}

export function PageTitle({ children, action, sub }: { children: ReactNode; action?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        {sub && <p className="text-sm font-semibold text-muted">{sub}</p>}
        <h1 className="text-2xl font-extrabold text-ink">{children}</h1>
      </div>
      {action}
    </div>
  );
}

export function CancelledBadge() {
  return <span className="inline-block rounded-full bg-cancelled/15 px-2.5 py-0.5 text-xs font-bold text-cancelled">ملغاة</span>;
}

// ───────── تنبيهات سريعة (Toast) ─────────
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={cx('sheet-up pointer-events-auto rounded-2xl px-5 py-3 text-base font-bold shadow-xl', t.kind === 'error' ? 'bg-danger text-white' : 'bg-primary text-on-primary')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** تنزيل ملف من المتصفح */
export function downloadFile(name: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
