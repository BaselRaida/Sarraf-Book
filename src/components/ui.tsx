import { Fragment, createContext, forwardRef, useCallback, useContext, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
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
    <span className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, background: AVATAR_COLORS[h % AVATAR_COLORS.length], fontSize: size * 0.42 }} aria-hidden="true">
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

/**
 * اختيار حر: أزرار للخيارات المحفوظة + خانة لكتابة أي قيمة جديدة.
 * ما يُكتب يُحفظ ويظهر كخيار في المرة القادمة.
 */
export function FreeChoice({ label, value, options, onChange, placeholder, error }: { label: ReactNode; value: string; options: string[]; onChange: (v: string) => void; placeholder?: string; error?: string | null }) {
  const custom = !!value && !options.includes(value);
  const [typing, setTyping] = useState(custom);
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            className={cx('chip px-3 py-1.5', value === o && !typing && 'chip-on')}
            onClick={() => {
              setTyping(false);
              onChange(value === o ? '' : o);
            }}
          >
            {o}
          </button>
        ))}
        <button type="button" className={cx('chip px-3 py-1.5', (typing || custom) && 'chip-on')} onClick={() => setTyping(true)}>
          ✎ أخرى
        </button>
      </div>
      {(typing || custom) && <input className="input mt-2" autoFocus={typing && !custom} value={custom ? value : ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'اكتب…'} />}
      {error && <span className="mt-1 block text-sm font-medium text-danger">{error}</span>}
    </div>
  );
}

/** التاريخ والوقت لكل حركة — مع أزرار سريعة للإدخال بأثر رجعي */
export function DateField({ value, onChange, label = 'التاريخ والوقت' }: { value: string; onChange: (v: string) => void; label?: ReactNode }) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const today = local(new Date()).slice(0, 10);
  const day = value.slice(0, 10);
  const yesterday = local(new Date(Date.now() - 86_400_000)).slice(0, 10);
  const shift = (days: number) => {
    const d = new Date(value || Date.now());
    d.setDate(d.getDate() + days);
    onChange(local(d));
  };
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        {day && day < today && <span className="mb-1.5 rounded-full bg-pending-bg px-2.5 py-0.5 text-xs font-semibold text-pending-ink">بأثر رجعي</span>}
      </div>
      <input className="input num text-base" type="datetime-local" value={value} max={local(new Date(Date.now() + 86_400_000))} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={cx('chip px-3 py-1', day === today && 'chip-on')} onClick={() => onChange(local(new Date()))}>
          الآن
        </button>
        <button type="button" className={cx('chip px-3 py-1', day === yesterday && 'chip-on')} onClick={() => onChange(`${yesterday}${value.slice(10) || 'T12:00'}`)}>
          أمس
        </button>
        <button type="button" className="chip px-3 py-1" onClick={() => shift(-1)} aria-label="يوم قبل">
          − يوم
        </button>
        <button type="button" className="chip px-3 py-1" onClick={() => shift(1)} aria-label="يوم بعد">
          + يوم
        </button>
      </div>
    </div>
  );
}

/**
 * سطر تفاصيل مثل «USDT · اليوم 2:13 م»: كل جزء معزول باتجاهه (bdi)
 * حتى لا تختلط الكلمات اللاتينية والأرقام مع العربية فتظهر مقلوبة.
 */
export function Meta({ items, className }: { items: (ReactNode | false | null | undefined | '')[]; className?: string }) {
  const list = items.filter((x) => x !== false && x != null && x !== '');
  return (
    <span className={className}>
      {list.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="mx-1 opacity-60">·</span>}
          {/* كل جزء كتلة واحدة: ينتقل كاملاً للسطر التالي بدل أن ينكسر */}
          <bdi className="inline-block max-w-full truncate whitespace-nowrap align-bottom">{x}</bdi>
        </Fragment>
      ))}
    </span>
  );
}

/** تنبيه «استرجعنا ما كتبته» مع زر مسح */
export function DraftNotice({ at, onDiscard }: { at: string | null; onDiscard: () => void }) {
  if (!at) return null;
  const t = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(at));
  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl bg-pending-bg px-3 py-2.5 text-sm text-pending-ink">
      <span>📝</span>
      <p className="flex-1 font-medium">
        استرجعنا ما كتبته ولم تحفظه <span className="num opacity-80">({t})</span>
      </p>
      <button type="button" className="shrink-0 rounded-xl bg-white/60 px-3 py-1 font-semibold dark:bg-black/20" onClick={onDiscard}>
        مسح
      </button>
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
          <h2 className="text-xl font-bold">{title}</h2>
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
        {sub && <p className="text-sm font-medium text-muted">{sub}</p>}
        <h1 className="text-2xl font-bold text-ink">{children}</h1>
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
