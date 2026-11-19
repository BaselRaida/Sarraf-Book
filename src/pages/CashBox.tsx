import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { addCashMovement, exchangeCash, recordCount } from '../db/ops';
import { useData } from '../data';
import { cashBalances } from '../lib/aggregate';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../lib/dates';
import { formatRate, parseMoney, parseRate, convert, toInputString } from '../lib/money';
import { Chips, DateField, Empty, Field, Modal, Money, MoneyInput, PageTitle, cx, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { useLedger } from '../hooks';
import type { MovementType } from '../lib/types';

const TYPE_LABEL: Record<MovementType, string> = {
  deposit: 'إيداع',
  withdraw: 'سحب',
  exchange_out: 'تحويل عملة (خروج)',
  exchange_in: 'تحويل عملة (دخول)',
  adjust: 'تسوية جرد',
};

type Dialog = null | 'deposit' | 'withdraw' | 'exchange' | 'count';
type Line = { id: string; date: string; label: string; note?: string; currency: string; amount: number };

export default function CashBox() {
  const { activeCurrencies, cur } = useData();
  const { ready, ops, payments, movements } = useLedger();
  const counts = useLiveQuery(() => db.counts.orderBy('date').reverse().limit(30).toArray(), []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(50);
  const [tab, setTab] = useState<'moves' | 'counts'>('moves');

  const bal = useMemo(() => cashBalances(movements, ops, payments), [movements, ops, payments]);
  // كل ما دخل وخرج: الاستلامات والتحويلات تلقائياً + الحركات اليدوية
  const lines = useMemo<Line[]>(
    () =>
      [
        ...movements.map((m) => ({ id: m.id, date: m.date, label: TYPE_LABEL[m.type] ?? m.type, note: m.note, currency: m.currency, amount: m.amount })),
        ...ops.filter((o) => o.status === 'active').map((o) => ({ id: o.id, date: o.date, label: `استلام · ${o.method}`, note: o.customerName, currency: o.currency, amount: o.amount })),
        ...payments
          .filter((p) => p.status === 'active')
          .map((p) => ({ id: p.id, date: p.date, label: `تحويل · ${p.method}`, note: p.customerName, currency: p.payoutCurrency, amount: -p.payoutAmount })),
      ].sort((a, b) => b.date.localeCompare(a.date)),
    [movements, ops, payments],
  );
  if (!ready || !counts) return null;
  const codes = [...new Set([...activeCurrencies.map((c) => c.code), ...Object.keys(bal).filter((k) => bal[k] !== 0)])];
  const shown = lines.filter((m) => !filter || m.currency === filter);

  return (
    <div>
      <PageTitle
        action={
          <button className="btn-gold" onClick={() => setDialog('count')}>
            <Icon name="check" size={18} /> جرد نهاية اليوم
          </button>
        }
      >
        أرصدتي
      </PageTitle>
      <p className="-mt-3 mb-4 text-sm text-muted">ما معي فعلياً لكل عملة: كل ما استلمته − كل ما حوّلته ± الحركات اليدوية.</p>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {codes.map((code) => (
          <div key={code} className="card">
            <p className="text-xs text-muted">{cur(code).name}</p>
            <Money value={bal[code] ?? 0} currency={code} className="text-2xl font-bold" />
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button className="btn-outline" onClick={() => setDialog('deposit')}>
          <Icon name="down" size={16} /> إيداع
        </button>
        <button className="btn-outline" onClick={() => setDialog('withdraw')}>
          <Icon name="up" size={16} /> سحب
        </button>
        <button className="btn-outline" onClick={() => setDialog('exchange')}>
          <Icon name="swap" size={16} /> تحويل عملة
        </button>
      </div>

      <div className="mt-6 mb-3 flex items-center gap-2">
        <Chips
          value={tab}
          onChange={setTab}
          options={[
            { value: 'moves', label: 'الحركات' },
            { value: 'counts', label: 'سجل الجرد' },
          ]}
        />
        {tab === 'moves' && (
          <select className="input ms-auto w-auto py-1.5 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">كل العملات</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {cur(c).name}
              </option>
            ))}
          </select>
        )}
      </div>

      {tab === 'moves' ? (
        shown.length === 0 ? (
          <Empty>لا توجد حركات بعد. ابدأ بإيداع رصيدك الافتتاحي.</Empty>
        ) : (
          <div className="card divide-y divide-card-border/40 p-0">
            {shown.slice(0, limit).map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{m.label}</p>
                  <p className="truncate text-xs text-muted">
                    {fmtDateTime(m.date)}
                    {m.note ? ` · ${m.note}` : ''}
                  </p>
                </div>
                <Money value={m.amount} currency={m.currency} className={cx('font-semibold', m.amount > 0 ? 'text-income' : 'text-ink')} />
              </div>
            ))}
            {shown.length > limit && (
              <button className="w-full py-3 text-sm text-muted hover:underline" onClick={() => setLimit((l) => l + 50)}>
                عرض المزيد
              </button>
            )}
          </div>
        )
      ) : counts.length === 0 ? (
        <Empty>لم تُجرِ أي جرد بعد.</Empty>
      ) : (
        <div className="card divide-y divide-card-border/40 p-0">
          {counts.map((c) => (
            <div key={c.id} className="grid grid-cols-[1fr_auto] gap-1 px-4 py-2.5 text-sm">
              <span className="font-medium">
                {cur(c.currency).name} · <span className="text-xs text-muted">{fmtDateTime(c.date)}</span>
              </span>
              <span className={cx('num font-bold', c.diff === 0 ? 'text-income' : 'text-pending-ink')}>
                {c.diff === 0 ? 'مطابق ✓' : <Money value={c.diff} currency={c.currency} />}
              </span>
              <span className="col-span-2 text-xs text-muted">
                محسوب <Money value={c.expected} currency={c.currency} /> · فعلي <Money value={c.actual} currency={c.currency} />
                {c.adjusted && ' · اعتُمدت التسوية'}
                {c.note && ` · ${c.note}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {(dialog === 'deposit' || dialog === 'withdraw') && <MoveDialog type={dialog} onClose={() => setDialog(null)} balances={bal} />}
      {dialog === 'exchange' && <ExchangeDialog onClose={() => setDialog(null)} balances={bal} />}
      {dialog === 'count' && <CountDialog onClose={() => setDialog(null)} balanceAt={(iso) => cashBalances(movements.filter((m) => m.date <= iso), ops.filter((o) => o.date <= iso), payments.filter((x) => x.date <= iso))} codes={codes} />}
    </div>
  );
}

function MoveDialog({ type, onClose, balances: bal }: { type: 'deposit' | 'withdraw'; onClose: () => void; balances: Record<string, number> }) {
  const { activeCurrencies, cur } = useData();
  const toast = useToast();
  const [currency, setCurrency] = useState(activeCurrencies[0]?.code ?? 'ILS');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(toLocalInput());
  const v = parseMoney(amount, cur(currency).decimals);
  const save = async () => {
    if (!v || v <= 0) return toast('أدخل مبلغاً صحيحاً', 'error');
    await addCashMovement(type, currency, v, note.trim(), fromLocalInput(date));
    toast(type === 'deposit' ? 'تم الإيداع' : 'تم السحب');
    onClose();
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={type === 'deposit' ? 'إيداع في الصندوق' : 'سحب من الصندوق'}
      footer={
        <button className="btn-gold" onClick={save}>
          حفظ
        </button>
      }
    >
      <div className="space-y-4">
        <DateField value={date} onChange={setDate} />
        <Chips value={currency} onChange={setCurrency} options={activeCurrencies.map((c) => ({ value: c.code, label: c.name }))} />
        <Field label="المبلغ" hint={<>الرصيد الحالي: <Money value={bal[currency] ?? 0} currency={currency} /></>}>
          <MoneyInput autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        </Field>
        <Field label="ملاحظة">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'deposit' ? 'مثلاً: رصيد افتتاحي / تسوية من الشركة' : 'مثلاً: مصروف شخصي / إيداع في البنك'} />
        </Field>
      </div>
    </Modal>
  );
}

function ExchangeDialog({ onClose, balances: bal }: { onClose: () => void; balances: Record<string, number> }) {
  const { activeCurrencies, cur } = useData();
  const toast = useToast();
  const [from, setFrom] = useState(activeCurrencies[1]?.code ?? activeCurrencies[0]?.code ?? 'USD');
  const [to, setTo] = useState(activeCurrencies[0]?.code ?? 'ILS');
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [toAmount, setToAmount] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(toLocalInput());
  const fa = parseMoney(amount, cur(from).decimals);
  const r = parseRate(rate);
  const computed = fa && r ? convert(fa, cur(from).decimals, cur(to).decimals, r) : null;
  const ta = toAmount != null ? parseMoney(toAmount, cur(to).decimals) : computed;

  const save = async () => {
    if (!fa || fa <= 0 || !ta || ta <= 0) return toast('أكمل المبالغ', 'error');
    try {
      await exchangeCash(from, fa, to, ta, note.trim() || (r ? `سعر ${formatRate(r)}` : ''), fromLocalInput(date));
      toast('تم تحويل العملة');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="تحويل عملة داخل الصندوق"
      footer={
        <button className="btn-gold" onClick={save}>
          حفظ
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <DateField value={date} onChange={setDate} />
        </div>
        <Field label="من">
          <select
            className="input"
            value={from}
            onChange={(e) => {
              const v = e.target.value;
              setFrom(v);
              if (v === to) setTo(activeCurrencies.find((c) => c.code !== v)?.code ?? to);
            }}
          >
            {activeCurrencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="إلى">
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {activeCurrencies
              .filter((c) => c.code !== from)
              .map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label={`المبلغ (${cur(from).code})`} hint={<>المتوفر: <Money value={bal[from] ?? 0} currency={from} /></>}>
          <MoneyInput autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={`السعر (1 ${from} =)`}>
          <MoneyInput value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label={`المبلغ المستلم (${cur(to).code})`} hint={toAmount != null ? 'معدّل يدوياً' : 'يُحسب من السعر ويمكن تعديله'} className="col-span-2">
          <MoneyInput value={toAmount ?? (computed != null ? toInputString(computed, cur(to).decimals) : '')} onChange={(e) => setToAmount(e.target.value)} />
        </Field>
        <Field label="ملاحظة" className="col-span-2">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function CountDialog({ onClose, balanceAt, codes }: { onClose: () => void; balanceAt: (iso: string) => Record<string, number>; codes: string[] }) {
  const { cur } = useData();
  const toast = useToast();
  const [actual, setActual] = useState<Record<string, string>>({});
  const [adjust, setAdjust] = useState(true);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(toLocalInput());
  const iso = fromLocalInput(date);
  const bal = balanceAt(iso);

  const rows = codes.map((code) => {
    const expected = bal[code] ?? 0;
    const raw = actual[code] ?? '';
    const a = raw === '' ? null : parseMoney(raw, cur(code).decimals);
    return { code, expected, raw, a, diff: a == null ? null : a - expected };
  });
  const entered = rows.filter((r) => r.a != null);
  const invalid = rows.some((r) => r.raw !== '' && r.a == null);

  const save = async () => {
    if (invalid) return toast('يوجد مبلغ غير صالح', 'error');
    if (entered.length === 0) return toast('أدخل المبلغ الفعلي لعملة واحدة على الأقل', 'error');
    for (const r of entered) await recordCount(r.code, r.expected, r.a!, note.trim(), adjust, iso);
    const off = entered.filter((r) => r.diff !== 0).length;
    toast(off === 0 ? 'الجرد مطابق ✓' : `سُجّل الجرد — يوجد فرق في ${off} عملة`);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="جرد نهاية اليوم"
      footer={
        <button className="btn-gold" onClick={save}>
          حفظ الجرد
        </button>
      }
    >
      <p className="mb-3 text-sm text-muted">عُدّ النقد الموجود فعلياً وأدخله. يظهر الفرق مقارنة بالرصيد المحسوب حتى التاريخ المختار.</p>
      <div className="space-y-3">
        <DateField label="جرد حتى" value={date} onChange={setDate} />
        {rows.map((r) => (
          <div key={r.code} className="card grid grid-cols-2 items-center gap-2 py-3">
            <div>
              <p className="font-semibold">{cur(r.code).name}</p>
              <p className="text-xs text-muted">
                المحسوب: <Money value={r.expected} currency={r.code} />
              </p>
            </div>
            <MoneyInput placeholder="الفعلي" value={r.raw} onChange={(e) => setActual((s) => ({ ...s, [r.code]: e.target.value }))} />
            {r.diff != null && (
              <p className={cx('col-span-2 text-sm font-semibold', r.diff === 0 ? 'text-income' : 'text-pending-ink')}>
                {r.diff === 0 ? 'مطابق ✓' : r.diff > 0 ? <>زيادة <Money value={r.diff} currency={r.code} /></> : <>نقص <Money value={-r.diff} currency={r.code} /></>}
              </p>
            )}
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={adjust} onChange={(e) => setAdjust(e.target.checked)} />
          اعتماد الفروقات كحركة تسوية (يصبح الرصيد = الفعلي)
        </label>
        <Field label="ملاحظة">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
