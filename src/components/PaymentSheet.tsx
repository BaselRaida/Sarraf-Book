import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setSetting } from '../db/db';
import { createPayment, ensureMethod } from '../db/ops';
import { useData } from '../data';
import { nonZero, type Amounts } from '../lib/aggregate';
import { calcPayout } from '../lib/calc';
import { fromLocalInput, toLocalInput } from '../lib/dates';
import { FX_MEMORY_KEY, recallRate, rememberRate, type FxMemory } from '../lib/fxMemory';
import { formatRate, parseMoney, parseRate, toInputString } from '../lib/money';
import type { Customer } from '../lib/types';
import { Chips, DateField, Field, FreeChoice, Modal, Money, MoneyInput, useToast } from './ui';

/** تسليم دفعة لزبون من رصيده (كامل الرصيد أو جزء، بأي عملة). */
export default function PaymentSheet({ customer, balance, onClose }: { customer: Customer; balance: Amounts; onClose: () => void }) {
  const { activeCurrencies, outMethods, cur } = useData();
  const toast = useToast();
  const fxMemo = useLiveQuery(async () => ((await db.settings.get(FX_MEMORY_KEY))?.value as FxMemory | undefined) ?? {}, []);
  const owed = nonZero(balance).filter(([, v]) => v > 0);
  const [from, setFrom] = useState(owed[0]?.[0] ?? activeCurrencies[0]?.code ?? 'USD');
  const [to, setTo] = useState(from);
  const [method, setMethod] = useState(outMethods[0]?.name ?? '');
  const [kind, setKind] = useState('');
  const pastKinds = useLiveQuery(async () => [...new Set((await db.payments.toArray()).map((p) => p.kind).filter((k): k is string => !!k))], []);
  const [full, setFull] = useState(true);
  const [rateStr, setRateStr] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [date, setDate] = useState(toLocalInput());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fc = cur(from);
  const tc = cur(to);
  const same = from === to;
  const due = Math.max(0, balance[from] ?? 0);
  const rate = same ? null : parseRate(rateStr);
  const partial = parseMoney(amountStr, tc.decimals);
  const r = useMemo(
    () => calcPayout({ due, decimals: fc.decimals, mode: full ? 'full' : 'partial', sameCurrency: same, payoutDecimals: tc.decimals, rate, partialAmount: partial }),
    [due, fc.decimals, full, same, tc.decimals, rate, partial],
  );

  const changeTo = (code: string) => {
    setTo(code);
    const m = recallRate(fxMemo, from, code);
    setRateStr(m ? formatRate(m.payoutRate) : '');
  };

  const save = async () => {
    if (!method.trim()) return toast('اختر أو اكتب طريقة التحويل', 'error');
    if (!r.ok || r.payoutAmount <= 0) return toast(!same && !rate ? 'أدخل سعر التحويل' : 'أدخل المبلغ', 'error');
    setSaving(true);
    try {
      await ensureMethod(method, 'out');
      await createPayment(customer.id, {
        date: fromLocalInput(date),
        currency: from,
        settled: r.settled,
        payoutCurrency: to,
        payoutAmount: r.payoutAmount,
        rate: same ? undefined : rate!,
        kind: kind.trim() || undefined,
        method: method.trim(),
        notes: notes.trim() || undefined,
      });
      if (!same && rate) await setSetting(FX_MEMORY_KEY, rememberRate(fxMemo, from, to, rate, null, new Date().toISOString()));
      toast('سُجّلت الدفعة ✓');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`تحويل لـ ${customer.name}`}
      footer={
        <button className="btn-gold w-full" disabled={saving} onClick={save}>
          حفظ الدفعة
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <span className="label">من رصيده بـ</span>
          <Chips
            small
            value={from}
            onChange={(v) => {
              setFrom(v);
              setTo(v);
              setRateStr('');
            }}
            options={(owed.length ? owed.map(([c]) => c) : activeCurrencies.map((c) => c.code)).map((c) => ({ value: c, label: cur(c).name }))}
          />
          <p className="mt-2 text-base">
            رصيده: <Money value={balance[from] ?? 0} currency={from} className="font-bold" />
          </p>
        </div>
        <Chips
          value={full ? 'full' : 'partial'}
          onChange={(v) => setFull(v === 'full')}
          options={[
            { value: 'full', label: 'كامل الرصيد' },
            { value: 'partial', label: 'جزء' },
          ]}
        />
        <div>
          <span className="label">حوّلت له بعملة</span>
          <Chips small value={to} onChange={changeTo} options={activeCurrencies.map((c) => ({ value: c.code, label: c.name }))} />
        </div>
        <FreeChoice label="طبيعة التحويل" value={kind} options={[...new Set([...(pastKinds ?? []), 'تحويل', 'تسليم كاش', 'دفعة'])].slice(0, 8)} onChange={setKind} />
        <FreeChoice label="عن طريق" value={method} options={outMethods.map((m) => m.name)} onChange={setMethod} placeholder="مثلاً: بنك القدس، كاش…" />
        <div className="grid grid-cols-2 gap-3">
          {!same && (
            <Field label={`السعر: 1 ${fc.symbol} =`}>
              <MoneyInput value={rateStr} onChange={(e) => setRateStr(e.target.value)} />
            </Field>
          )}
          {!full && (
            <Field label={`المبلغ (${tc.symbol})`}>
              <MoneyInput autoFocus value={amountStr} onChange={(e) => setAmountStr(e.target.value)} placeholder={r.ok && full ? toInputString(r.payoutAmount, tc.decimals) : ''} />
            </Field>
          )}
        </div>
        <DateField value={date} onChange={setDate} />
        <Field label="ملاحظة">
          <input className="input text-base" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {r.ok && r.payoutAmount > 0 && (
          <div className="hero rounded-3xl p-4">
            <div className="flex justify-between">
              <span className="opacity-80">أحوّل له</span>
              <Money value={r.payoutAmount} currency={to} className="text-xl font-bold" />
            </div>
            <div className="mt-1 flex justify-between">
              <span className="opacity-80">{r.remaining < 0 ? 'زيادة على رصيده' : 'يبقى له'}</span>
              <Money value={Math.abs(r.remaining)} currency={from} className="font-bold text-gold" />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
