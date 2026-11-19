import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { SarrafDB, seedIfEmpty } from './db';
import {
  addCashMovement,
  cancelOperation,
  cancelPayment,
  createOperation,
  createPayment,
  ensureMethod,
  exchangeCash,
  exportBackup,
  findOrCreateCustomer,
  importBackup,
  recordCount,
  updateCustomer,
  updateOperation,
  type OperationInput,
  type PaymentInput,
} from './ops';
import { cashBalances, customerBalances, dailyProfit, groupOps, monthlyProfit, summarize, totalOwed } from '../lib/aggregate';

let db: SarrafDB;
let n = 0;
beforeEach(async () => {
  db = new SarrafDB(`test-${++n}`);
  await db.open();
});

const op = (p: Partial<OperationInput> = {}): OperationInput => ({
  date: new Date().toISOString(),
  method: 'USDT',
  amount: 100000,
  currency: 'USDT',
  commissionMode: 'percent',
  commissionBp: 200,
  commission: 2000,
  due: 98000,
  ...p,
});
const pay = (p: Partial<PaymentInput> = {}): PaymentInput => ({
  date: new Date().toISOString(),
  currency: 'USDT',
  settled: 98000,
  payoutCurrency: 'ILS',
  payoutAmount: 352800,
  rate: 3_600_000,
  method: 'تحويل بنكي',
  ...p,
});

const state = async () => {
  const [ops, pays, mv] = await Promise.all([db.operations.toArray(), db.payments.toArray(), db.movements.toArray()]);
  return { ops, pays, cash: cashBalances(mv, ops, pays), bal: customerBalances(ops, pays) };
};

describe('الزبائن', () => {
  it('ينشئ مرة واحدة وينظّف المسافات', async () => {
    const a = await findOrCreateCustomer('  أبو   أحمد ', {}, db);
    const b = await findOrCreateCustomer('أبو أحمد', {}, db);
    expect(a.id).toBe(b.id);
    expect(a.name).toBe('أبو أحمد');
    await expect(findOrCreateCustomer('  ', {}, db)).rejects.toThrow();
  });
  it('تغيير الاسم يُحدّث العمليات ويمنع التكرار', async () => {
    const { customer } = await createOperation('زبون', op(), null, db);
    await findOrCreateCustomer('آخر', {}, db);
    await updateCustomer(customer.id, { name: 'زبون جديد', commissionBp: 150 }, db);
    expect((await db.operations.toArray())[0].customerName).toBe('زبون جديد');
    expect((await db.customers.get(customer.id))?.commissionBp).toBe(150);
    await expect(updateCustomer(customer.id, { name: 'آخر' }, db)).rejects.toThrow();
  });
});

