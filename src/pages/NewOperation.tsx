import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setSetting } from '../db/db';
import { createOperation, ensureMethod, updateCustomer, updateOperation, type OperationInput, type PaymentInput } from '../db/ops';
import { useData } from '../data';
import { customerBalances } from '../lib/aggregate';
import { calcPayout, commissionOf, type PayoutMode } from '../lib/calc';
import { fromLocalInput, toLocalInput } from '../lib/dates';
import { FX_MEMORY_KEY, recallRate, rememberRate, type FxMemory } from '../lib/fxMemory';
import { formatPercent, formatRate, normalizeDigits, parseMoney, parsePercent, parseRate, toInputString } from '../lib/money';
import type { CommissionMode, Customer } from '../lib/types';
import { Avatar, Chips, DateField, Field, FreeChoice, Money, MoneyInput, MoneyList, PageTitle, cx, useToast } from '../components/ui';
import { Icon } from '../components/icons';

// تفضيلات الإدخال السريع (على هذا الجهاز)
const PREFS = 'sarraf-op-prefs';
type Prefs = { currency?: string; method?: string; payoutMode?: PayoutMode; payoutCurrency?: Record<string, string>; payoutMethod?: string };
const readPrefs = (): Prefs => {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}');
  } catch {
    return {};
  }
};
const savePrefs = (p: Prefs) => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* تجاهل */
  }
};

interface Form {
  customer: string;
  amount: string;
  currency: string;
  kind: string;
  method: string;
  cMode: CommissionMode;
  cValue: string; // نسبة "2" أو مبلغ "15"
  payMode: PayoutMode;
  payCurrency: string;
  payKind: string;
  payMethod: string;
  rate: string;
  marketRate: string;
  partial: string;
  date: string;
  reference: string;
  notes: string;
}

