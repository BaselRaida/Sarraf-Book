import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLedger } from '../hooks';
import { useData } from '../data';
import { endOfDay, fmtSmart, startOfDay } from '../lib/dates';
import { normalizeDigits } from '../lib/money';
import { Avatar, CancelledBadge, Chips, Empty, Meta, Money, PageTitle, cx } from '../components/ui';
import { Icon } from '../components/icons';
import OperationSheet from '../components/OperationSheet';

const PAGE = 60;

export default function OperationsLog() {
  const { ready, ops, payments } = useLedger();
  const { currencies, methods } = useData();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);

  const status = params.get('status') ?? '';
  const currency = params.get('currency') ?? '';
  const method = params.get('method') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
    setLimit(PAGE);
  };

  const settledByOp = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of payments) if (p.operationId && p.status === 'active') m.set(p.operationId, (m.get(p.operationId) ?? 0) + p.settled);
    return m;
  }, [payments]);

  const filtered = useMemo(() => {
    const needle = normalizeDigits(q.trim().toLowerCase());
    const lo = from ? startOfDay(from) : '';
    const hi = to ? endOfDay(to) : '';
    return ops.filter((o) => {
      if (status === 'cancelled' ? o.status !== 'cancelled' : status === 'open' ? o.status !== 'active' || o.due - (settledByOp.get(o.id) ?? 0) <= 0 : false) return false;
      if (currency && o.currency !== currency) return false;
      if (method && o.method !== method) return false;
      if (lo && o.date < lo) return false;
      if (hi && o.date > hi) return false;
      return !needle || o.customerName.toLowerCase().includes(needle) || (o.reference ?? '').toLowerCase().includes(needle) || (o.kind ?? '').toLowerCase().includes(needle) || (o.notes ?? '').toLowerCase().includes(needle);
    });
  }, [ops, q, status, currency, method, from, to, settledByOp]);

  if (!ready) return null;
  const activeFilters = [currency, method, from, to].filter(Boolean).length;

  return (
    <div>
      <PageTitle sub={`${filtered.length} عملية`}>سجل العمليات</PageTitle>

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Icon name="search" size={20} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input ps-12" placeholder="بحث بالاسم أو الرقم أو النوع" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        </div>
        <button className={cx('btn-outline relative px-4', showFilters && 'border-primary')} onClick={() => setShowFilters((s) => !s)} aria-label="فلترة">
          <Icon name="filter" size={20} />
          {activeFilters > 0 && <span className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gold text-xs font-bold text-gold-ink">{activeFilters}</span>}
        </button>
      </div>

      <Chips
        small
        className="mb-3"
        value={status}
        onChange={(v) => setParam('status', v)}
        options={[
          { value: '', label: 'الكل' },
          { value: 'open', label: 'لم تُحوَّل بالكامل' },
          { value: 'cancelled', label: 'ملغاة' },
        ]}
      />

      {showFilters && (
        <div className="card mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <label>
            <span className="label">من تاريخ</span>
            <input type="date" className="input num text-base" value={from} onChange={(e) => setParam('from', e.target.value)} />
          </label>
          <label>
            <span className="label">إلى تاريخ</span>
            <input type="date" className="input num text-base" value={to} onChange={(e) => setParam('to', e.target.value)} />
          </label>
          <label>
            <span className="label">العملة</span>
            <select className="input text-base" value={currency} onChange={(e) => setParam('currency', e.target.value)}>
              <option value="">الكل</option>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">طريقة الاستلام</span>
            <select className="input text-base" value={method} onChange={(e) => setParam('method', e.target.value)}>
              <option value="">الكل</option>
              {methods.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          {activeFilters > 0 && (
            <button className="btn-ghost col-span-2 md:col-span-4" onClick={() => setParams({}, { replace: true })}>
              مسح الفلاتر
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <Empty>لا عمليات مطابقة</Empty>
      ) : (
        <div className="card divide-y divide-card-border p-0">
          {filtered.slice(0, limit).map((o) => {
            const remaining = o.status === 'active' ? o.due - (settledByOp.get(o.id) ?? 0) : 0;
            return (
              <button key={o.id} onClick={() => setOpenId(o.id)} className={cx('flex w-full items-center gap-3 px-4 py-3.5 text-start', o.status === 'cancelled' && 'opacity-50')}>
                <Avatar name={o.customerName} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={cx('truncate text-base font-bold', o.status === 'cancelled' && 'line-through')}>{o.customerName}</p>
                    {o.status === 'cancelled' && <CancelledBadge />}
                  </div>
                  <Meta className="block text-sm leading-snug text-muted" items={[fmtSmart(o.date), o.method, o.kind]} />
                  {remaining > 0 && (
                    <p className="text-xs font-bold text-pending-ink">
                      باقٍ له <Money value={remaining} currency={o.currency} />
                    </p>
                  )}
                </div>
                <div className="text-end">
                  <Money value={o.amount} currency={o.currency} className="block text-base font-bold" />
                  <Money value={o.commission} currency={o.currency} tone={o.status === 'cancelled' ? 'muted' : 'income'} className="text-sm font-bold" />
                </div>
              </button>
            );
          })}
          {filtered.length > limit && (
            <button className="w-full py-3 font-bold text-muted" onClick={() => setLimit((l) => l + PAGE)}>
              عرض المزيد ({filtered.length - limit})
            </button>
          )}
        </div>
      )}

      <OperationSheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
