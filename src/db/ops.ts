import { db as defaultDb, logAudit, migrateV1toV2, nowIso, uid, ALL_TABLES, type SarrafDB } from './db';
import type { CashMovement, CurrencyCode, Customer, MovementType, Operation, Payment } from '../lib/types';

// ───────── الزبائن ─────────

/** يجد الزبون بالاسم (تطابق تام بعد التنظيف) أو ينشئه. */
export async function findOrCreateCustomer(name: string, extra: Partial<Customer> = {}, database: SarrafDB = defaultDb): Promise<Customer> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('اسم الزبون مطلوب');
  const existing = await database.customers.where('name').equals(clean).first();
  if (existing) return existing;
  const now = nowIso();
  const c: Customer = { id: uid(), name: clean, createdAt: now, updatedAt: now, ...extra };
  await database.customers.add(c);
  await logAudit({ entity: 'customer', entityId: c.id, action: 'customer-create', details: clean }, database);
  return c;
}

export async function updateCustomer(id: string, changes: Partial<Pick<Customer, 'name' | 'phone' | 'notes' | 'commissionBp'>>, database: SarrafDB = defaultDb) {
  await database.transaction('rw', database.customers, database.operations, database.payments, database.audit, async () => {
    const old = await database.customers.get(id);
    if (!old) throw new Error('الزبون غير موجود');
    const name = changes.name?.trim().replace(/\s+/g, ' ');
    if (name !== undefined && !name) throw new Error('اسم الزبون مطلوب');
    if (name && name !== old.name) {
      const dup = await database.customers.where('name').equals(name).first();
      if (dup) throw new Error('يوجد زبون بنفس الاسم');
      // تحديث الاسم المنسوخ في العمليات والدفعات
      await database.operations.where('customerId').equals(id).modify({ customerName: name });
      await database.payments.where('customerId').equals(id).modify({ customerName: name });
    }
    await database.customers.update(id, { ...changes, ...(name ? { name } : {}), updatedAt: nowIso() });
    await logAudit({ entity: 'customer', entityId: id, action: 'customer-update', details: JSON.stringify(changes) }, database);
  });
}

/** يضيف طريقة جديدة كتبها المستخدم إلى القائمة (إن لم تكن موجودة) لتظهر في المرة القادمة. */
export async function ensureMethod(name: string, use: 'in' | 'out', database: SarrafDB = defaultDb) {
  const n = name.trim();
  if (!n) return;
  const all = await database.methods.toArray();
  const found = all.find((m) => m.name === n);
  if (found) {
    if (found.use !== use && found.use !== 'both') await database.methods.update(found.id, { use: 'both' });
    if (!found.active) await database.methods.update(found.id, { active: true });
    return;
  }
  await database.methods.add({ id: uid(), name: n, use, active: true, order: Math.max(0, ...all.map((m) => m.order)) + 1 });
}

// ───────── العمليات والدفعات ─────────

export type OperationInput = Omit<Operation, 'id' | 'customerId' | 'customerName' | 'status' | 'createdAt' | 'updatedAt' | 'cancelledAt' | 'cancelReason'>;
export type PaymentInput = Omit<Payment, 'id' | 'customerId' | 'customerName' | 'operationId' | 'status' | 'createdAt' | 'updatedAt' | 'cancelledAt' | 'cancelReason'>;

/** عملية استلام جديدة، مع دفعة فورية اختيارية (كل شيء في معاملة واحدة). */
export async function createOperation(customerName: string, input: OperationInput, payout: PaymentInput | null, database: SarrafDB = defaultDb) {
  if (input.amount <= 0) throw new Error('المبلغ يجب أن يكون موجباً');
  return database.transaction('rw', [database.customers, database.operations, database.payments, database.audit], async () => {
    const c = await findOrCreateCustomer(customerName, {}, database);
    const now = nowIso();
    const op: Operation = { ...input, id: uid(), customerId: c.id, customerName: c.name, status: 'active', createdAt: now, updatedAt: now };
    await database.operations.add(op);
    let pay: Payment | undefined;
    if (payout && payout.payoutAmount > 0) {
      pay = { ...payout, id: uid(), customerId: c.id, customerName: c.name, operationId: op.id, status: 'active', createdAt: now, updatedAt: now };
      await database.payments.add(pay);
    }
    await database.customers.update(c.id, { updatedAt: now });
    await logAudit({ entity: 'operation', entityId: op.id, action: 'op-create', details: `${c.name}: ${input.amount} ${input.currency}، عمولة ${input.commission}` }, database);
    return { op, payment: pay, customer: c };
  });
}