describe('العمليات', () => {
  it('المثال الكامل: استلام USDT وتحويل شيكل كامل', async () => {
    await createOperation('محمد', op(), pay(), db);
    const s = await state();
    expect(s.cash).toEqual({ USDT: 100000, ILS: -352800 });
    expect([...s.bal.values()][0]).toEqual({ USDT: 0 });
    expect(summarize(s.ops, s.pays).profit).toEqual({ USDT: 2000 });
  });

  it('استلام بدون تحويل يترك رصيداً للزبون، ثم دفعة لاحقة تسدّده', async () => {
    const { customer } = await createOperation('سامي', op(), null, db);
    let s = await state();
    expect(s.bal.get(customer.id)).toEqual({ USDT: 98000 });
    expect(totalOwed(s.bal)).toEqual({ USDT: 98000 });
    await createPayment(customer.id, pay({ settled: 50000, payoutAmount: 180000 }), db);
    s = await state();
    expect(s.bal.get(customer.id)).toEqual({ USDT: 48000 });
    expect(s.cash.ILS).toBe(-180000);
  });

  it('إلغاء العملية يلغي دفعتها ويعيد الأرصدة', async () => {
    const { op: o } = await createOperation('علي', op(), pay(), db);
    await cancelOperation(o.id, 'خطأ', db);
    const s = await state();
    expect(s.cash).toEqual({}); // الملغى لا يُحتسب إطلاقاً
    expect(s.pays[0].status).toBe('cancelled');
    expect(s.ops[0]).toMatchObject({ status: 'cancelled', cancelReason: 'خطأ' });
    expect(summarize(s.ops, s.pays).opCount).toBe(0);
    await expect(cancelOperation(o.id, 'x', db)).rejects.toThrow();
  });

  it('تعديل العملية: تغيير المبلغ وإزالة الدفعة ثم إضافتها', async () => {
    const { op: o } = await createOperation('علي', op(), pay(), db);
    await updateOperation(o.id, 'علي', op({ amount: 200000, commission: 4000, due: 196000 }), null, db);
    let s = await state();
    expect(s.cash).toEqual({ USDT: 200000 });
    expect([...s.bal.values()][0]).toEqual({ USDT: 196000 });
    await updateOperation(o.id, 'علي', op({ amount: 200000, commission: 4000, due: 196000 }), pay({ settled: 196000, payoutAmount: 705600 }), db);
    s = await state();
    expect(s.pays.filter((p) => p.status === 'active')).toHaveLength(1);
    expect([...s.bal.values()][0]).toEqual({ USDT: 0 });
  });

  it('تعديل العملية لنقلها لزبون آخر', async () => {
    const { op: o, customer } = await createOperation('أ', op(), pay(), db);
    await updateOperation(o.id, 'ب', op(), pay(), db);
    const s = await state();
    const b = await db.customers.where('name').equals('ب').first();
    expect(s.ops[0].customerId).toBe(b!.id);
    expect(s.pays[0].customerId).toBe(b!.id);
    expect(s.bal.get(customer.id)).toBeUndefined();
  });

  it('إلغاء دفعة مستقلة', async () => {
    const { customer } = await createOperation('س', op(), null, db);
    const p = await createPayment(customer.id, pay(), db);
    await cancelPayment(p.id, 'سهو', db);
    expect((await state()).bal.get(customer.id)).toEqual({ USDT: 98000 });
  });

  it('ربح فرق السعر يدخل في الأرباح', async () => {
    await createOperation('ف', op(), pay({ rate: 3_550_000, marketRate: 3_600_000, payoutAmount: 347900, fxProfit: 4900 }), db);
    const s = await state();
    expect(summarize(s.ops, s.pays)).toMatchObject({ commission: { USDT: 2000 }, fxProfit: { ILS: 4900 }, profit: { USDT: 2000, ILS: 4900 } });
  });

  it('المبلغ السالب مرفوض', async () => {
    await expect(createOperation('ز', op({ amount: 0 }), null, db)).rejects.toThrow();
  });
});

describe('الصندوق', () => {
  it('إيداع وسحب وتحويل عملة', async () => {
    await addCashMovement('deposit', 'ILS', 100000, '', undefined, db);
    await addCashMovement('withdraw', 'ILS', 5000, '', undefined, db);
    await exchangeCash('ILS', 36000, 'USD', 10000, '', '2026-01-05T10:00:00.000Z', db);
    expect((await state()).cash).toEqual({ ILS: 59000, USD: 10000 });
    await expect(exchangeCash('USD', 1, 'USD', 1, '', undefined, db)).rejects.toThrow();
    expect((await db.movements.toArray()).filter((m) => m.groupId).every((m) => m.date === '2026-01-05T10:00:00.000Z')).toBe(true);
  });
  it('الجرد مع اعتماد الفرق', async () => {
    await addCashMovement('deposit', 'ILS', 100000, '', undefined, db);
    expect(await recordCount('ILS', 100000, 99500, 'نقص', true, '2026-01-04T20:00:00.000Z', db)).toBe(-500);
    expect((await db.counts.toArray())[0].date).toBe('2026-01-04T20:00:00.000Z');
    expect((await state()).cash.ILS).toBe(99500);
  });
});

describe('التجميع', () => {
  it('حسب الزبون والطريقة، والسلسلة اليومية', async () => {
    const today = new Date().toISOString();
    await createOperation('أ', op({ date: today }), null, db);
    await createOperation('أ', op({ date: today, method: 'تحويل بنكي' }), null, db);
    await createOperation('ب', op({ date: today }), null, db);
    const s = await state();
    expect(summarize(s.ops, s.pays)).toMatchObject({ opCount: 3, customerCount: 2, received: { USDT: 300000 } });
    expect(groupOps(s.ops, (o) => o.customerName).map((r) => [r.key, r.count])).toEqual([
      ['أ', 2],
      ['ب', 1],
    ]);
    expect(groupOps(s.ops, (o) => o.method)[0]).toMatchObject({ key: 'USDT', count: 2, profit: { USDT: 4000 } });
    const day = today.slice(0, 10);
    const series = dailyProfit(s.ops, s.pays, ['2000-01-01', day], (iso) => iso.slice(0, 10));
    expect(series[0].count).toBe(0);
    expect(series[1]).toMatchObject({ count: 3, profit: { USDT: 6000 } });
  });
});

