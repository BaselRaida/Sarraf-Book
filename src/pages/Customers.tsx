import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLedger } from '../hooks';
import { useData } from '../data';
import { findOrCreateCustomer } from '../db/ops';
import { customerBalances, nonZero, summarize } from '../lib/aggregate';
import { fmtDate } from '../lib/dates';
import { normalizeDigits, parsePercent } from '../lib/money';
import { Avatar, Chips, Empty, Field, Modal, MoneyInput, MoneyList, PageTitle, useToast } from '../components/ui';
import { Icon } from '../components/icons';

export default function Customers() {
  const { ready, ops, payments, customers } = useLedger();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const filter = params.get('owed') ? 'owed' : 'all';

  const rows = useMemo(() => {
    const bal = customerBalances(ops, payments);
    const lastOp = new Map<string, string>();
    for (const o of ops) if (!lastOp.has(o.customerId) || o.date > lastOp.get(o.customerId)!) lastOp.set(o.customerId, o.date);
    const profit = new Map<string, ReturnType<typeof summarize>>();
    for (const c of customers) {
      profit.set(
        c.id,
        summarize(
          ops.filter((o) => o.customerId === c.id),
          payments.filter((p) => p.customerId === c.id),
        ),
      );
    }
    const needle = normalizeDigits(q.trim().toLowerCase());
    return customers
      .map((c) => ({ c, bal: bal.get(c.id) ?? {}, last: lastOp.get(c.id) ?? c.createdAt, s: profit.get(c.id)! }))
      .filter((r) => !needle || r.c.name.toLowerCase().includes(needle) || (r.c.phone ?? '').includes(needle))
      .filter((r) => filter === 'all' || Object.values(r.bal).some((v) => v > 0))
      .sort((a, b) => b.last.localeCompare(a.last));
  }, [ops, payments, customers, q, filter]);

  if (!ready) return null;

  return (
    <div>
      <PageTitle
        sub={`${customers.length} زبون`}
        action={
          <button className="btn-outline" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} /> زبون
          </button>
        }
      >
        الزبائن
      </PageTitle>

      <div className="relative mb-3">
        <Icon name="search" size={20} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input ps-12" placeholder="بحث بالاسم أو الهاتف" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
      </div>
      <Chips
        small
        className="mb-4"
        value={filter}
        onChange={(v) => setParams(v === 'owed' ? { owed: '1' } : {}, { replace: true })}
        options={[
          { value: 'all', label: 'الكل' },
          { value: 'owed', label: 'لهم رصيد عندي' },
        ]}
      />

      {rows.length === 0 ? (
        <Empty>{customers.length === 0 ? 'لا زبائن بعد. يُضاف الزبون تلقائياً مع أول عملية.' : 'لا نتائج'}</Empty>
      ) : (
        <div className="card divide-y divide-card-border p-0">
          {rows.map(({ c, bal, last, s }) => {
            const owed = nonZero(bal).filter(([, v]) => v > 0);
            return (
              <Link key={c.id} to={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3.5">
                <Avatar name={c.name} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-lg font-bold">{c.name}</p>
                  <p className="truncate text-sm text-muted">
                    <span className="num">{s.opCount}</span> عملية · آخرها {fmtDate(last)}
                  </p>
                </div>
                <div className="text-end text-sm">
                  {owed.length > 0 ? (
                    <span className="inline-block rounded-2xl bg-pending-bg px-2.5 py-1 font-bold text-pending-ink">
                      له <MoneyList values={Object.fromEntries(owed)} vertical />
                    </span>
                  ) : (
                    <span className="font-bold">
                      <MoneyList values={s.profit} tone="income" vertical empty="" />
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {adding && <AddCustomer onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddCustomer({ onClose }: { onClose: () => void }) {
  const { defaultCommissionBp } = useData();
  const toast = useToast();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pct, setPct] = useState('');
  const save = async () => {
    const bp = pct ? parsePercent(pct) : null;
    if (pct && bp == null) return toast('نسبة غير صالحة', 'error');
    try {
      const c = await findOrCreateCustomer(name, { phone: phone.trim() || undefined, commissionBp: bp });
      toast('أُضيف الزبون');
      nav(`/customers/${c.id}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="زبون جديد"
      footer={
        <button className="btn-gold w-full" onClick={save}>
          حفظ
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="الاسم">
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="الهاتف (اختياري)">
          <input className="input num text-left" dir="ltr" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="نسبة العمولة %" hint={`فارغ = النسبة العامة (${defaultCommissionBp / 100}%)`}>
          <MoneyInput value={pct} onChange={(e) => setPct(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
