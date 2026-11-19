// تجميعات: أرصدة الزبائن، الصندوق، الأرباح، والتقارير — دوال نقية مختبَرة
import type { CashMovement, CurrencyCode, Operation, Payment } from './types';

export type Amounts = Record<CurrencyCode, number>;

const add = (m: Amounts, c: CurrencyCode, v: number) => {
  m[c] = (m[c] ?? 0) + v;
};
const live = <T extends { status: string }>(list: T[]) => list.filter((x) => x.status !== 'cancelled');

/** رصيد كل زبون لكل عملة = مجموع المستحق له − ما سُدِّد. موجب = له عندي. */
export function customerBalances(ops: Operation[], payments: Payment[]): Map<string, Amounts> {
  const out = new Map<string, Amounts>();
  const get = (id: string) => {
    let m = out.get(id);
    if (!m) out.set(id, (m = {}));
    return m;
  };
  for (const o of live(ops)) add(get(o.customerId), o.currency, o.due);
  for (const p of live(payments)) add(get(p.customerId), p.currency, -p.settled);
  return out;
}

/** مجموع المستحقات لكل الزبائن (ما عليّ تحويله) — الأرصدة الموجبة فقط. */
export function totalOwed(balances: Map<string, Amounts>): Amounts {
  const t: Amounts = {};
  for (const m of balances.values()) for (const [c, v] of Object.entries(m)) if (v > 0) add(t, c, v);
  return t;
}

/** رصيد الصندوق لكل عملة = الحركات اليدوية + كل ما استلمته − كل ما حوّلته. */
export function cashBalances(movements: CashMovement[], ops: Operation[], payments: Payment[]): Amounts {
  const b: Amounts = {};
  for (const m of movements) add(b, m.currency, m.amount);
  for (const o of live(ops)) add(b, o.currency, o.amount);
  for (const p of live(payments)) add(b, p.payoutCurrency, -p.payoutAmount);
  return b;
}

export interface Summary {
  opCount: number;
  customerCount: number;
  received: Amounts;
  commission: Amounts;
  fxProfit: Amounts;
  profit: Amounts; // العمولة + ربح فرق السعر
  paidOut: Amounts;
}

/** ملخص فترة: عدد العمليات والزبائن، المستلم، الأرباح، والمحوَّل. */
export function summarize(ops: Operation[], payments: Payment[]): Summary {
  const s: Summary = { opCount: 0, customerCount: 0, received: {}, commission: {}, fxProfit: {}, profit: {}, paidOut: {} };
  const customers = new Set<string>();
  for (const o of live(ops)) {
    s.opCount++;
    customers.add(o.customerId);
    add(s.received, o.currency, o.amount);
    add(s.commission, o.currency, o.commission);
    add(s.profit, o.currency, o.commission);
  }
  for (const p of live(payments)) {
    add(s.paidOut, p.payoutCurrency, p.payoutAmount);
    if (p.fxProfit) {
      add(s.fxProfit, p.payoutCurrency, p.fxProfit);
      add(s.profit, p.payoutCurrency, p.fxProfit);
    }
  }
  s.customerCount = customers.size;
  return s;
}

export interface GroupRow {
  key: string;
  count: number;
  received: Amounts;
  profit: Amounts;
}

/** تجميع العمليات حسب مفتاح (الزبون أو طريقة الاستلام). */
export function groupOps(ops: Operation[], keyOf: (o: Operation) => string): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const o of live(ops)) {
    const k = keyOf(o);
    let r = map.get(k);
    if (!r) map.set(k, (r = { key: k, count: 0, received: {}, profit: {} }));
    r.count++;
    add(r.received, o.currency, o.amount);
    add(r.profit, o.currency, o.commission);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** الأرباح اليومية لسلسلة أيام (للرسم البياني). dayOf يحوّل ISO إلى YYYY-MM-DD محلي. */
export function dailyProfit(ops: Operation[], payments: Payment[], days: string[], dayOf: (iso: string) => string): { day: string; profit: Amounts; count: number }[] {
  const idx = new Map(days.map((d, i) => [d, i]));
  const rows = days.map((day) => ({ day, profit: {} as Amounts, count: 0 }));
  for (const o of live(ops)) {
    const i = idx.get(dayOf(o.date));
    if (i == null) continue;
    rows[i].count++;
    add(rows[i].profit, o.currency, o.commission);
  }
  for (const p of live(payments)) {
    if (!p.fxProfit) continue;
    const i = idx.get(dayOf(p.date));
    if (i != null) add(rows[i].profit, p.payoutCurrency, p.fxProfit);
  }
  return rows;
}

/** حذف الأصفار من مجموعة مبالغ. */
export const nonZero = (m: Amounts) => Object.entries(m).filter(([, v]) => v !== 0);