describe('الترحيل والنسخ الاحتياطي', () => {
  const legacy = (p: object) => ({
    id: Math.random().toString(36),
    date: '2026-11-18T10:00:00.000Z',
    referenceNo: 'MT1',
    provider: 'Western Union',
    senderName: 'المرسل',
    recipientName: 'محمد علي',
    amount: 100000,
    currency: 'ILS',
    commission: 1000,
    netPaid: 99000,
    status: 'paid',
    paidAt: '2026-11-18T10:05:00.000Z',
    createdAt: '2026-11-18T10:00:00.000Z',
    updatedAt: '2026-11-18T10:00:00.000Z',
    ...p,
  });

  it('يرحّل قاعدة الإصدار 1 دون فقدان البيانات', async () => {
    const name = `legacy-${++n}`;
    // إنشاء قاعدة بالمخطط القديم فقط
    const v1 = new Dexie(name);
    v1.version(1).stores({
      transfers: 'id, date, status, currency, provider, referenceNo, recipientName, senderName, paidAt',
      rules: 'id, order',
      providers: 'id, name, order',
      currencies: 'code, order',
      movements: 'id, date, currency, type, transferId, groupId',
      counts: 'id, date, currency',
      audit: 'id, at, entity, entityId',
      settings: 'key',
    });
    await v1.open();
    await v1.table('providers').add({ id: 'p1', name: 'Western Union', active: true, order: 1 });
    await v1.table('currencies').add({ code: 'ILS', name: 'شيكل', symbol: '₪', decimals: 2, active: true, order: 1 });
    await v1.table('rules').add({ id: 'r', type: 'percent', value: 150, active: true, order: 1 });
    await v1.table('transfers').bulkAdd([legacy({}), legacy({ status: 'pending', paidAt: undefined }), legacy({ recipientName: 'سامي', status: 'cancelled', paidAt: undefined })]);
    await v1.table('movements').bulkAdd([
      { id: 'm1', date: '', type: 'deposit', currency: 'ILS', amount: 500000 },
      { id: 'm2', date: '', type: 'payout', currency: 'ILS', amount: -99000 },
    ]);
    v1.close();

    const v2 = new SarrafDB(name);
    await v2.open();
    expect(v2.verno).toBe(4);
    const [customers, ops, pays, mv, methods, curr] = await Promise.all([
      v2.customers.toArray(),
      v2.operations.toArray(),
      v2.payments.toArray(),
      v2.movements.toArray(),
      v2.methods.toArray(),
      v2.currencies.toArray(),
    ]);
    expect(customers.map((c) => c.name).sort()).toEqual(['سامي', 'محمد علي']);
    expect(ops).toHaveLength(3);
    expect(ops.filter((o) => o.status === 'cancelled')).toHaveLength(1);
    expect(pays).toHaveLength(1);
    expect(methods.map((m) => m.name)).toContain('Western Union');
    expect(curr.map((c) => c.code)).toContain('USDT');
    expect(curr.map((c) => c.code)).toContain('EGP');
    expect(methods.map((m) => m.name)).toEqual(expect.arrayContaining(['جوال باي', 'بال باي', 'فودافون كاش']));
    expect((await v2.settings.get('defaultCommissionBp'))?.value).toBe(150);
    expect(await v2.transfers.count()).toBe(3); // الأرشيف القديم محفوظ
    // الرصيد نفسه قبل وبعد: 5000 إيداع − 990 صرف + استلامات (2 × 1000 غير ملغاة)
    expect(cashBalances(mv, ops, pays)).toEqual({ ILS: 500000 - 99000 + 200000 });
    const mohammed = customers.find((c) => c.name === 'محمد علي')!;
    expect(customerBalances(ops, pays).get(mohammed.id)).toEqual({ ILS: 99000 }); // حوالة معلّقة = مستحق له
    v2.close();
  });

  it('النسخ الاحتياطي ذهاباً وإياباً', async () => {
    await seedIfEmpty(db);
    await createOperation('أ', op(), pay(), db);
    const backup = JSON.parse(JSON.stringify(await exportBackup(db)));
    expect(backup.version).toBe(4);
    const other = new SarrafDB(`restore-${++n}`);
    await importBackup(backup, other);
    expect(await other.operations.count()).toBe(1);
    expect(await other.payments.count()).toBe(1);
    expect(await other.customers.count()).toBe(1);
    await expect(importBackup({ foo: 1 }, other)).rejects.toThrow();
    expect(await other.operations.count()).toBe(1);
  });

  it('استيراد نسخة قديمة (الإصدار 1) يرحّلها', async () => {
    const old = {
      format: 'sarraf-book-backup',
      version: 1,
      exportedAt: '2026-11-18T00:00:00.000Z',
      tables: { transfers: [legacy({})], providers: [], rules: [], currencies: [], movements: [], counts: [], audit: [], settings: [] },
    };
    const target = new SarrafDB(`restore-${++n}`);
    await importBackup(old, target);
    expect(await target.operations.count()).toBe(1);
    expect(await target.payments.count()).toBe(1);
    expect((await target.customers.toArray())[0].name).toBe('محمد علي');
  });
});

