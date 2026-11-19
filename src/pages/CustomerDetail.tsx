import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { cancelPayment, updateCustomer } from '../db/ops';
import { useData } from '../data';
import { customerBalances, nonZero, summarize } from '../lib/aggregate';
import { fmtDateTime } from '../lib/dates';
import { formatPercent, formatRate, parsePercent } from '../lib/money';
import type { Operation, Payment } from '../lib/types';
import { Avatar, CancelledBadge, Empty, Field, Modal, Money, MoneyInput, MoneyList, cx, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import OperationSheet from '../components/OperationSheet';
import PaymentSheet from '../components/PaymentSheet';

type Entry = { kind: 'op'; date: string; op: Operation } | { kind: 'pay'; date: string; pay: Payment };

export default function CustomerDetail() {
  const { id } = useParams();
  const { defaultCommissionBp } = useData();
  const toast = useToast();
  const customer = useLiveQuery(() => (id ? db.customers.get(id) : undefined), [id]);
  const ops = useLiveQuery(() => (id ? db.operations.where('customerId').equals(id).toArray() : []), [id]);
  const pays = useLiveQuery(() => (id ? db.payments.where('customerId').equals(id).toArray() : []), [id]);
  const [openOp, setOpenOp] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelPay, setCancelPay] = useState<Payment | null>(null);

  const d = useMemo(() => {
    if (!ops || !pays || !id) return null;
    const s = summarize(ops, pays);
    const bal = customerBalances(ops, pays).get(id) ?? {};
    const timeline: Entry[] = [...ops.map((op) => ({ kind: 'op' as const, date: op.date, op })), ...pays.filter((p) => !p.operationId).map((pay) => ({ kind: 'pay' as const, date: pay.date, pay }))].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
    // الدفعات المرتبطة بعمليات تُعرض داخل العملية
    const linked = new Map<string, Payment[]>();
    for (const p of pays) if (p.operationId) linked.set(p.operationId, [...(linked.get(p.operationId) ?? []), p]);
    return { s, bal, timeline, linked };
  }, [ops, pays, id]);

  if (customer === undefined || !d) return null;
  if (!customer) return <Empty>الزبون غير موجود</Empty>;

  const owed = nonZero(d.bal);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Avatar name={customer.name} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold">{customer.name}</h1>
          <p className="text-sm text-muted">
            عمولته: <span className="num font-bold text-ink">{formatPercent(customer.commissionBp ?? defaultCommissionBp)}%</span>
            {customer.phone && (
              <>
                {' · '}
                <a href={`tel:${customer.phone}`} className="num font-bold text-primary-2 dark:text-gold">
                  {customer.phone}
                </a>
              </>
            )}
          </p>
        </div>
        <button className="btn-ghost px-3" onClick={() => setEditing(true)} aria-label="تعديل الزبون">
          <Icon name="edit" />
        </button>
      </div>

      {/* الرصيد */}
      <section className={cx('rounded-[28px] p-5', owed.some(([, v]) => v > 0) ? 'hero' : 'card')}>
        <p className="text-sm font-bold opacity-80">{owed.length === 0 ? 'الحساب صافٍ' : owed.every(([, v]) => v < 0) ? 'دفعت له زيادة' : 'الرصيد الباقي له عندي'}</p>
        <div className={cx('mt-1 text-3xl font-extrabold', owed.some(([, v]) => v > 0) && 'text-gold')}>
          <MoneyList values={Object.fromEntries(owed.map(([c, v]) => [c, Math.abs(v)]))} empty="0 ✓" vertical />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link to={`/new?customer=${customer.id}`} className="btn-gold py-4">
          <Icon name="inbox" size={20} /> استلام
        </Link>
        <button className="btn-outline py-4" onClick={() => setPaying(true)}>
          <Icon name="send" size={20} /> تحويل له
        </button>
      </div>

      {/* الإحصاءات */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card">
          <p className="text-sm font-bold text-muted">بعث لي</p>
          <div className="font-extrabold">
            <MoneyList values={d.s.received} vertical />
          </div>
        </div>
        <div className="card">
          <p className="text-sm font-bold text-muted">حوّلت له</p>
          <div className="font-extrabold">
            <MoneyList values={d.s.paidOut} vertical />
          </div>
        </div>
        <div className="card">
          <p className="text-sm font-bold text-muted">ربحي منه</p>
          <div className="font-extrabold">
            <MoneyList values={d.s.profit} tone="income" vertical />
          </div>
        </div>
        <div className="card">
          <p className="text-sm font-bold text-muted">عدد العمليات</p>
          <p className="num text-2xl font-extrabold">{d.s.opCount}</p>
        </div>
      </section>

      {/* السجل */}
      <section>
        <h2 className="section-title">كشف الحساب</h2>
        {d.timeline.length === 0 ? (
          <Empty>لا عمليات بعد</Empty>
        ) : (
          <div className="space-y-2">
            {d.timeline.map((e) =>
              e.kind === 'op' ? (
                <button key={e.op.id} onClick={() => setOpenOp(e.op.id)} className={cx('card flex w-full items-start gap-3 text-start', e.op.status === 'cancelled' && 'opacity-50')}>
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-income/15 text-income">
                    <Icon name="inbox" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-extrabold">استلمت · {e.op.method}</p>
                      {e.op.status === 'cancelled' && <CancelledBadge />}
                    </div>
                    <p className="text-sm text-muted">{fmtDateTime(e.op.date)}</p>
                    {(d.linked.get(e.op.id) ?? [])
                      .filter((p) => p.status === 'active')
                      .map((p) => (
                        <p key={p.id} className="text-sm font-bold text-primary-2 dark:text-gold">
                          ← حوّلت <Money value={p.payoutAmount} currency={p.payoutCurrency} /> {p.method}
                          {p.rate ? <span className="num text-muted"> @{formatRate(p.rate)}</span> : null}
                        </p>
                      ))}
                  </div>
                  <div className="text-end">
                    <Money value={e.op.amount} currency={e.op.currency} className="block text-lg font-extrabold" />
                    <Money value={e.op.commission} currency={e.op.currency} tone="income" className="text-sm font-bold" />
                  </div>
                </button>
              ) : (
                <div key={e.pay.id} className={cx('card flex items-start gap-3', e.pay.status === 'cancelled' && 'opacity-50')}>
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary-2 dark:text-gold">
                    <Icon name="send" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-extrabold">حوّلت له · {e.pay.method}</p>
                      {e.pay.status === 'cancelled' && <CancelledBadge />}
                    </div>
                    <p className="text-sm text-muted">
                      {fmtDateTime(e.pay.date)}
                      {e.pay.rate ? <span className="num"> · @{formatRate(e.pay.rate)}</span> : null}
                      {e.pay.notes ? ` · ${e.pay.notes}` : ''}
                    </p>
                    {e.pay.status === 'active' && (
                      <button className="mt-1 text-xs font-bold text-muted underline" onClick={() => setCancelPay(e.pay)}>
                        إلغاء الدفعة
                      </button>
                    )}
                  </div>
                  <Money value={e.pay.payoutAmount} currency={e.pay.payoutCurrency} className="text-lg font-extrabold" />
                </div>
              ),
            )}
          </div>
        )}
      </section>

      <OperationSheet id={openOp} onClose={() => setOpenOp(null)} />
      {paying && <PaymentSheet customer={customer} balance={d.bal} onClose={() => setPaying(false)} />}
      {editing && <EditCustomer customer={customer} onClose={() => setEditing(false)} />}
      {cancelPay && (
        <Modal
          open
          onClose={() => setCancelPay(null)}
          title="إلغاء الدفعة"
          footer={
            <button
              className="btn-danger"
              onClick={async () => {
                await cancelPayment(cancelPay.id, 'إلغاء يدوي');
                toast('أُلغيت الدفعة');
                setCancelPay(null);
              }}
            >
              تأكيد الإلغاء
            </button>
          }
        >
          <p>
            إلغاء دفعة <Money value={cancelPay.payoutAmount} currency={cancelPay.payoutCurrency} className="font-extrabold" />؟ يعود المبلغ لرصيد الزبون، وتبقى الدفعة في السجل كملغاة.
          </p>
        </Modal>
      )}
    </div>
  );
}

function EditCustomer({ customer, onClose }: { customer: { id: string; name: string; phone?: string; notes?: string; commissionBp?: number | null }; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone ?? '');
  const [pct, setPct] = useState(customer.commissionBp != null ? formatPercent(customer.commissionBp) : '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  const save = async () => {
    const bp = pct ? parsePercent(pct) : null;
    if (pct && bp == null) return toast('نسبة غير صالحة', 'error');
    try {
      await updateCustomer(customer.id, { name, phone: phone.trim() || undefined, notes: notes.trim() || undefined, commissionBp: bp });
      toast('حُفظ');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="بيانات الزبون"
      footer={
        <button className="btn-gold w-full" onClick={save}>
          حفظ
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="الاسم">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="الهاتف">
          <input className="input num text-left" dir="ltr" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="نسبة العمولة الافتراضية %">
          <MoneyInput value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
        <Field label="ملاحظات">
          <textarea className="input min-h-[80px] text-base" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
