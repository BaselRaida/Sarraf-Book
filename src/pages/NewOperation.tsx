import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setSetting } from '../db/db';
import { createOperation, ensureMethod, updateCustomer, updateOperation, type OperationInput, type PaymentInput } from '../db/ops';
import { useData } from '../data';
import { customerBalances } from '../lib/aggregate';
import { calcPayout, commissionOf, deriveRate, type PayoutMode } from '../lib/calc';
import { fromLocalInput, toLocalInput } from '../lib/dates';
import { useDraft } from '../lib/draft';
import { FX_MEMORY_KEY, recallRate, rememberRate, type FxMemory } from '../lib/fxMemory';
import { formatPercent, formatRate, normalizeDigits, parseMoney, parsePercent, parseRate, toInputString } from '../lib/money';
import type { CommissionMode, Customer } from '../lib/types';
import { Avatar, Chips, DateField, DraftNotice, Field, FreeChoice, Money, MoneyInput, MoneyList, PageTitle, cx, useToast } from '../components/ui';
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
  amount: string; // ما وصلني
  currency: string;
  kind: string; // وصف اختياري لما وصلني
  method: string; // نوع/طريقة ما وصلني
  cMode: CommissionMode;
  cValue: string; // نسبة "2" أو مبلغ "15"
  payMode: PayoutMode;
  payCurrency: string;
  payKind: string;
  payMethod: string; // نوع/طريقة التحويل
  rate: string; // السعر: 1 من عملة الاستلام = ؟ من عملة التحويل
  payAmount: string; // المبلغ الذي حوّلته (يُكتب بدل السعر، أو للجزء)
  marketRate: string;
  date: string;
  reference: string;
  notes: string;
}

