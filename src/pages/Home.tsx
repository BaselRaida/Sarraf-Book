import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useData } from '../data';
import { useLedger } from '../hooks';
import { cashBalances, customerBalances, dailyProfit, nonZero, summarize, totalOwed } from '../lib/aggregate';
import { addDays, fmtDate, fmtTime, localDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { listDrafts } from '../lib/draft';
import { Avatar, Chips, Empty, Money, MoneyList, cx } from '../components/ui';
import { BarChart } from '../components/BarChart';
import { Icon } from '../components/icons';
import OperationSheet from '../components/OperationSheet';

const WEEKDAY = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'short' });

export default function Home() {
  const { cur, activeCurrencies } = useData();
  const { ready, ops, payments, movements, customers } = useLedger();
  const [drafts] = useState(() => listDrafts());
  const lastBackup = useLiveQuery(async () => (await db.settings.get('lastBackupAt'))?.value as string | undefined, []);
  const [openOp, setOpenOp] = useState<string | null>(null);
  const today = localDay();

  const d = useMemo(() => {
    const todayOps = ops.filter((o) => localDay(o.date) === today);
    const todayPays = payments.filter((p) => localDay(p.date) === today);
    const sToday = summarize(todayOps, todayPays);
    const allProfit = summarize(ops, payments).profit;
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const week = dailyProfit(ops, payments, days, (iso) => localDay(iso));
    const weekTotal: Record<string, number> = {};
    for (const r of week) for (const [c, v] of Object.entries(r.profit)) weekTotal[c] = (weekTotal[c] ?? 0) + v;
    const bal = customerBalances(ops, payments);
    // زبائن اليوم: تجميع حسب الزبون
    const byCustomer = new Map<string, { id: string; name: string; count: number; profit: Record<string, number> }>();
    for (const o of todayOps) {
      if (o.status === 'cancelled') continue;
      let r = byCustomer.get(o.customerId);
      if (!r) byCustomer.set(o.customerId, (r = { id: o.customerId, name: o.customerName, count: 0, profit: {} }));
      r.count++;
      r.profit[o.currency] = (r.profit[o.currency] ?? 0) + o.commission;
    }
    return {
      sToday,
      allProfit,
      payCount: todayPays.filter((p) => p.status !== 'cancelled').length,
      week,
      weekTotal,
      owed: totalOwed(bal),
      owingCustomers: [...bal.values()].filter((m) => Object.values(m).some((v) => v > 0)).length,
      cash: cashBalances(movements, ops, payments),
      todayCustomers: [...byCustomer.values()].sort((a, b) => b.count - a.count),
      recent: ops.slice(0, 6),
    };
  }, [ops, payments, movements, today]);

  // عملة الرسم البياني: أكثر عملة فيها أرباح هذا الأسبوع
  const chartCurrencies = nonZero(d.weekTotal).map(([c]) => c);
  const [chartCur, setChartCur] = useState<string | null>(null);
  const cc = chartCur && chartCurrencies.includes(chartCur) ? chartCur : chartCurrencies[0] ?? activeCurrencies[0]?.code ?? 'ILS';

  if (!ready) return null;

  const backupDays = lastBackup ? Math.floor((Date.now() - new Date(lastBackup).getTime()) / 86_400_000) : null;
  const needBackup = ops.length > 0 && (backupDays == null || backupDays >= 7);
  const cashList = nonZero(d.cash);
  // أعمال بدأتها ولم تحفظها
  const draftLinks = drafts
    .map((dr) => {
      if (dr.key === 'new-operation') return { key: dr.key, to: '/new', label: 'عملية جديدة لم تُحفظ بعد' };
      if (dr.key.startsWith('payment:')) {
        const c = customers.find((x) => x.id === dr.key.slice(8));
        return c ? { key: dr.key, to: `/customers/${c.id}`, label: `تحويل لـ ${c.name} لم يُحفظ (اضغط «تحويل له»)` } : null;
      }
      if (dr.key.startsWith('cash-')) return { key: dr.key, to: '/cash', label: 'حركة صندوق لم تُحفظ' };
      return null;
    })
    .filter((x): x is { key: string; to: string; label: string } => !!x);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-medium text-muted">{fmtDate(new Date().toISOString())}</p>
        <h1 className="text-2xl font-bold">ملخص اليوم</h1>
      </div>

      {draftLinks.map((dl) => (
        <Link key={dl.key} to={dl.to} className="flex items-center gap-3 rounded-3xl border border-gold/50 bg-card px-4 py-3 text-sm shadow-sm">
          <span className="text-lg">📝</span>
          <span className="flex-1 font-semibold">{dl.label}</span>
          <span className="font-semibold text-primary-2 dark:text-gold">أكمل ←</span>
        </Link>
      ))}

      {needBackup && (
        <Link to="/settings#backup" className="flex items-center gap-3 rounded-3xl bg-pending-bg px-4 py-3 text-sm font-bold text-pending-ink">
          <Icon name="alert" />
          <span className="flex-1">{backupDays == null ? 'لم تحفظ نسخة احتياطية بعد.' : `آخر نسخة احتياطية قبل ${backupDays} يوماً.`} اضغط لحفظ نسخة الآن.</span>
        </Link>
      )}

      {/* بطاقة الأرباح الرئيسية */}
      <section className="hero overflow-hidden rounded-[28px] p-5 shadow-[0_12px_30px_-12px_rgb(var(--shadow)/0.6)]">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium opacity-85">أرباح اليوم</p>
          <Link to="/profits" className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold hover:bg-white/25">
            كل الأرباح ←
          </Link>
        </div>
        <div className="mt-1 text-[2.1rem] font-bold leading-tight text-gold">
          <MoneyList values={d.sToday.profit} empty="0" vertical />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-center">
          <div>
            <p className="num text-2xl font-bold">{d.sToday.customerCount}</p>
            <p className="text-xs font-medium opacity-80">زبائن اليوم</p>
          </div>
          <div>
            <p className="num text-2xl font-bold">{d.sToday.opCount}</p>
            <p className="text-xs font-medium opacity-80">عمليات</p>
          </div>
          <div>
            <p className="num text-2xl font-bold">{d.payCount}</p>
            <p className="text-xs font-medium opacity-80">تحويلات</p>
          </div>
        </div>
        {nonZero(d.sToday.received).length > 0 && (
          <div className="mt-3 rounded-2xl bg-white/10 px-3 py-2 text-sm">
            <span className="font-bold opacity-80">استلمت اليوم: </span>
            <MoneyList values={d.sToday.received} className="font-bold" />
          </div>
        )}
        {nonZero(d.allProfit).length > 0 && (
          <Link to="/profits" className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-black/15 px-3 py-2.5 text-sm transition hover:bg-black/25">
            <span className="font-semibold opacity-90">أرباحي المتراكمة</span>
            <span className="text-end font-bold text-gold">
              <MoneyList values={d.allProfit} />
            </span>
          </Link>
        )}
      </section>

      <Link to="/new" className="btn-gold w-full py-4 text-lg md:hidden">
        <Icon name="plus" size={22} /> عملية جديدة
      </Link>

      {/* الأرصدة */}
      <section className="grid gap-3 sm:grid-cols-2">
        <Link to="/customers?owed=1" className="card block transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <p className="font-bold">مستحقات للزبائن</p>
            <span className="rounded-full bg-pending-bg px-2.5 py-0.5 text-xs font-bold text-pending-ink">
              <span className="num">{d.owingCustomers}</span> زبون
            </span>
          </div>
          <p className="mb-2 text-xs text-muted">مبالغ استلمتها ولم أحوّلها بعد</p>
          <div className="text-xl font-bold">
            <MoneyList values={d.owed} empty="لا شيء ✓" vertical />
          </div>
        </Link>
        <Link to="/cash" className="card block transition hover:shadow-md">
          <div className="flex items-center justify-between">
            <p className="font-bold">أرصدتي</p>
            <Icon name="wallet" className="text-muted" />
          </div>
          <p className="mb-2 text-xs text-muted">ما معي الآن لكل عملة</p>
          {cashList.length === 0 ? (
            <p className="text-sm text-muted">سجّل رصيدك الافتتاحي من الصندوق</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {cashList.map(([c, v]) => (
                <div key={c}>
                  <p className="text-xs text-muted">{cur(c).name}</p>
                  <Money value={v} currency={c} className="text-lg font-bold" />
                </div>
              ))}
            </div>
          )}
        </Link>
      </section>

      {/* آخر 7 أيام */}
      <section className="card">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="section-title mb-0">أرباح آخر 7 أيام</h2>
          <Link to="/reports" className="text-sm font-bold text-primary-2 dark:text-gold">
            التقارير ←
          </Link>
        </div>
        <div className="mb-3 text-lg font-bold text-income">
          <MoneyList values={d.weekTotal} tone="income" empty="0" />
        </div>
        {chartCurrencies.length > 1 && <Chips small className="mb-3" value={cc} onChange={setChartCur} options={chartCurrencies.map((c) => ({ value: c, label: cur(c).name }))} />}
        <BarChart
          data={d.week.map((r) => ({ label: r.day === today ? 'اليوم' : WEEKDAY.format(new Date(r.day + 'T12:00')), value: r.profit[cc] ?? 0 }))}
          format={(v) => formatMoney(v, cur(cc).decimals, { trimZeros: true })}
        />
      </section>

      {/* زبائن اليوم */}
      <section>
        <h2 className="section-title">زبائن اليوم</h2>
        {d.todayCustomers.length === 0 ? (
          <Empty>لا عمليات اليوم بعد</Empty>
        ) : (
          <div className="card divide-y divide-card-border p-0">
            {d.todayCustomers.map((c) => (
              <Link key={c.id} to={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold">{c.name}</p>
                  <p className="text-sm text-muted">
                    <span className="num">{c.count}</span> {c.count === 1 ? 'عملية' : 'عمليات'}
                  </p>
                </div>
                <div className="text-end font-bold">
                  <MoneyList values={c.profit} tone="income" vertical />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* آخر العمليات */}
      {d.recent.length > 0 && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title mb-0">آخر العمليات</h2>
            <Link to="/log" className="text-sm font-bold text-primary-2 dark:text-gold">
              الكل ←
            </Link>
          </div>
          <div className="card divide-y divide-card-border p-0">
            {d.recent.map((o) => (
              <button key={o.id} onClick={() => setOpenOp(o.id)} className={cx('flex w-full items-center gap-3 px-4 py-3 text-start', o.status === 'cancelled' && 'opacity-50')}>
                <Avatar name={o.customerName} size={40} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{o.customerName}</p>
                  <p className="truncate text-sm text-muted">
                    {o.method} · {localDay(o.date) === today ? fmtTime(o.date) : fmtDate(o.date)}
                  </p>
                </div>
                <div className="text-end">
                  <Money value={o.amount} currency={o.currency} className="block font-bold" />
                  <Money value={o.commission} currency={o.currency} tone="income" className="text-sm font-bold" />
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <OperationSheet id={openOp} onClose={() => setOpenOp(null)} />
    </div>
  );
}