describe('الطرق والنوع الحر', () => {
  it('ensureMethod يضيف الطريقة الجديدة مرة واحدة ويوسّع استخدامها', async () => {
    await seedIfEmpty(db);
    const before = await db.methods.count();
    await ensureMethod('  بنك فلسطين ', 'in', db);
    await ensureMethod('بنك فلسطين', 'in', db);
    expect(await db.methods.count()).toBe(before + 1);
    const m = (await db.methods.toArray()).find((x) => x.name === 'بنك فلسطين')!;
    expect(m).toMatchObject({ use: 'in', active: true });
    await ensureMethod('بنك فلسطين', 'out', db);
    expect((await db.methods.get(m.id))?.use).toBe('both');
    await ensureMethod('   ', 'in', db);
    expect(await db.methods.count()).toBe(before + 1);
  });
  it('النوع والتاريخ السابق يُحفظان مع العملية والدفعة', async () => {
    const past = '2025-12-31T09:30:00.000Z';
    const { op: o, payment } = await createOperation('ك', op({ date: past, kind: 'أمانة' }), pay({ date: past, kind: 'دفعة أولى' }), db);
    expect((await db.operations.get(o.id))).toMatchObject({ date: past, kind: 'أمانة' });
    expect((await db.payments.get(payment!.id))).toMatchObject({ date: past, kind: 'دفعة أولى' });
  });
});

describe('الأرباح المتراكمة', () => {
  it('شهراً بشهر مع المتراكم، وتستثني الملغاة', async () => {
    await createOperation('أ', op({ date: '2026-09-10T10:00:00.000Z' }), null, db); // 20 USDT
    await createOperation('ب', op({ date: '2026-10-05T10:00:00.000Z', amount: 50000, commission: 1000, due: 49000 }), pay({ date: '2026-10-05T10:00:00.000Z', fxProfit: 700 }), db);
    const { op: c } = await createOperation('ج', op({ date: '2026-10-20T10:00:00.000Z' }), null, db);
    await cancelOperation(c.id, 'خطأ', db);
    await createOperation('د', op({ date: '2026-11-01T10:00:00.000Z', currency: 'ILS', commission: 1500, due: 98500 }), null, db);
    const s = await state();
    const rows = monthlyProfit(s.ops, s.pays, (iso) => iso.slice(0, 7));
    expect(rows.map((r) => r.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(rows[1]).toMatchObject({ count: 1, commission: { USDT: 1000 }, fxProfit: { ILS: 700 }, profit: { USDT: 1000, ILS: 700 } });
    expect(rows[0].cumulative).toEqual({ USDT: 2000 });
    expect(rows[1].cumulative).toEqual({ USDT: 3000, ILS: 700 });
    expect(rows[2].cumulative).toEqual({ USDT: 3000, ILS: 2200 });
  });
});