export default function NewOperation() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const { activeCurrencies, inMethods, outMethods, defaultCommissionBp, cur } = useData();
  const prefs = useMemo(readPrefs, []);
  const amountRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);

  const customers = useLiveQuery(() => db.customers.orderBy('updatedAt').reverse().toArray(), []);
  const allOps = useLiveQuery(() => db.operations.toArray(), []);
  const allPays = useLiveQuery(() => db.payments.toArray(), []);
  const fxMemo = useLiveQuery(async () => ((await db.settings.get(FX_MEMORY_KEY))?.value as FxMemory | undefined) ?? {}, []);

  const pick = <T,>(want: T | undefined, list: T[]) => (want !== undefined && list.includes(want) ? want : list[0]);
  const blank = (): Form => {
    const currency = pick(prefs.currency, activeCurrencies.map((c) => c.code)) ?? 'USD';
    return {
      customer: '',
      amount: '',
      currency,
      kind: '',
      method: pick(prefs.method, inMethods.map((m) => m.name)) ?? '',
      cMode: 'percent',
      cValue: formatPercent(defaultCommissionBp),
      payMode: prefs.payoutMode ?? 'full',
      payCurrency: prefs.payoutCurrency?.[currency] ?? currency,
      payKind: '',
      payMethod: pick(prefs.payoutMethod, outMethods.map((m) => m.name)) ?? '',
      rate: '',
      marketRate: '',
      partial: '',
      date: toLocalInput(),
      reference: '',
      notes: '',
    };
  };
  const [f, setF] = useState<Form>(blank);
  const [more, setMore] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [dateTouched, setDateTouched] = useState(false); // تاريخ اختاره المستخدم (إدخال بأثر رجعي)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  /** يملأ سعر الصرف من آخر استخدام لنفس زوج العملات */
  const withRate = (s: Form): Form => {
    if (s.payCurrency === s.currency) return { ...s, rate: '', marketRate: '' };
    const m = recallRate(fxMemo, s.currency, s.payCurrency);
    return { ...s, rate: m ? formatRate(m.payoutRate) : '', marketRate: m?.marketRate ? formatRate(m.marketRate) : '' };
  };

  // أول تحميل: سعر الصرف المحفوظ + زبون من الرابط
  const initRef = useRef(false);
  useEffect(() => {
    if (editing || initRef.current || !fxMemo || !customers) return;
    initRef.current = true;
    const preId = params.get('customer');
    const pre = preId ? customers.find((c) => c.id === preId) : undefined;
    setF((s) => {
      let n = withRate(s);
      if (pre) n = { ...n, customer: pre.name, cValue: formatPercent(pre.commissionBp ?? defaultCommissionBp) };
      return n;
    });
    if (pre) setTimeout(() => amountRef.current?.focus(), 50);
    else customerRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxMemo, customers]);

  // تحميل العملية عند التعديل
  const existing = useLiveQuery(() => (id ? db.operations.get(id) : undefined), [id]);
  const existingPay = useLiveQuery(
    async () => (id ? (await db.payments.where('operationId').equals(id).sortBy('createdAt')).find((p) => p.status === 'active') ?? null : null),
    [id],
  );
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!existing || existingPay === undefined || loadedRef.current) return;
    loadedRef.current = true;
    const d = cur(existing.currency).decimals;
    const p = existingPay;
    const pd = p ? cur(p.payoutCurrency).decimals : 2;
    setF({
      customer: existing.customerName,
      amount: toInputString(existing.amount, d),
      currency: existing.currency,
      kind: existing.kind ?? '',
      method: existing.method,
      cMode: existing.commissionMode,
      cValue: existing.commissionMode === 'percent' && existing.commissionBp != null ? formatPercent(existing.commissionBp) : toInputString(existing.commission, d),
      payMode: !p ? 'later' : p.settled === existing.due ? 'full' : 'partial',
      payCurrency: p?.payoutCurrency ?? existing.currency,
      payKind: p?.kind ?? '',
      payMethod: p?.method ?? outMethods[0]?.name ?? '',
      rate: p?.rate ? formatRate(p.rate) : '',
      marketRate: p?.marketRate ? formatRate(p.marketRate) : '',
      partial: p && p.settled !== existing.due ? toInputString(p.payoutAmount, pd) : '',
      date: toLocalInput(existing.date),
      reference: existing.reference ?? '',
      notes: existing.notes ?? '',
    });
    setShowMarket(!!p?.marketRate);
    setMore(!!(existing.reference || existing.notes));
  }, [existing, existingPay, cur, outMethods]);

  // ─── الزبون ───
  const name = f.customer.trim().replace(/\s+/g, ' ');
  const customer: Customer | undefined = customers?.find((c) => c.name === name);
  const matches = useMemo(() => {
    if (!customers) return [];
    const q = normalizeDigits(name.toLowerCase());
    const list = q ? customers.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? '').includes(q)) : customers;
    return list.filter((c) => c.name !== name).slice(0, 6);
  }, [customers, name]);
  const balances = useMemo(() => customerBalances((allOps ?? []).filter((o) => o.id !== id), (allPays ?? []).filter((p) => p.operationId !== id || !id)), [allOps, allPays, id]);
  const prevBalance = customer ? balances.get(customer.id) ?? {} : {};

  const chooseCustomer = (c: Customer) => {
    setF((s) => ({ ...s, customer: c.name, cMode: 'percent', cValue: formatPercent(c.commissionBp ?? defaultCommissionBp) }));
    setSuggest(false);
    setTimeout(() => amountRef.current?.focus(), 30);
  };

  // ─── الحساب الفوري ───
  const c = cur(f.currency);
  const pc = cur(f.payCurrency);
  const same = f.payCurrency === f.currency;
  const amount = parseMoney(f.amount, c.decimals);
  const cBp = f.cMode === 'percent' ? parsePercent(f.cValue) : null;
  const cFixed = f.cMode === 'fixed' ? parseMoney(f.cValue, c.decimals) : null;
  const commission = amount && amount > 0 ? commissionOf(amount, f.cMode, (f.cMode === 'percent' ? cBp : cFixed) ?? 0) : 0;
  const due = (amount ?? 0) - commission;
  const rate = same ? null : parseRate(f.rate);
  const marketRate = !same && showMarket && f.marketRate ? parseRate(f.marketRate) : null;
  const partial = f.payMode === 'partial' ? parseMoney(f.partial, pc.decimals) : null;
  const payout = calcPayout({ due, decimals: c.decimals, mode: f.payMode, sameCurrency: same, payoutDecimals: pc.decimals, rate, partialAmount: partial, marketRate });
  const newBalance = { ...prevBalance, [f.currency]: (prevBalance[f.currency] ?? 0) + payout.remaining };

  const errors = {
    customer: !name ? 'اكتب اسم الزبون' : null,
    amount: amount == null || amount <= 0 ? (f.amount ? `مبلغ غير صالح (حتى ${c.decimals} خانات عشرية)` : 'أدخل المبلغ') : null,
    method: !f.method.trim() ? 'اختر أو اكتب طريقة الاستلام' : null,
    commission: f.cMode === 'percent' ? (cBp == null || cBp < 0 || cBp > 10000 ? 'نسبة غير صالحة' : null) : cFixed == null || cFixed < 0 ? 'مبلغ غير صالح' : null,
    rate: f.payMode !== 'later' && !same && !rate ? 'أدخل سعر التحويل' : showMarket && f.marketRate && !marketRate ? 'سعر غير صالح' : null,
    partial: f.payMode === 'partial' && (partial == null || partial <= 0) ? 'أدخل المبلغ المحوَّل' : null,
    payMethod: f.payMode !== 'later' && !f.payMethod.trim() ? 'اختر أو اكتب طريقة التحويل' : null,
  };
  const hasError = Object.values(errors).some(Boolean);
  const err = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (hasError || amount == null) return toast('أكمل الحقول المطلوبة', 'error');
    const op: OperationInput = {
      date: fromLocalInput(f.date),
      kind: f.kind.trim() || undefined,
      method: f.method.trim(),
      reference: f.reference.trim() || undefined,
      amount,
      currency: f.currency,
      commissionMode: f.cMode,
      commissionBp: f.cMode === 'percent' ? cBp! : undefined,
      commission,
      due,
      notes: f.notes.trim() || undefined,
    };
    const pay: PaymentInput | null =
      f.payMode === 'later' || payout.payoutAmount <= 0
        ? null
        : {
            date: fromLocalInput(f.date),
            currency: f.currency,
            settled: payout.settled,
            payoutCurrency: f.payCurrency,
            payoutAmount: payout.payoutAmount,
            rate: same ? undefined : rate!,
            marketRate: marketRate ?? undefined,
            fxProfit: payout.fxProfit || undefined,
            kind: f.payKind.trim() || undefined,
            method: f.payMethod.trim(),
          };
    setSaving(true);
    try {
      // ما كتبه المستخدم من طرق جديدة يُضاف للقائمة
      await ensureMethod(op.method, 'in');
      if (pay) await ensureMethod(pay.method, 'out');
      let customerId: string;
      if (editing) {
        await updateOperation(id!, name, op, pay);
        customerId = (await db.customers.where('name').equals(name).first())!.id;
      } else {
        customerId = (await createOperation(name, op, pay)).customer.id;
      }
      // تُحفظ نسبة العمولة كافتراضية لهذا الزبون
      if (f.cMode === 'percent' && cBp != null) await updateCustomer(customerId, { commissionBp: cBp });
      if (pay && !same && rate) await setSetting(FX_MEMORY_KEY, rememberRate(fxMemo, f.currency, f.payCurrency, rate, marketRate, new Date().toISOString()));
      if (editing) {
        toast('حُفظت التعديلات');
        nav(-1);
      } else {
        savePrefs({
          currency: f.currency,
          method: f.method,
          payoutMode: f.payMode === 'partial' ? 'full' : f.payMode,
          payoutCurrency: { ...(prefs.payoutCurrency ?? {}), [f.currency]: f.payCurrency },
          payoutMethod: f.payMode !== 'later' ? f.payMethod : prefs.payoutMethod,
        });
        toast(`حُفظت عملية ${name} ✓`);
        // التاريخ المختار يدوياً يبقى للعملية التالية (لتسهيل إدخال الحركات القديمة)
        setF({ ...blank(), currency: f.currency, kind: f.kind, method: f.method.trim(), payCurrency: f.payCurrency, payKind: f.payKind, payMethod: f.payMethod.trim(), rate: f.rate, marketRate: f.marketRate, date: dateTouched ? f.date : toLocalInput() });
        setSubmitted(false);
        setMore(false);
        customerRef.current?.focus();
      }
    } catch (e2) {
      toast((e2 as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (editing && (existing === undefined || existingPay === undefined)) return null;
  if (editing && existing?.status === 'cancelled') return <p className="text-muted">لا يمكن تعديل عملية ملغاة.</p>;

  const sym = (code: string) => cur(code).symbol;
  // اقتراحات «الطبيعة»: ما استخدمته سابقاً + بدايات افتراضية
  const used = (vals: (string | undefined)[], starters: string[]) => [...new Set([...vals.filter((v): v is string => !!v), ...starters])].slice(0, 8);
  const inKinds = used((allOps ?? []).map((o) => o.kind), ['حوالة', 'إيداع', 'كاش', 'أمانة']);
  const outKinds = used((allPays ?? []).map((p) => p.kind), ['تحويل', 'تسليم كاش', 'دفعة']);

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-2xl">
      <PageTitle>{editing ? 'تعديل عملية' : 'عملية جديدة'}</PageTitle>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {/* التاريخ — ظاهر دائماً للإدخال بأثر رجعي */}
          <section className="card">
            <DateField
              value={f.date}
              onChange={(v) => {
                set('date', v);
                setDateTouched(true);
              }}
            />
          </section>

          {/* ١. الزبون */}
          <section className="card">
            <Field label="الزبون" error={err('customer')}>
              <div className="relative">
                <input
                  ref={customerRef}
                  className="input pe-12"
                  value={f.customer}
                  onChange={(e) => {
                    set('customer', e.target.value);
                    setSuggest(true);
                  }}
                  onFocus={() => setSuggest(true)}
                  onBlur={() => setTimeout(() => setSuggest(false), 150)}
                  placeholder="اسم الزبون (جديد أو قديم)"
                  autoComplete="off"
                />
                {name && <span className="absolute end-2 top-1/2 -translate-y-1/2">{customer ? <Avatar name={customer.name} size={34} /> : <span className="rounded-full bg-gold/25 px-2 py-0.5 text-xs font-bold text-pending-ink">جديد</span>}</span>}
              </div>
            </Field>
            {suggest && matches.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {matches.map((m) => (
                  <button key={m.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chooseCustomer(m)} className="flex items-center gap-2 rounded-full border border-card-border bg-paper py-1 pe-3 ps-1 text-sm font-bold">
                    <Avatar name={m.name} size={28} /> {m.name}
                  </button>
                ))}
              </div>
            )}
            {customer && Object.values(prevBalance).some((v) => v !== 0) && (
              <p className="mt-2 rounded-2xl bg-pending-bg px-3 py-2 text-sm font-bold text-pending-ink">
                رصيد سابق له عندي: <MoneyList values={prevBalance} />
              </p>
            )}
          </section>

          {/* ٢. استلمت */}
          <section className="card space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-income/15 text-income">
                <Icon name="inbox" size={18} />
              </span>
              استلمت منه
            </h2>
            <Field label="المبلغ" error={err('amount')}>
              <MoneyInput ref={amountRef} value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" className="text-3xl font-bold" />
            </Field>
            <Chips value={f.currency} onChange={(v) => setF((s) => withRate({ ...s, currency: v, payCurrency: prefs.payoutCurrency?.[v] ?? (s.payCurrency === s.currency ? v : s.payCurrency) }))} options={activeCurrencies.map((x) => ({ value: x.code, label: x.name }))} />
            <FreeChoice label="طبيعة الاستلام" value={f.kind} options={inKinds} onChange={(v) => set('kind', v)} placeholder="مثلاً: حوالة، أمانة، سداد…" />
            <FreeChoice label="عن طريق" value={f.method} options={inMethods.map((m) => m.name)} onChange={(v) => set('method', v)} placeholder="مثلاً: بنك فلسطين، محفظة جوال…" error={err('method')} />
          </section>

          {/* ٣. العمولة */}
          <section className="card">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-bold">عمولتي</h2>
              <Chips
                small
                value={f.cMode}
                onChange={(v) => setF((s) => ({ ...s, cMode: v, cValue: v === 'percent' ? formatPercent(customer?.commissionBp ?? defaultCommissionBp) : '' }))}
                options={[
                  { value: 'percent', label: 'نسبة %' },
                  { value: 'fixed', label: 'مبلغ' },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label={f.cMode === 'percent' ? 'النسبة %' : `المبلغ (${sym(f.currency)})`} error={err('commission')}>
                <MoneyInput value={f.cValue} onChange={(e) => set('cValue', e.target.value)} className="text-xl" />
              </Field>
              <div className="rounded-2xl bg-income/10 px-3 py-2.5">
                <p className="text-xs font-medium text-muted">ربحي</p>
                <Money value={commission} currency={f.currency} tone="income" className="text-xl font-bold" />
              </div>
            </div>
            {f.cMode === 'percent' && <p className="mt-2 text-xs text-muted">تُحفظ هذه النسبة لهذا الزبون للمرة القادمة</p>}
          </section>

          {/* ٤. حوّلت له */}
          <section className="card space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary-2 dark:text-gold">
                <Icon name="send" size={18} />
              </span>
              حوّلت له
            </h2>
            <Chips
              value={f.payMode}
              onChange={(v) => set('payMode', v)}
              options={[
                { value: 'full', label: 'كامل المستحق' },
                { value: 'partial', label: 'جزء' },
                { value: 'later', label: 'لاحقاً' },
              ]}
            />
            {f.payMode !== 'later' && (
              <>
                <div>
                  <span className="label">بعملة</span>
                  <Chips small value={f.payCurrency} onChange={(v) => setF((s) => withRate({ ...s, payCurrency: v }))} options={activeCurrencies.map((x) => ({ value: x.code, label: x.name }))} />
                </div>
                <FreeChoice label="طبيعة التحويل" value={f.payKind} options={outKinds} onChange={(v) => set('payKind', v)} placeholder="مثلاً: دفعة، تسليم باليد…" />
                <FreeChoice label="عن طريق" value={f.payMethod} options={outMethods.map((m) => m.name)} onChange={(v) => set('payMethod', v)} placeholder="مثلاً: بنك القدس، كاش…" error={err('payMethod')} />
                <div className="grid grid-cols-2 gap-3">
                  {!same && (
                    <Field label={`السعر: 1 ${sym(f.currency)} =`} error={err('rate')} hint={recallRate(fxMemo, f.currency, f.payCurrency) ? 'آخر سعر استخدمته' : undefined}>
                      <MoneyInput value={f.rate} onChange={(e) => set('rate', e.target.value)} placeholder="3.60" />
                    </Field>
                  )}
                  {f.payMode === 'partial' && (
                    <Field label={`المبلغ المحوَّل (${sym(f.payCurrency)})`} error={err('partial')}>
                      <MoneyInput value={f.partial} onChange={(e) => set('partial', e.target.value)} />
                    </Field>
                  )}
                </div>
                {!same &&
                  (showMarket ? (
                    <Field label="سعر السوق (لحساب ربح فرق السعر)" hint="اختياري">
                      <MoneyInput value={f.marketRate} onChange={(e) => set('marketRate', e.target.value)} />
                    </Field>
                  ) : (
                    <button type="button" className="text-sm font-medium text-muted underline" onClick={() => setShowMarket(true)}>
                      + سعر السوق (لحساب ربح فرق السعر)
                    </button>
                  ))}
              </>
            )}
          </section>

          <button type="button" className="btn-ghost w-full" onClick={() => setMore((m) => !m)}>
            {more ? 'إخفاء التفاصيل ▲' : 'رقم مرجعي، ملاحظات ▼'}
          </button>
          {more && (
            <section className="card grid gap-4 sm:grid-cols-2">
              <Field label="رقم مرجعي (اختياري)">
                <input className="input num text-left" dir="ltr" value={f.reference} onChange={(e) => set('reference', e.target.value)} placeholder="TxID / رقم الحوالة" />
              </Field>
              <Field label="ملاحظات" className="sm:col-span-2">
                <textarea className="input min-h-[80px] text-base" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
            </section>
          )}
        </div>

        {/* الملخص */}
        <aside className="space-y-3 md:sticky md:top-24 md:self-start">
          <div className="hero rounded-[28px] p-5">
            <p className="text-sm font-medium opacity-85">ملخص العملية {name && `· ${name}`}</p>
            <dl className="mt-3 space-y-2 text-base">
              <div className="flex justify-between gap-2">
                <dt className="opacity-80">استلمت</dt>
                <dd className="font-bold">{amount ? <Money value={amount} currency={f.currency} /> : '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="opacity-80">ربحي</dt>
                <dd className="font-bold text-gold">
                  <Money value={commission} currency={f.currency} />
                </dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-white/15 pt-2">
                <dt className="opacity-80">المستحق له</dt>
                <dd className="font-bold">
                  <Money value={due} currency={f.currency} />
                </dd>
              </div>
              {f.payMode !== 'later' && payout.ok && (
                <div className="flex justify-between gap-2">
                  <dt className="opacity-80">حوّلت له</dt>
                  <dd className="text-xl font-bold">
                    <Money value={payout.payoutAmount} currency={f.payCurrency} />
                  </dd>
                </div>
              )}
              {payout.fxProfit !== 0 && (
                <div className="flex justify-between gap-2">
                  <dt className="opacity-80">ربح فرق السعر</dt>
                  <dd className="font-bold text-gold">
                    <Money value={payout.fxProfit} currency={f.payCurrency} />
                  </dd>
                </div>
              )}
              <div className={cx('flex justify-between gap-2 rounded-2xl px-3 py-2', payout.remaining !== 0 ? 'bg-gold/20' : 'bg-white/10')}>
                <dt className="font-bold">{payout.remaining < 0 ? 'دفعت له زيادة' : 'الباقي له'}</dt>
                <dd className="font-bold">
                  <Money value={Math.abs(payout.remaining)} currency={f.currency} />
                </dd>
              </div>
            </dl>
            {customer && Object.values(prevBalance).some((v) => v !== 0) && (
              <p className="mt-2 text-sm opacity-90">
                رصيده الكلي بعد العملية: <MoneyList values={newBalance} className="font-bold" />
              </p>
            )}
          </div>

          <button type="submit" disabled={saving} className="btn-gold w-full py-4 text-lg">
            <Icon name="check" size={22} /> {editing ? 'حفظ التعديلات' : 'حفظ العملية'}
          </button>
          {editing && (
            <button type="button" className="btn-ghost w-full" onClick={() => nav(-1)}>
              رجوع
            </button>
          )}
        </aside>
      </div>
    </form>
  );
}
