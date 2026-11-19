import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../data';
import { useLedger } from '../hooks';
import { groupOps, monthlyProfit, nonZero, summarize, type Amounts } from '../lib/aggregate';
import { addDays, endOfDay, fmtDate, localDay, startOfDay } from '../lib/dates';
import { Avatar, Chips, Empty, MoneyList, PageTitle } from '../components/ui';
import { Icon } from '../components/icons';

const MONTH = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { month: 'long', year: 'numeric' });
const monthLabel = (ym: string) => MONTH.format(new Date(`${ym}-15T12:00:00`));

/** الأرباح المتراكمة: الإجمالي منذ البداية، والفترات، وشهراً بشهر، وأكثر الزبائن ربحاً. */
export default function Profits() {
  const { cur } = useData();
  const { ready, ops, payments } = useLedger();
  const [showAllMonths, setShowAllMonths] = useState(false);

  const d = useMemo(() => {
    const today = localDay();
    const within = (from: string) => {
      const lo = startOfDay(from);
      const hi = endOfDay(today);
      return summarize(
        ops.filter((o) => o.date >= lo && o.date <= hi),
        payments.filter((p) => p.date >= lo && p.date <= hi),
      ).profit;
    };
    const now = new Date();
    const total = summarize(ops, payments);
    const liveOps = ops.filter((o) => o.status !== 'cancelled');
    const first = liveOps.length ? liveOps.reduce((a, o) => (o.date < a ? o.date : a), liveOps[0].date) : null;
    return {
      total,
      first,
      periods: [
        { label: 'اليوم', v: within(today) },
        { label: 'آخر 7 أيام', v: within(addDays(today, -6)) },
        { label: 'هذا الشهر', v: within(localDay(new Date(now.getFullYear(), now.getMonth(), 1))) },
        { label: 'هذه السنة', v: within(localDay(new Date(now.getFullYear(), 0, 1))) },
      ],
      months: monthlyProfit(ops, payments, (iso) => localDay(iso).slice(0, 7)).reverse(), // الأحدث أولاً
      byCustomer: groupOps(ops, (o) => `${o.customerId}|${o.customerName}`),
    };
  }, [ops, payments]);

  // العملة الرئيسية للمقارنة (الأكثر ربحاً) — لترتيب الزبائن وطول الأشرطة
  const currencies = nonZero(d.total.profit).map(([c]) => c);
  const [mainPick, setMainPick] = useState<string | null>(null);
  const main = mainPick && currencies.includes(mainPick) ? mainPick : currencies.sort((a, b) => (d.total.profit[b] ?? 0) - (d.total.profit[a] ?? 0))[0];

  if (!ready) return null;

  const months = showAllMonths ? d.months : d.months.slice(0, 6);
  const maxMonth = Math.max(1, ...d.months.map((m) => m.profit[main] ?? 0));
  const topCustomers = [...d.byCustomer].sort((a, b) => (b.profit[main] ?? 0) - (a.profit[main] ?? 0)).slice(0, 8);

  return (
    <div className="space-y-5">
      <PageTitle
        action={
          <Link to="/reports" className="btn-outline px-4 py-2 text-sm">
            <Icon name="chart" size={18} /> تقارير مفصّلة
          </Link>
        }
      >
        الأرباح
      </PageTitle>

      {d.total.opCount === 0 ? (
        <Empty>لا أرباح بعد — تظهر هنا تلقائياً مع أول عملية.</Empty>
      ) : (
        <>
          {/* الإجمالي المتراكم */}
          <section className="hero rounded-[28px] p-5 shadow-[0_12px_30px_-12px_rgb(var(--shadow)/0.6)]">
            <p className="text-sm font-medium opacity-85">أرباحي المتراكمة</p>
            <div className="mt-1 text-[2rem] font-bold leading-tight text-gold">
              <MoneyList values={d.total.profit} vertical />
            </div>
            <p className="mt-2 text-sm opacity-80">
              من <span className="num">{d.total.opCount}</span> عملية و<span className="num">{d.total.customerCount}</span> زبون
              {d.first && <> · منذ {fmtDate(d.first)}</>}
            </p>
            {nonZero(d.total.fxProfit).length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-3 text-sm">
                <div>
                  <p className="opacity-75">من العمولات</p>
                  <MoneyList values={d.total.commission} className="font-semibold" vertical />
                </div>
                <div>
                  <p className="opacity-75">من فرق الأسعار</p>
                  <MoneyList values={d.total.fxProfit} className="font-semibold" vertical />
                </div>
              </div>
            )}
          </section>

          {/* الفترات */}
          <section className="grid grid-cols-2 gap-3">
            {d.periods.map((p) => (
              <div key={p.label} className="card py-3">
                <p className="text-sm font-medium text-muted">{p.label}</p>
                <div className="mt-0.5 text-lg font-bold">
                  <MoneyList values={p.v} tone="income" vertical empty="0" />
                </div>
              </div>
            ))}
          </section>

          {currencies.length > 1 && (
            <div>
              <span className="label">مقارنة الأشهر والزبائن حسب</span>
              <Chips small value={main} onChange={setMainPick} options={currencies.map((c) => ({ value: c, label: cur(c).name }))} />
            </div>
          )}

          {/* شهراً بشهر */}
          <section className="card">
            <h2 className="section-title">شهراً بشهر</h2>
            <div className="divide-y divide-card-border">
              {months.map((m) => (
                <div key={m.month} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-bold">{monthLabel(m.month)}</p>
                    <div className="text-end font-bold text-income">
                      <MoneyList values={m.profit} vertical />
                    </div>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-card-border/60">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, ((m.profit[main] ?? 0) / maxMonth) * 100)}%`, background: 'linear-gradient(90deg, rgb(var(--primary-2)), rgb(var(--income)))' }} />
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    <span className="num">{m.count}</span> عملية · المتراكم حتى نهايته: <Cum values={m.cumulative} />
                  </p>
                </div>
              ))}
            </div>
            {d.months.length > 6 && (
              <button className="btn-ghost mt-1 w-full" onClick={() => setShowAllMonths((s) => !s)}>
                {showAllMonths ? 'عرض أقل' : `كل الأشهر (${d.months.length})`}
              </button>
            )}
          </section>

          {/* أكثر الزبائن ربحاً */}
          <section className="card">
            <h2 className="section-title">أكثر الزبائن ربحاً</h2>
            <div className="divide-y divide-card-border">
              {topCustomers.map((g, i) => {
                const [cid, cname] = g.key.split('|');
                return (
                  <Link key={g.key} to={`/customers/${cid}`} className="flex items-center gap-3 py-2.5">
                    <span className="num w-5 text-sm font-semibold text-muted">{i + 1}</span>
                    <Avatar name={cname} size={38} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{cname}</p>
                      <p className="text-xs text-muted">
                        <span className="num">{g.count}</span> عملية
                      </p>
                    </div>
                    <div className="text-end font-bold text-income">
                      <MoneyList values={g.profit} vertical />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Cum({ values }: { values: Amounts }) {
  return <MoneyList values={values} className="font-semibold text-ink" />;
}
