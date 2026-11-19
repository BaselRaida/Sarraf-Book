import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { cancelOperation } from '../db/ops';
import { useData } from '../data';
import { fmtDateTime } from '../lib/dates';
import { formatPercent, formatRate } from '../lib/money';
import { Avatar, CancelledBadge, Field, Meta, Modal, Money, useToast } from './ui';
import { Icon } from './icons';

const ACTIONS: Record<string, string> = { 'op-create': 'إنشاء', 'op-update': 'تعديل', 'op-cancel': 'إلغاء' };

function Row({ k, v }: { k: string; v: ReactNode }) {
  if (v == null || v === '' || v === false) return null;
  return (
    <div className="flex justify-between gap-4 py-2 text-base">
      <span className="text-muted">{k}</span>
      <span className="text-end font-bold">{v}</span>
    </div>
  );
}

/** تفاصيل عملية: المبالغ، الدفعات المرتبطة، التعديل والإلغاء. */
export default function OperationSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const op = useLiveQuery(() => (id ? db.operations.get(id) : undefined), [id]);
  const pays = useLiveQuery(() => (id ? db.payments.where('operationId').equals(id).sortBy('date') : []), [id]);
  const audit = useLiveQuery(() => (id ? db.audit.where('entityId').equals(id).sortBy('at') : []), [id]);
  const { cur } = useData();
  const toast = useToast();
  const nav = useNavigate();
  const [cancelMode, setCancelMode] = useState(false);
  const [reason, setReason] = useState('');
  const [showLog, setShowLog] = useState(false);

  const close = () => {
    setCancelMode(false);
    setReason('');
    setShowLog(false);
    onClose();
  };
  if (!id || !op) return null;

  const doCancel = async () => {
    if (!reason.trim()) return toast('اكتب سبب الإلغاء', 'error');
    try {
      await cancelOperation(op.id, reason.trim());
      toast('أُلغيت العملية (محفوظة في السجل)');
      setCancelMode(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const live = (pays ?? []).filter((p) => p.status === 'active');
  const settled = live.reduce((a, p) => a + p.settled, 0);

  return (
    <Modal
      open
      onClose={close}
      title={
        <span className="flex items-center gap-2">
          عملية {op.status === 'cancelled' && <CancelledBadge />}
        </span>
      }
      footer={
        op.status === 'cancelled' ? null : cancelMode ? (
          <>
            <button className="btn-ghost" onClick={() => setCancelMode(false)}>
              تراجع
            </button>
            <button className="btn-danger" onClick={doCancel}>
              تأكيد الإلغاء
            </button>
          </>
        ) : (
          <>
            <button className="btn-ghost me-auto" onClick={() => setCancelMode(true)}>
              <Icon name="x" size={18} /> إلغاء
            </button>
            <button className="btn-outline" onClick={() => nav(`/edit/${op.id}`)}>
              <Icon name="edit" size={18} /> تعديل
            </button>
          </>
        )
      }
    >
      <Link to={`/customers/${op.customerId}`} onClick={close} className="mb-4 flex items-center gap-3 rounded-3xl bg-card p-3">
        <Avatar name={op.customerName} />
        <div className="flex-1">
          <p className="text-lg font-bold">{op.customerName}</p>
          <p className="text-sm text-muted">{fmtDateTime(op.date)}</p>
        </div>
        <Icon name="chevron" className="text-muted" />
      </Link>

      <div className="hero mb-4 rounded-3xl p-4">
        <p className="text-sm font-medium opacity-85">استلمت{op.kind ? ` (${op.kind})` : ''} عن طريق {op.method}</p>
        <Money value={op.amount} currency={op.currency} className="text-3xl font-bold" />
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-3">
          <div>
            <p className="text-xs font-medium opacity-80">ربحي {op.commissionMode === 'percent' && op.commissionBp != null && `(${formatPercent(op.commissionBp)}%)`}</p>
            <Money value={op.commission} currency={op.currency} className="text-lg font-bold text-gold" />
          </div>
          <div>
            <p className="text-xs font-medium opacity-80">المستحق له</p>
            <Money value={op.due} currency={op.currency} className="text-lg font-bold" />
          </div>
        </div>
      </div>

      {cancelMode && (
        <Field label="سبب الإلغاء" className="mb-4">
          <input className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً: أدخلتها بالخطأ" />
        </Field>
      )}

      <h3 className="mb-2 font-bold">التحويل له</h3>
      {(pays ?? []).length === 0 ? (
        <p className="mb-3 rounded-2xl bg-pending-bg px-3 py-2 font-bold text-pending-ink">لم يُحوَّل له شيء بعد من هذه العملية</p>
      ) : (
        <div className="mb-3 space-y-2">
          {pays!.map((p) => (
            <div key={p.id} className={`rounded-2xl bg-card p-3 ${p.status === 'cancelled' ? 'opacity-50' : ''}`}>
              <div className="flex items-center justify-between">
                <Money value={p.payoutAmount} currency={p.payoutCurrency} className="text-lg font-bold" />
                {p.status === 'cancelled' ? <CancelledBadge /> : <span className="text-sm text-muted">{p.kind ? `${p.kind} · ` : ''}{p.method}</span>}
              </div>
              <Meta
                className="block text-sm text-muted"
                items={[
                  fmtDateTime(p.date),
                  p.rate && (
                    <>
                      السعر <span className="num">{formatRate(p.rate)}</span>
                    </>
                  ),
                  !!p.fxProfit && (
                    <>
                      ربح فرق السعر <Money value={p.fxProfit} currency={p.payoutCurrency} tone="income" />
                    </>
                  ),
                ]}
              />
            </div>
          ))}
        </div>
      )}
      {op.status === 'active' && op.due - settled !== 0 && (
        <p className="mb-3 font-bold">
          الباقي له من هذه العملية: <Money value={op.due - settled} currency={op.currency} className="text-pending-ink" />
        </p>
      )}

      <div className="divide-y divide-card-border">
        <Row k="رقم مرجعي" v={op.reference && <span className="num">{op.reference}</span>} />
        <Row k="ملاحظات" v={op.notes} />
        <Row k="وقت الإلغاء" v={op.cancelledAt && fmtDateTime(op.cancelledAt)} />
        <Row k="سبب الإلغاء" v={op.cancelReason} />
        <Row k="عملة الاستلام" v={cur(op.currency).name} />
      </div>

      <button className="btn-ghost mt-2 w-full" onClick={() => setShowLog((s) => !s)}>
        <Icon name="history" size={18} /> سجل التغييرات ({audit?.length ?? 0})
      </button>
      {showLog && (
        <ul className="mt-2 space-y-2 text-sm">
          {audit?.map((a) => (
            <li key={a.id} className="rounded-2xl bg-card p-2.5">
              <span className="font-bold">{ACTIONS[a.action] ?? a.action}</span> · <span className="text-muted">{fmtDateTime(a.at)}</span>
              {a.details && <pre className="mt-1 whitespace-pre-wrap font-sans text-muted">{a.details}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
