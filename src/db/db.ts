import Dexie, { type Table, type Transaction } from 'dexie';
import type { AuditEntry, CashCount, CashMovement, Currency, Customer, LegacyTransfer, Method, Operation, Payment, Setting } from '../lib/types';

/**
 * قاعدة البيانات المحلية (IndexedDB عبر Dexie).
 * ⚠️ أي تغيير في المخطط: أضف version(N+1) جديدة مع upgrade() ولا تعدّل الإصدارات السابقة،
 * حتى تُرحَّل البيانات القديمة دون ضياع.
 */
export class SarrafDB extends Dexie {
  customers!: Table<Customer, string>;
  operations!: Table<Operation, string>;
  payments!: Table<Payment, string>;
  methods!: Table<Method, string>;
  currencies!: Table<Currency, string>;
  movements!: Table<CashMovement, string>;
  counts!: Table<CashCount, string>;
  audit!: Table<AuditEntry, string>;
  settings!: Table<Setting, string>;
  // جداول الإصدار 1 — تبقى محفوظة كأرشيف ولا تُستخدم
  transfers!: Table<LegacyTransfer, string>;

  constructor(name = 'sarraf-book') {
    super(name);
    // الإصدار 1: نموذج «حوالات الشركات» الأول
    this.version(1).stores({
      transfers: 'id, date, status, currency, provider, referenceNo, recipientName, senderName, paidAt',
      rules: 'id, order',
      providers: 'id, name, order',
      currencies: 'code, order',
      movements: 'id, date, currency, type, transferId, groupId',
      counts: 'id, date, currency',
      audit: 'id, at, entity, entityId',
      settings: 'key',
    });
    // الإصدار 2: نموذج «الزبائن» — عمليات استلام + دفعات + طرق مرنة
    this.version(2)
      .stores({
        customers: 'id, name, updatedAt',
        operations: 'id, date, customerId, status, currency, method',
        payments: 'id, date, customerId, operationId, status, payoutCurrency, method',
        methods: 'id, name, order',
      })
      .upgrade(migrateV1toV2);
  }
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

export const nowIso = () => new Date().toISOString();

const USDT: Currency = { code: 'USDT', name: 'USDT', symbol: 'USDT', decimals: 2, active: true, order: 3 };

/** ترحيل بيانات الإصدار 1 إلى نموذج الزبائن دون حذف أي شيء من الأرشيف. */
export async function migrateV1toV2(tx: Transaction) {
  const now = nowIso();

  // طرق الاستلام: من الشركات القديمة + طرق أساسية
  const providers = (await tx.table('providers').toArray()) as { name: string; active: boolean }[];
  const names = new Set<string>();
  const methods: Method[] = [];
  const push = (name: string, use: Method['use'], active = true) => {
    if (names.has(name)) return;
    names.add(name);
    methods.push({ id: uid(), name, use, active, order: methods.length + 1 });
  };
  push('USDT', 'both');
  push('تحويل بنكي', 'both');
  push('نقدي', 'both');
  for (const p of providers) push(p.name, 'in', p.active);
  await tx.table('methods').bulkAdd(methods);

  // عملة USDT
  if (!(await tx.table('currencies').get('USDT'))) await tx.table('currencies').add(USDT);

  // النسبة الافتراضية من أول قاعدة نسبة قديمة
  const rules = (await tx.table('rules').toArray()) as { type: string; value: number; active: boolean }[];
  const pr = rules.find((r) => r.active && r.type === 'percent');
  if (!(await tx.table('settings').get('defaultCommissionBp'))) await tx.table('settings').put({ key: 'defaultCommissionBp', value: pr ? pr.value : 100 });

  // الحوالات → زبائن + عمليات + دفعات
  const transfers = (await tx.table('transfers').toArray()) as LegacyTransfer[];
  const customers = new Map<string, Customer>();
  const ops: Operation[] = [];
  const pays: Payment[] = [];
  for (const t of transfers) {
    const key = t.recipientName.trim();
    let c = customers.get(key);
    if (!c) customers.set(key, (c = { id: uid(), name: key, phone: t.recipientPhone, createdAt: t.createdAt, updatedAt: now }));
    const cancelled = t.status === 'cancelled';
    const opId = uid();
    ops.push({
      id: opId,
      date: t.date,
      customerId: c.id,
      customerName: c.name,
      method: t.provider,
      reference: t.referenceNo,
      amount: t.amount,
      currency: t.currency,
      commissionMode: 'fixed',
      commission: t.commission,
      due: t.netPaid,
      notes: [t.senderName && `المرسل: ${t.senderName}`, t.notes].filter(Boolean).join(' — ') || undefined,
      status: cancelled ? 'cancelled' : 'active',
      cancelledAt: t.cancelledAt,
      cancelReason: t.cancelReason,
      createdAt: t.createdAt,
      updatedAt: now,
    });
    if (t.status === 'paid' || (cancelled && t.paidAt)) {
      const other = !!t.payoutCurrency && t.payoutCurrency !== t.currency && t.payoutAmount != null;
      pays.push({
        id: uid(),
        date: t.paidAt ?? t.date,
        customerId: c.id,
        customerName: c.name,
        operationId: opId,
        currency: t.currency,
        settled: t.netPaid,
        payoutCurrency: other ? t.payoutCurrency! : t.currency,
        payoutAmount: other ? t.payoutAmount! : t.netPaid,
        rate: other ? t.payoutRate : undefined,
        marketRate: other ? t.marketRate : undefined,
        fxProfit: other ? t.fxProfit : undefined,
        method: 'نقدي',
        status: cancelled ? 'cancelled' : 'active',
        cancelledAt: t.cancelledAt,
        createdAt: t.paidAt ?? t.createdAt,
        updatedAt: now,
      });
    }
  }
  await tx.table('customers').bulkAdd([...customers.values()]);
  await tx.table('operations').bulkAdd(ops);
  await tx.table('payments').bulkAdd(pays);

  // حركات الصرف التلقائية القديمة صارت تُحسب من الدفعات — نحذفها حتى لا تُحسب مرتين
  await tx.table('movements').where('type').anyOf('payout', 'payout_reversal').delete();
}

export const db = new SarrafDB();

export const ALL_TABLES = ['customers', 'operations', 'payments', 'methods', 'currencies', 'movements', 'counts', 'audit', 'settings'] as const;
export type TableName = (typeof ALL_TABLES)[number];

/** بيانات أولية عند أول تشغيل */
export async function seedIfEmpty(database: SarrafDB = db) {
  await database.transaction('rw', database.currencies, database.methods, database.settings, async () => {
    if ((await database.currencies.count()) === 0) {
      await database.currencies.bulkAdd([
        { code: 'ILS', name: 'شيكل', symbol: '₪', decimals: 2, active: true, order: 1 },
        { code: 'USD', name: 'دولار', symbol: '$', decimals: 2, active: true, order: 2 },
        USDT,
        { code: 'JOD', name: 'دينار', symbol: 'د.أ', decimals: 3, active: true, order: 4 },
        { code: 'EUR', name: 'يورو', symbol: '€', decimals: 2, active: true, order: 5 },
      ]);
    }
    if ((await database.methods.count()) === 0) {
      const list: [string, Method['use']][] = [
        ['USDT', 'both'],
        ['تحويل بنكي', 'both'],
        ['نقدي', 'both'],
        ['ويسترن يونيون', 'in'],
        ['موني غرام', 'in'],
      ];
      await database.methods.bulkAdd(list.map(([name, use], i) => ({ id: uid(), name, use, active: true, order: i + 1 })));
    }
    if (!(await database.settings.get('defaultCommissionBp'))) await database.settings.put({ key: 'defaultCommissionBp', value: 100 });
  });
}

export async function logAudit(entry: Omit<AuditEntry, 'id' | 'at'>, database: SarrafDB = db) {
  await database.audit.add({ id: uid(), at: nowIso(), ...entry });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return (s?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await db.settings.put({ key, value });
}
