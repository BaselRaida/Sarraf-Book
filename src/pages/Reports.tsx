import { useMemo, useState } from 'react';
import { useData } from '../data';
import { useLedger } from '../hooks';
import { dailyProfit, groupOps, nonZero, summarize, type Amounts } from '../lib/aggregate';
import { addDays, endOfDay, fmtDate, fmtDateTime, localDay, monthRange, startOfDay } from '../lib/dates';
import { formatMoney, formatRate } from '../lib/money';
import { Chips, Empty, MoneyList, PageTitle, useToast } from '../components/ui';
import { BarChart } from '../components/BarChart';
import { Icon } from '../components/icons';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'custom';

function rangeFor(p: Preset, custom: [string, string]): [string, string] {
  const today = localDay();
  switch (p) {
    case 'today':
      return [today, today];
    case 'yesterday':
      return [addDays(today, -1), addDays(today, -1)];
    case 'week':
      return [addDays(today, -6), today];
    case 'month':
      return monthRange();
    case 'lastMonth': {
      const d = new Date();
      return monthRange(new Date(d.getFullYear(), d.getMonth() - 1, 1));
    }
    default:
      return custom[0] <= custom[1] ? custom : [custom[1], custom[0]];
  }
}

const WEEKDAY = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });
const DAYNUM = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'numeric' });