/** تعديل عملية. payout: null = لا دفعة فورية مرتبطة (تُلغى إن وُجدت). */
export async function updateOperation(id: string, customerName: string, input: OperationInput, payout: PaymentInput | null, database: SarrafDB = defaultDb) {
  await database.transaction('rw', [database.customers, database.operations, database.payments, database.audit], async () => {
    const old = await database.operations.get(id);
    if (!old) throw new Error('العملية غير موجودة');
    if (old.status === 'cancelled') throw new Error('لا يمكن تعديل عملية ملغاة');
    const c = await findOrCreateCustomer(customerName, {}, database);
    const now = nowIso();
    const next: Operation = { ...old, ...input, customerId: c.id, customerName: c.name, updatedAt: now };
    await database.operations.put(next);

    const linked = (await database.payments.where('operationId').equals(id).toArray()).filter((p) => p.status === 'active');
    // الدفعة الفورية = أقدم دفعة مرتبطة؛ أي دفعات لاحقة مرتبطة تبقى كما هي
    const first = linked.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (payout && payout.payoutAmount > 0) {
      if (first) await database.payments.put({ ...first, ...payout, customerId: c.id, customerName: c.name, updatedAt: now });
      else await database.payments.add({ ...payout, id: uid(), customerId: c.id, customerName: c.name, operationId: id, status: 'active', createdAt: now, updatedAt: now });
    } else if (first) {
      await database.payments.update(first.id, { status: 'cancelled', cancelledAt: now, cancelReason: 'أُزيلت عند تعديل العملية', updatedAt: now });
    }
    const changed = (Object.keys(input) as (keyof OperationInput)[])
      .filter((k) => JSON.stringify(old[k]) !== JSON.stringify(next[k]))
      .map((k) => `${k}: ${old[k] ?? '—'} → ${next[k] ?? '—'}`);
    if (old.customerId !== c.id) changed.push(`الزبون: ${old.customerName} → ${c.name}`);
    await logAudit({ entity: 'operation', entityId: id, action: 'op-update', details: changed.join('\n') || 'تعديل الدفعة' }, database);
  });
}

/** إلغاء عملية (لا حذف نهائي) مع إلغاء دفعاتها المرتبطة. */
export async function cancelOperation(id: string, reason: string, database: SarrafDB = defaultDb) {
  await database.transaction('rw', database.operations, database.payments, database.audit, async () => {
    const op = await database.operations.get(id);
    if (!op || op.status === 'cancelled') throw new Error('العملية ملغاة مسبقاً');
    const now = nowIso();
    await database.operations.update(id, { status: 'cancelled', cancelledAt: now, cancelReason: reason, updatedAt: now });
    await database.payments
      .where('operationId')
      .equals(id)
      .and((p) => p.status === 'active')
      .modify({ status: 'cancelled', cancelledAt: now, cancelReason: `إلغاء العملية: ${reason}`, updatedAt: now });
    await logAudit({ entity: 'operation', entityId: id, action: 'op-cancel', details: reason }, database);
  });
}

/** دفعة مستقلة لزبون (تسديد من رصيده). */
export async function createPayment(customerId: string, input: PaymentInput, database: SarrafDB = defaultDb) {
  if (input.payoutAmount <= 0 || input.settled <= 0) throw new Error('المبلغ يجب أن يكون موجباً');
  return database.transaction('rw', database.customers, database.payments, database.audit, async () => {
    const c = await database.customers.get(customerId);
    if (!c) throw new Error('الزبون غير موجود');
    const now = nowIso();
    const p: Payment = { ...input, id: uid(), customerId, customerName: c.name, status: 'active', createdAt: now, updatedAt: now };
    await database.payments.add(p);
    await database.customers.update(customerId, { updatedAt: now });
    await logAudit({ entity: 'payment', entityId: p.id, action: 'pay-create', details: `${c.name}: ${input.payoutAmount} ${input.payoutCurrency}` }, database);
    return p;
  });
}

export async function cancelPayment(id: string, reason: string, database: SarrafDB = defaultDb) {
  await database.transaction('rw', database.payments, database.audit, async () => {
    const p = await database.payments.get(id);
    if (!p || p.status === 'cancelled') throw new Error('الدفعة ملغاة مسبقاً');
    const now = nowIso();
    await database.payments.update(id, { status: 'cancelled', cancelledAt: now, cancelReason: reason, updatedAt: now });
    await logAudit({ entity: 'payment', entityId: id, action: 'pay-cancel', details: reason }, database);
  });
}

// ───────── الصندوق ─────────