/** بطاقة قسم برأس ملوّن ورقم الخطوة */
function Step({ n, title, icon, tone, children, aside }: { n: number; title: string; icon: string; tone: 'in' | 'out' | 'plain'; children: ReactNode; aside?: ReactNode }) {
  const toneCls = tone === 'in' ? 'bg-income/12 text-income' : tone === 'out' ? 'bg-gold/20 text-pending-ink dark:text-gold' : 'bg-primary/10 text-primary-2 dark:text-gold';
  return (
    <section className="card space-y-4">
      <div className="flex items-center gap-2.5">
        <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', toneCls)}>
          <Icon name={icon} size={19} />
        </span>
        <h2 className="flex-1 text-[17px] font-bold">
          <span className="num me-1.5 text-sm font-semibold text-muted">{n}.</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** سطر في إيصال الملخص */
function Line({ label, value, sub, strong, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; strong?: boolean; tone?: 'gold' | 'dim' }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <dt className={cx('text-sm', tone === 'dim' ? 'opacity-70' : 'opacity-85')}>{label}</dt>
      <dd className="text-end">
        <div className={cx(strong ? 'text-lg font-bold' : 'font-semibold', tone === 'gold' && 'text-gold')}>{value}</div>
        {sub && <div className="text-xs opacity-75">{sub}</div>}
      </dd>
    </div>
  );
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
      payAmount: '',
      marketRate: '',
      date: toLocalInput(),
      reference: '',
      notes: '',
    };
  };
  const [f, setF] = useState<Form>(blank);
  const [more, setMore] = useState(false);
  const [showMarket, setShowMarket] = useState(false);
  const [showInKind, setShowInKind] = useState(false);
  const [showOutKind, setShowOutKind] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggest, setSuggest] = useState(false);
  const [dateTouched, setDateTouched] = useState(false); // تاريخ اختاره المستخدم (إدخال بأثر رجعي)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  // ─── المسودة: ما يُكتب يُحفظ فوراً على الجهاز ولا يضيع قبل الضغط على «حفظ» ───
  const draftValue = useMemo(() => ({ f, dateTouched, more, showMarket }), [f, dateTouched, more, showMarket]);
  const draft = useDraft(
    'new-operation',
    draftValue,
    (d) => {
      setF((s) => ({ ...s, ...d.f, payAmount: d.f.payAmount ?? '' }));
      setDateTouched(!!d.dateTouched);
      setMore(!!d.more);
      setShowMarket(!!d.showMarket);
    },
    (d) => !!(d?.f && (d.f.customer?.trim() || d.f.amount?.trim() || d.f.reference?.trim() || d.f.notes?.trim() || d.f.payAmount?.trim())),
    !editing,
  );
  const discardDraft = () => {
    draft.clear();
    setF(blank());
    setDateTouched(false);
    setMore(false);
    setShowMarket(false);
    setSubmitted(false);
    customerRef.current?.focus();
  };

  /** يملأ سعر الصرف من آخر استخدام لنفس زوج العملات */
  const withRate = (s: Form): Form => {
    if (s.payCurrency === s.currency) return { ...s, rate: '', marketRate: '', payAmount: s.payMode === 'partial' ? s.payAmount : '' };
    const m = recallRate(fxMemo, s.currency, s.payCurrency);
    return { ...s, rate: m ? formatRate(m.payoutRate) : '', marketRate: m?.marketRate ? formatRate(m.marketRate) : '', payAmount: s.payMode === 'partial' ? s.payAmount : '' };
  };

  // أول تحميل: سعر الصرف المحفوظ + زبون من الرابط
  const initRef = useRef(false);
  useEffect(() => {
    if (editing || initRef.current || !fxMemo || !customers) return;
    initRef.current = true;
    if (draft.restoredAt) return; // مسودة مسترجعة: نتركها كما كتبها المستخدم
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
    const full = !!p && p.settled === existing.due;
    setF({
      customer: existing.customerName,
      amount: toInputString(existing.amount, d),
      currency: existing.currency,
      kind: existing.kind ?? '',
      method: existing.method,
      cMode: existing.commissionMode,
      cValue: existing.commissionMode === 'percent' && existing.commissionBp != null ? formatPercent(existing.commissionBp) : toInputString(existing.commission, d),
      payMode: !p ? 'later' : full ? 'full' : 'partial',
      payCurrency: p?.payoutCurrency ?? existing.currency,
      payKind: p?.kind ?? '',
      payMethod: p?.method ?? outMethods[0]?.name ?? '',
      rate: p?.rate ? formatRate(p.rate) : '',
      // المبلغ المحفوظ يُعرض كما هو (لا يُعاد حسابه من السعر)
      payAmount: p && (!full || p.payoutCurrency !== existing.currency) ? toInputString(p.payoutAmount, pd) : '',
      marketRate: p?.marketRate ? formatRate(p.marketRate) : '',
      date: toLocalInput(existing.date),
      reference: existing.reference ?? '',
      notes: existing.notes ?? '',
    });
    setShowMarket(!!p?.marketRate);
    setShowInKind(!!existing.kind);
    setShowOutKind(!!p?.kind);
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
  const balances = useMemo(() => customerBalances((allOps ?? []).filter((o) => o.id !== id), (allPays ?? []).filter((p) => !id || p.operationId !== id)), [allOps, allPays, id]);
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
  const typedAmount = f.payAmount.trim() ? parseMoney(f.payAmount, pc.decimals) : null;
  // «كامل» بعملة أخرى: إن كتبتَ المبلغ المحوَّل بنفسك يُستنتج السعر منه
  const amountDrives = f.payMode === 'full' && !same && typedAmount != null && typedAmount > 0;
  const rate = same ? null : amountDrives ? deriveRate(due, c.decimals, typedAmount!, pc.decimals) : parseRate(f.rate);
  const marketRate = !same && showMarket && f.marketRate ? parseRate(f.marketRate) : null;
  const payout = calcPayout({
    due,
    decimals: c.decimals,
    mode: f.payMode,
    sameCurrency: same,
    payoutDecimals: pc.decimals,
    rate,
    partialAmount: f.payMode === 'partial' ? typedAmount : null,
    fullAmount: amountDrives ? typedAmount : null,
    marketRate,
  });
  const newBalance = { ...prevBalance, [f.currency]: (prevBalance[f.currency] ?? 0) + payout.remaining };
  const sym = (code: string) => cur(code).symbol;

  const errors = {
    customer: !name ? 'اكتب اسم الزبون' : null,
    amount: amount == null || amount <= 0 ? (f.amount ? `مبلغ غير صالح (حتى ${c.decimals} خانات عشرية)` : 'أدخل المبلغ الذي وصلك') : null,
    method: !f.method.trim() ? 'اختر أو اكتب كيف وصلك المبلغ' : null,
    commission: f.cMode === 'percent' ? (cBp == null || cBp < 0 || cBp > 10000 ? 'نسبة غير صالحة' : null) : cFixed == null || cFixed < 0 ? 'مبلغ غير صالح' : null,
    rate: f.payMode !== 'later' && !same && !rate ? 'اكتب السعر أو المبلغ الذي حوّلته' : showMarket && f.marketRate && !marketRate ? 'سعر غير صالح' : null,
    payAmount: f.payMode === 'partial' && (typedAmount == null || typedAmount <= 0) ? 'اكتب المبلغ الذي حوّلته' : f.payAmount.trim() && typedAmount == null ? 'مبلغ غير صالح' : null,
    payMethod: f.payMode !== 'later' && !f.payMethod.trim() ? 'اختر أو اكتب نوع التحويل' : null,
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
        draft.clear();
        toast(`حُفظت عملية ${name} ✓`);
        // التاريخ المختار يدوياً يبقى للعملية التالية (لتسهيل إدخال الحركات القديمة)
        setF({
          ...blank(),
          currency: f.currency,
          method: f.method.trim(),
          payCurrency: f.payCurrency,
          payMethod: f.payMethod.trim(),
          rate: !same && rate ? formatRate(rate) : '',
          marketRate: f.marketRate,
          date: dateTouched ? f.date : toLocalInput(),
        });
        setSubmitted(false);
        setMore(false);
        setShowInKind(false);
        setShowOutKind(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
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

  // اقتراحات «الوصف»: ما استخدمته سابقاً + بدايات افتراضية
  const used = (vals: (string | undefined)[], starters: string[]) => [...new Set([...vals.filter((v): v is string => !!v), ...starters])].slice(0, 8);
  const inKinds = used((allOps ?? []).map((o) => o.kind), ['حوالة', 'أمانة', 'سداد دين', 'دفعة']);
  const outKinds = used((allPays ?? []).map((p) => p.kind), ['تحويل', 'تسليم باليد', 'دفعة']);
  const currencyChips = activeCurrencies.map((x) => ({ value: x.code, label: x.code === 'USDT' ? 'USDT' : `${x.name}` }));
  const shownRate = amountDrives && rate ? formatRate(rate) : f.rate;

  return (
    <form onSubmit={submit} noValidate className="mx-auto max-w-3xl">
      <PageTitle>{editing ? 'تعديل عملية' : 'عملية جديدة'}</PageTitle>
      {!editing && <DraftNotice at={draft.restoredAt} onDiscard={discardDraft} />}

      <div className="grid gap-4 md:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {/* التاريخ والزبون */}
          <section className="card space-y-4">
            <DateField
              value={f.date}
              onChange={(v) => {
                set('date', v);
                setDateTouched(true);
              }}
            />
            <div>
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
                  {name && (
                    <span className="absolute end-2 top-1/2 -translate-y-1/2">
                      {customer ? <Avatar name={customer.name} size={34} /> : <span className="rounded-full bg-gold/25 px-2 py-0.5 text-xs font-semibold text-pending-ink">زبون جديد</span>}
                    </span>
                  )}
                </div>
              </Field>
              {suggest && matches.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {matches.map((m) => (
                    <button key={m.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => chooseCustomer(m)} className="flex items-center gap-2 rounded-full border border-card-border bg-paper py-1 pe-3 ps-1 text-sm font-semibold">
                      <Avatar name={m.name} size={28} /> {m.name}
                    </button>
                  ))}
                </div>
              )}
              {customer && Object.values(prevBalance).some((v) => v !== 0) && (
                <p className="mt-2 rounded-2xl bg-pending-bg px-3 py-2 text-sm font-medium text-pending-ink">
                  رصيد سابق له عندي: <MoneyList values={prevBalance} className="font-bold" />
                </p>
              )}
            </div>
          </section>

          {/* ١. وصلني */}
          <Step n={1} title="وصلني من الزبون" icon="inbox" tone="in">
            <Field label="كم وصلك؟" error={err('amount')}>
              <div className="relative">
                <MoneyInput ref={amountRef} value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0" className="pe-16 text-3xl font-bold" />
                <span className="pointer-events-none absolute end-4 top-1/2 -translate-y-1/2 text-base font-semibold text-muted">{sym(f.currency)}</span>
              </div>
            </Field>
            <div>
              <span className="label">العملة</span>
              <Chips small value={f.currency} onChange={(v) => setF((s) => withRate({ ...s, currency: v, payCurrency: prefs.payoutCurrency?.[v] ?? (s.payCurrency === s.currency ? v : s.payCurrency) }))} options={currencyChips} />
            </div>
            <FreeChoice label="وصلني عن طريق" value={f.method} options={inMethods.map((m) => m.name)} onChange={(v) => set('method', v)} placeholder="مثلاً: محفظة، بنك القاهرة…" error={err('method')} />
            {showInKind || f.kind ? (
              <FreeChoice label="وصف (اختياري)" value={f.kind} options={inKinds} onChange={(v) => set('kind', v)} placeholder="مثلاً: أمانة، سداد…" />
            ) : (
              <button type="button" className="text-sm font-medium text-muted underline" onClick={() => setShowInKind(true)}>
                + وصف لما وصلني (حوالة، أمانة، سداد…)
              </button>
            )}
          </Step>

          {/* ٢. عمولتي */}
          <Step
            n={2}
            title="عمولتي"
            icon="chart"
            tone="plain"
            aside={
              <Chips
                small
                value={f.cMode}
                onChange={(v) => setF((s) => ({ ...s, cMode: v, cValue: v === 'percent' ? formatPercent(customer?.commissionBp ?? defaultCommissionBp) : '' }))}
                options={[
                  { value: 'percent', label: '%' },
                  { value: 'fixed', label: 'مبلغ' },
                ]}
              />
            }
          >
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label={f.cMode === 'percent' ? 'النسبة %' : `المبلغ (${sym(f.currency)})`} error={err('commission')}>
                <MoneyInput value={f.cValue} onChange={(e) => set('cValue', e.target.value)} className="text-xl" />
              </Field>
              <div className="rounded-2xl bg-income/10 px-3 py-2.5">
                <p className="text-xs font-medium text-muted">ربحي</p>
                <Money value={commission} currency={f.currency} tone="income" className="text-xl font-bold" />
              </div>
            </div>
            <p className="text-sm text-muted">
              المستحق للزبون بعد العمولة: <Money value={due} currency={f.currency} className="font-bold text-ink" />
            </p>
          </Step>

          {/* ٣. حوّلت له */}
          <Step n={3} title="حوّلت للزبون" icon="send" tone="out">
            <Chips
              value={f.payMode}
              onChange={(v) => setF((s) => ({ ...s, payMode: v, payAmount: v === s.payMode ? s.payAmount : '' }))}
              options={[
                { value: 'full', label: 'كامل المستحق' },
                { value: 'partial', label: 'جزء منه' },
                { value: 'later', label: 'لم أحوّل بعد' },
              ]}
            />
            {f.payMode === 'later' ? (
              <p className="rounded-2xl bg-pending-bg px-3 py-2.5 text-sm font-medium text-pending-ink">
                يبقى المستحق <Money value={due} currency={f.currency} className="font-bold" /> رصيداً له عندك، وتحوّله لاحقاً من صفحة الزبون.
              </p>
            ) : (
              <>
                <div>
                  <span className="label">حوّلت له بعملة</span>
                  <Chips small value={f.payCurrency} onChange={(v) => setF((s) => withRate({ ...s, payCurrency: v }))} options={currencyChips} />
                </div>
                <FreeChoice label="نوع التحويل" value={f.payMethod} options={outMethods.map((m) => m.name)} onChange={(v) => set('payMethod', v)} placeholder="مثلاً: بنك فلسطين، إنستاباي…" error={err('payMethod')} />

                {/* المبلغ والسعر */}
                {same ? (
                  f.payMode === 'partial' && (
                    <Field label={`كم حوّلت له؟ (${sym(f.payCurrency)})`} error={err('payAmount')}>
                      <MoneyInput value={f.payAmount} onChange={(e) => set('payAmount', e.target.value)} className="text-xl font-bold" />
                    </Field>
                  )
                ) : (
                  <div className="rounded-2xl bg-paper p-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={`كم حوّلت؟ (${sym(f.payCurrency)})`} error={err('payAmount')}>
                        <MoneyInput
                          value={f.payAmount}
                          onChange={(e) => set('payAmount', e.target.value)}
                          placeholder={f.payMode === 'full' && payout.ok && payout.payoutAmount > 0 ? toInputString(payout.payoutAmount, pc.decimals) : '0'}
                          className="text-xl font-bold"
                        />
                      </Field>
                      <Field label={`السعر: 1 ${sym(f.currency)} =`} error={err('rate')}>
                        <MoneyInput
                          value={shownRate}
                          onChange={(e) => setF((s) => ({ ...s, rate: e.target.value, payAmount: s.payMode === 'full' ? '' : s.payAmount }))}
                          placeholder="0"
                          className={cx('text-xl', amountDrives && 'text-muted')}
                        />
                      </Field>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {f.payMode === 'full' ? 'اكتب السعر فيُحسب المبلغ، أو اكتب المبلغ الذي حوّلته فيُحسب السعر.' : 'اكتب المبلغ الذي حوّلته والسعر، فيُخصم ما يعادله من رصيده.'}
                      {!amountDrives && recallRate(fxMemo, f.currency, f.payCurrency) && ' السعر من آخر عملية.'}
                    </p>
                    {showMarket ? (
                      <Field label="سعر السوق (لحساب ربح فرق السعر)" hint="اختياري" className="mt-3">
                        <MoneyInput value={f.marketRate} onChange={(e) => set('marketRate', e.target.value)} />
                      </Field>
                    ) : (
                      <button type="button" className="mt-2 text-sm font-medium text-muted underline" onClick={() => setShowMarket(true)}>
                        + سعر السوق (لحساب ربح فرق السعر)
                      </button>
                    )}
                  </div>
                )}

                {showOutKind || f.payKind ? (
                  <FreeChoice label="وصف التحويل (اختياري)" value={f.payKind} options={outKinds} onChange={(v) => set('payKind', v)} />
                ) : (
                  <button type="button" className="text-sm font-medium text-muted underline" onClick={() => setShowOutKind(true)}>
                    + وصف للتحويل
                  </button>
                )}
              </>
            )}
          </Step>

          <button type="button" className="btn-ghost w-full" onClick={() => setMore((m) => !m)}>
            {more ? 'إخفاء ▲' : 'رقم مرجعي، ملاحظات ▼'}
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

        {/* ═══ الإيصال: ملخص واضح للعملية ═══ */}
        <aside className="space-y-3 md:sticky md:top-24 md:self-start">
          <div className="hero rounded-[28px] p-5">
            <div className="mb-2 flex items-center justify-between gap-2 border-b border-white/15 pb-3">
              <p className="font-bold">ملخص العملية</p>
              {name && <span className="truncate text-sm opacity-85">{name}</span>}
            </div>
            <dl>
              <Line
                label="⬇ وصلني"
                value={amount ? <Money value={amount} currency={f.currency} /> : '—'}
                sub={f.method && `عن طريق ${f.method}${f.kind ? ` · ${f.kind}` : ''}`}
                strong
              />
              <Line label={`− عمولتي${f.cMode === 'percent' && cBp != null ? ` (${formatPercent(cBp)}%)` : ''}`} value={<Money value={commission} currency={f.currency} />} tone="gold" />
              <Line label="= المستحق له" value={<Money value={due} currency={f.currency} />} />
              <div className="my-1 border-t border-dashed border-white/20" />
              {f.payMode === 'later' ? (
                <Line label="⬆ حوّلت له" value="لم أحوّل بعد" tone="dim" />
              ) : (
                <Line
                  label="⬆ حوّلت له"
                  value={payout.ok && payout.payoutAmount > 0 ? <Money value={payout.payoutAmount} currency={f.payCurrency} /> : '—'}
                  sub={
                    <>
                      {f.payMethod && `عن طريق ${f.payMethod}`}
                      {!same && rate ? (
                        <>
                          {' · '}السعر <span className="num">{formatRate(rate)}</span>
                        </>
                      ) : null}
                    </>
                  }
                  strong
                />
              )}
              <div className={cx('mt-2 flex items-center justify-between rounded-2xl px-3 py-2', payout.remaining !== 0 ? 'bg-gold/25' : 'bg-white/10')}>
                <span className="text-sm font-semibold">{payout.remaining < 0 ? 'دفعت له زيادة' : 'الباقي له عندي'}</span>
                <Money value={Math.abs(payout.remaining)} currency={f.currency} className="font-bold" />
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/15 pt-3">
                <span className="font-bold">ربحي من العملية</span>
                <span className="text-end text-xl font-bold text-gold">
                  <Money value={commission} currency={f.currency} />
                  {payout.fxProfit !== 0 && (
                    <span className="block text-sm">
                      + <Money value={payout.fxProfit} currency={f.payCurrency} /> فرق سعر
                    </span>
                  )}
                </span>
              </div>
            </dl>
            {customer && Object.values(prevBalance).some((v) => v !== 0) && (
              <p className="mt-3 text-sm opacity-90">
                رصيده الكلي بعد العملية: <MoneyList values={newBalance} className="font-bold" />
              </p>
            )}
          </div>

          <button type="submit" disabled={saving} className="btn-gold hidden w-full py-4 text-lg md:flex">
            <Icon name="check" size={22} /> {editing ? 'حفظ التعديلات' : 'حفظ العملية'}
          </button>
          {editing && (
            <button type="button" className="btn-ghost w-full" onClick={() => nav(-1)}>
              رجوع
            </button>
          )}
        </aside>
      </div>

      {/* شريط الحفظ الثابت على الجوال */}
      <div className="sticky bottom-[92px] z-20 mt-4 md:hidden">
        <div className="flex items-center gap-3 rounded-3xl border border-card-border bg-card/95 p-2 ps-4 shadow-lg backdrop-blur">
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-xs text-muted">ربحي</p>
            <Money value={commission} currency={f.currency} tone="income" className="font-bold" />
          </div>
          <button type="submit" disabled={saving} className="btn-gold px-6">
            <Icon name="check" size={20} /> {editing ? 'حفظ' : 'حفظ العملية'}
          </button>
        </div>
      </div>
    </form>
  );
}