export default function Reports() {
  const { cur } = useData();
  const toast = useToast();
  const { ready, ops: allOps, payments: allPays } = useLedger();
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState<[string, string]>([addDays(localDay(), -29), localDay()]);
  const [from, to] = rangeFor(preset, custom);
  const [chartCur, setChartCur] = useState<string | null>(null);

  const r = useMemo(() => {
    const lo = startOfDay(from);
    const hi = endOfDay(to);
    const ops = allOps.filter((o) => o.date >= lo && o.date <= hi);
    const pays = allPays.filter((p) => p.date >= lo && p.date <= hi);
    const s = summarize(ops, pays);
    const days: string[] = [];
    for (let d = from; d <= to && days.length < 62; d = addDays(d, 1)) days.push(d);
    return { ops, pays, s, byCustomer: groupOps(ops, (o) => o.customerName), byMethod: groupOps(ops, (o) => o.method), daily: dailyProfit(ops, pays, days, (iso) => localDay(iso)) };
  }, [allOps, allPays, from, to]);

  if (!ready) return null;

  const profitCurs = nonZero(r.s.profit).map(([c]) => c);
  const cc = chartCur && profitCurs.includes(chartCur) ? chartCur : profitCurs[0];
  const plain = (v: number, code: string) => Number(formatMoney(v, cur(code).decimals, { grouping: false }));
  const amountsText = (m: Amounts) =>
    nonZero(m)
      .map(([c, v]) => `${formatMoney(v, cur(c).decimals)} ${cur(c).symbol}`)
      .join(' + ');

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      const curs = [...new Set([...Object.keys(r.s.received), ...Object.keys(r.s.profit), ...Object.keys(r.s.paidOut)])];
      const sheet = (rows: unknown[][], cols: number[], name: string) => {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = cols.map((wch) => ({ wch }));
        XLSX.utils.book_append_sheet(wb, ws, name);
      };
      sheet(
        [
          ['تقرير صرّاف بوك'],
          ['الفترة', `${from} → ${to}`],
          ['عدد العمليات', r.s.opCount],
          ['عدد الزبائن', r.s.customerCount],
          [],
          ['العملة', 'استلمت', 'العمولات', 'ربح فرق السعر', 'إجمالي الربح', 'حوّلت'],
          ...curs.map((c) => [cur(c).name, plain(r.s.received[c] ?? 0, c), plain(r.s.commission[c] ?? 0, c), plain(r.s.fxProfit[c] ?? 0, c), plain(r.s.profit[c] ?? 0, c), plain(r.s.paidOut[c] ?? 0, c)]),
        ],
        [16, 16, 16, 16, 16, 16],
        'ملخص',
      );
      sheet([['الزبون', 'عدد العمليات', 'استلمت', 'ربحي'], ...r.byCustomer.map((g) => [g.key, g.count, amountsText(g.received), amountsText(g.profit)])], [22, 12, 28, 24], 'حسب الزبون');
      sheet(
        [
          ['التاريخ', 'الزبون', 'طريقة الاستلام', 'المبلغ', 'العملة', 'العمولة', 'المستحق له', 'رقم مرجعي', 'الحالة', 'ملاحظات'],
          ...r.ops.map((o) => [fmtDateTime(o.date), o.customerName, o.method, plain(o.amount, o.currency), o.currency, plain(o.commission, o.currency), plain(o.due, o.currency), o.reference ?? '', o.status === 'cancelled' ? 'ملغاة' : '', [o.notes, o.cancelReason].filter(Boolean).join(' — ')]),
        ],
        [20, 20, 14, 12, 7, 10, 12, 16, 8, 24],
        'العمليات',
      );
      sheet(
        [
          ['التاريخ', 'الزبون', 'طريقة التحويل', 'المبلغ', 'العملة', 'السعر', 'من رصيده', 'عملة الرصيد', 'ربح فرق السعر', 'الحالة'],
          ...r.pays.map((p) => [fmtDateTime(p.date), p.customerName, p.method, plain(p.payoutAmount, p.payoutCurrency), p.payoutCurrency, p.rate ? Number(formatRate(p.rate)) : '', plain(p.settled, p.currency), p.currency, p.fxProfit ? plain(p.fxProfit, p.payoutCurrency) : '', p.status === 'cancelled' ? 'ملغاة' : '']),
        ],
        [20, 20, 14, 12, 7, 8, 12, 8, 12, 8],
        'التحويلات',
      );
      wb.Workbook = { Views: [{ RTL: true }] };
      XLSX.writeFile(wb, `sarraf-report_${from}_${to}.xlsx`);
      toast('تم تصدير ملف Excel');
    } catch (e) {
      toast('تعذّر التصدير: ' + (e as Error).message, 'error');
    }
  };

  const Group = ({ title, rows }: { title: string; rows: typeof r.byCustomer }) => (
    <section className="card">
      <h2 className="section-title">{title}</h2>
      <div className="divide-y divide-card-border">
        {rows.map((g) => (
          <div key={g.key} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate font-extrabold">{g.key}</p>
              <p className="text-sm text-muted">
                <span className="num">{g.count}</span> عملية · <MoneyList values={g.received} />
              </p>
            </div>
            <div className="text-end font-extrabold">
              <MoneyList values={g.profit} tone="income" vertical />
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  return (
    <div>
      <PageTitle
        action={
          <div className="no-print flex gap-2">
            <button className="btn-outline px-3" onClick={() => window.print()} aria-label="طباعة / PDF">
              <Icon name="print" size={20} />
            </button>
            <button className="btn-gold px-4" onClick={exportExcel} disabled={!r.ops.length && !r.pays.length}>
              <Icon name="download" size={20} /> Excel
            </button>
          </div>
        }
      >
        التقارير
      </PageTitle>

      <div className="no-print mb-4 space-y-3">
        <Chips
          small
          value={preset}
          onChange={setPreset}
          options={[
            { value: 'today', label: 'اليوم' },
            { value: 'yesterday', label: 'أمس' },
            { value: 'week', label: 'آخر 7 أيام' },
            { value: 'month', label: 'هذا الشهر' },
            { value: 'lastMonth', label: 'الشهر الماضي' },
            { value: 'custom', label: 'فترة مخصصة' },
          ]}
        />
        {preset === 'custom' && (
          <div className="grid max-w-md grid-cols-2 gap-3">
            <label>
              <span className="label">من</span>
              <input type="date" className="input num text-base" value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} />
            </label>
            <label>
              <span className="label">إلى</span>
              <input type="date" className="input num text-base" value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} />
            </label>
          </div>
        )}
      </div>

      <p className="mb-4 font-bold text-muted">{from === to ? fmtDate(startOfDay(from)) : `${fmtDate(startOfDay(from))} — ${fmtDate(startOfDay(to))}`}</p>

      {r.ops.length === 0 && r.pays.length === 0 ? (
        <Empty>لا عمليات في هذه الفترة</Empty>
      ) : (
        <div className="space-y-4">
          <section className="hero rounded-[28px] p-5">
            <p className="text-sm font-bold opacity-80">أرباحي في الفترة</p>
            <div className="mt-1 text-3xl font-extrabold text-gold">
              <MoneyList values={r.s.profit} vertical />
            </div>
            {nonZero(r.s.fxProfit).length > 0 && (
              <p className="mt-1 text-sm opacity-85">
                منها ربح فرق السعر: <MoneyList values={r.s.fxProfit} />
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/15 pt-4 text-center">
              <div>
                <p className="num text-2xl font-extrabold">{r.s.opCount}</p>
                <p className="text-xs font-bold opacity-75">عملية</p>
              </div>
              <div>
                <p className="num text-2xl font-extrabold">{r.s.customerCount}</p>
                <p className="text-xs font-bold opacity-75">زبون</p>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card">
              <p className="font-bold text-muted">استلمت</p>
              <div className="text-xl font-extrabold">
                <MoneyList values={r.s.received} vertical />
              </div>
            </div>
            <div className="card">
              <p className="font-bold text-muted">حوّلت للزبائن</p>
              <div className="text-xl font-extrabold">
                <MoneyList values={r.s.paidOut} vertical />
              </div>
            </div>
          </div>

          {cc && r.daily.length > 1 && (
            <section className="card">
              <h2 className="section-title">الأرباح يوماً بيوم</h2>
              {profitCurs.length > 1 && <Chips small className="mb-3" value={cc} onChange={setChartCur} options={profitCurs.map((c) => ({ value: c, label: cur(c).name }))} />}
              <div className="overflow-x-auto">
                <div style={{ minWidth: Math.max(280, r.daily.length * 38) }}>
                  <BarChart
                    highlightLast={to === localDay()}
                    data={r.daily.map((d) => ({ label: r.daily.length <= 7 ? WEEKDAY.format(new Date(d.day + 'T12:00')) : DAYNUM.format(new Date(d.day + 'T12:00')), value: d.profit[cc] ?? 0 }))}
                    format={(v) => formatMoney(v, cur(cc).decimals, { trimZeros: true })}
                  />
                </div>
              </div>
            </section>
          )}

          {r.byCustomer.length > 0 && <Group title="حسب الزبون" rows={r.byCustomer} />}
          {r.byMethod.length > 0 && <Group title="حسب طريقة الاستلام" rows={r.byMethod} />}
        </div>
      )}
    </div>
  );
}
