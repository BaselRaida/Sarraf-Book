// تذكّر آخر سعر صرف استُخدم لكل زوج عملات (مثلاً USD>ILS) لتسريع الإدخال.
// الأسعار أعداد صحيحة × 1,000,000 (انظر money.ts).

export interface RememberedRate {
  payoutRate: number;
  marketRate?: number;
  at: string;
}
export type FxMemory = Record<string, RememberedRate>;

export const FX_MEMORY_KEY = 'fxRates';

export const pairKey = (from: string, to: string) => `${from}>${to}`;

export function recallRate(mem: FxMemory | undefined, from: string, to: string): RememberedRate | undefined {
  if (!mem || !from || !to || from === to) return undefined;
  return mem[pairKey(from, to)];
}

/** يُرجع نسخة جديدة من الذاكرة بعد حفظ السعر (لا يعدّل الأصل). */
export function rememberRate(mem: FxMemory | undefined, from: string, to: string, payoutRate: number, marketRate: number | null | undefined, at: string): FxMemory {
  if (from === to || payoutRate <= 0) return { ...(mem ?? {}) };
  return { ...(mem ?? {}), [pairKey(from, to)]: { payoutRate, marketRate: marketRate && marketRate > 0 ? marketRate : undefined, at } };
}