async function addMovement(database: SarrafDB, m: Omit<CashMovement, 'id' | 'createdAt'>) {
  const mv: CashMovement = { id: uid(), createdAt: nowIso(), ...m };
  await database.movements.add(mv);
  return mv;
}

/** حركة صندوق يدوية: إيداع / سحب / تسوية. */
export async function addCashMovement(
  type: Extract<MovementType, 'deposit' | 'withdraw' | 'adjust'>,
  currency: CurrencyCode,
  amount: number,
  note: string,
  date: string = nowIso(),
  database: SarrafDB = defaultDb,
) {
  if (amount === 0) throw new Error('المبلغ صفر');
  const signed = type === 'withdraw' ? -Math.abs(amount) : type === 'deposit' ? Math.abs(amount) : amount;
  await database.transaction('rw', database.movements, database.audit, async () => {
    const m = await addMovement(database, { date, type, currency, amount: signed, note });
    await logAudit({ entity: 'cash', entityId: m.id, action: type, details: `${currency} ${signed}` }, database);
  });
}

/** تحويل عملة داخل الصندوق. */
export async function exchangeCash(from: CurrencyCode, fromAmount: number, to: CurrencyCode, toAmount: number, note: string, date: string = nowIso(), database: SarrafDB = defaultDb) {
  if (from === to) throw new Error('العملتان متطابقتان');
  if (fromAmount <= 0 || toAmount <= 0) throw new Error('المبالغ يجب أن تكون موجبة');
  const groupId = uid();
  await database.transaction('rw', database.movements, database.audit, async () => {
    await addMovement(database, { date, type: 'exchange_out', currency: from, amount: -fromAmount, groupId, note });
    await addMovement(database, { date, type: 'exchange_in', currency: to, amount: toAmount, groupId, note });
    await logAudit({ entity: 'cash', entityId: groupId, action: 'exchange', details: `${from} ${fromAmount} → ${to} ${toAmount}` }, database);
  });
}

/** جرد: يسجّل الفعلي مقابل المحسوب، ويعتمد الفرق كتسوية إن طُلب. */
export async function recordCount(currency: CurrencyCode, expected: number, actual: number, note: string, applyAdjustment: boolean, date: string = nowIso(), database: SarrafDB = defaultDb) {
  const diff = actual - expected;
  await database.transaction('rw', database.counts, database.movements, database.audit, async () => {
    await database.counts.add({ id: uid(), date, currency, expected, actual, diff, note, adjusted: applyAdjustment && diff !== 0 });
    if (applyAdjustment && diff !== 0) await addMovement(database, { date, type: 'adjust', currency, amount: diff, note: `تسوية جرد${note ? ' — ' + note : ''}` });
    await logAudit({ entity: 'cash', action: 'count', details: `${currency} محسوب ${expected} فعلي ${actual} فرق ${diff}` }, database);
  });
  return diff;
}

// ───────── النسخ الاحتياطي ─────────

export const BACKUP_FORMAT = 'sarraf-book-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportBackup(database: SarrafDB = defaultDb): Promise<Backup> {
  const tables: Record<string, unknown[]> = {};
  for (const name of [...ALL_TABLES, 'transfers'] as const) tables[name] = await database.table(name).toArray();
  return { format: BACKUP_FORMAT, version: database.verno, exportedAt: nowIso(), tables };
}

export function validateBackup(data: unknown): data is Backup {
  if (!data || typeof data !== 'object') return false;
  const b = data as Backup;
  return b.format === BACKUP_FORMAT && typeof b.tables === 'object' && (Array.isArray(b.tables.operations) || Array.isArray(b.tables.transfers));
}

/**
 * استيراد نسخة احتياطية: يستبدل كل البيانات (معاملة واحدة — إما كلها أو لا شيء).
 * النسخ القديمة (الإصدار 1) تُحوَّل تلقائياً عبر نفس دالة الترحيل.
 */
export async function importBackup(data: unknown, database: SarrafDB = defaultDb) {
  if (!validateBackup(data)) throw new Error('الملف ليس نسخة احتياطية صالحة من صرّاف بوك');
  const legacy = (data.version ?? 1) < 2;
  const names = [...ALL_TABLES, 'transfers', 'rules', 'providers'] as const;
  await database.transaction('rw', names.map((n) => database.table(n)), async (tx) => {
    for (const name of names) {
      const t = database.table(name);
      await t.clear();
      const rows = data.tables[name];
      if (Array.isArray(rows) && rows.length) await t.bulkAdd(rows);
    }
    if (legacy) await migrateV1toV2(tx);
  });
  await logAudit({ entity: 'backup', action: 'import', details: `نسخة بتاريخ ${data.exportedAt}` }, database);
}
