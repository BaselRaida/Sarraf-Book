import { cx } from './ui';

/** رسم أعمدة بسيط (SVG) — لا يحتاج مكتبة ويعمل دون اتصال. */
export function BarChart({ data, format, highlightLast = true }: { data: { label: string; value: number; sub?: string }[]; format: (v: number) => string; highlightLast?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-44 items-end gap-2" dir="ltr">
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max(6, (d.value / max) * 100) : 3;
        const last = highlightLast && i === data.length - 1;
        return (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${format(d.value)}`}>
            <span className={cx('num text-[11px] font-bold', d.value > 0 ? 'text-ink' : 'text-transparent')}>{d.value > 0 ? format(d.value) : '0'}</span>
            <div
              className="w-full rounded-t-xl rounded-b-md transition-all"
              style={{
                height: `${h}%`,
                background: last ? 'linear-gradient(180deg, rgb(var(--gold-2)), rgb(var(--gold)))' : d.value > 0 ? 'linear-gradient(180deg, rgb(var(--primary-2)), rgb(var(--primary)))' : 'rgb(var(--card-border))',
              }}
            />
            <span className={cx('text-xs font-bold', last ? 'text-ink' : 'text-muted')} dir="rtl">
              {d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
