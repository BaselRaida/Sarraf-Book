import { describe, expect, it } from 'vitest';
import { calcPayout, commissionOf, convertBack } from './calc';

describe('commissionOf', () => {
  it('نسبة مئوية', () => {
    expect(commissionOf(100000, 'percent', 200)).toBe(2000); // 2% من 1000 = 20
    expect(commissionOf(33333, 'percent', 150)).toBe(500); // 1.5% من 333.33 = 4.99995 → 5.00
  });
  it('مبلغ ثابت', () => {
    expect(commissionOf(100000, 'fixed', 1500)).toBe(1500);
  });
  it('لا تتجاوز المبلغ ولا تكون سالبة', () => {
    expect(commissionOf(1000, 'fixed', 5000)).toBe(1000);
    expect(commissionOf(0, 'percent', 200)).toBe(0);
    expect(commissionOf(1000, 'fixed', -5)).toBe(0);
  });
});

describe('convertBack', () => {
  it('يعكس التحويل', () => {
    expect(convertBack(352800, 2, 2, 3_600_000)).toBe(98000); // 3528₪ ÷ 3.6 = 980
    expect(convertBack(51500, 3, 2, 5_150_000)).toBe(100000); // 515₪ ÷ 5.15 = 100.000 د.أ
    expect(convertBack(100000, 2, 2, 3_333_333)).toBe(30000); // 1000 ÷ 3.333333 = 300.00003 → 300.00
  });
});

describe('calcPayout', () => {
  const base = { due: 98000, decimals: 2, payoutDecimals: 2, rate: null, partialAmount: null, marketRate: null } as const;

  it('المثال: 1000 USDT − 2% → 980 تُحوَّل شيكل بسعر 3.6 = 3528', () => {
    const r = calcPayout({ ...base, mode: 'full', sameCurrency: false, rate: 3_600_000 });
    expect(r).toEqual({ payoutAmount: 352800, settled: 98000, remaining: 0, fxProfit: 0, ok: true });
  });
  it('كامل بنفس العملة', () => {
    expect(calcPayout({ ...base, mode: 'full', sameCurrency: true })).toMatchObject({ payoutAmount: 98000, settled: 98000, remaining: 0 });
  });
  it('جزء بنفس العملة يترك الباقي للزبون', () => {
    expect(calcPayout({ ...base, mode: 'partial', sameCurrency: true, partialAmount: 50000 })).toMatchObject({ payoutAmount: 50000, settled: 50000, remaining: 48000 });
  });
  it('جزء بعملة أخرى', () => {
    // حوّلت 1800₪ بسعر 3.6 = 500 USDT من رصيده، يبقى 480
    expect(calcPayout({ ...base, mode: 'partial', sameCurrency: false, rate: 3_600_000, partialAmount: 180000 })).toMatchObject({ payoutAmount: 180000, settled: 50000, remaining: 48000 });
  });
  it('دفع زيادة يجعل الباقي سالباً', () => {
    expect(calcPayout({ ...base, mode: 'partial', sameCurrency: true, partialAmount: 100000 }).remaining).toBe(-2000);
  });
  it('لاحقاً = لا شيء يخرج والمستحق كله باقٍ', () => {
    expect(calcPayout({ ...base, mode: 'later', sameCurrency: false })).toEqual({ payoutAmount: 0, settled: 0, remaining: 98000, fxProfit: 0, ok: true });
  });
  it('ربح فرق السعر مع سعر السوق', () => {
    // أعطيته 3.55 والسوق 3.60: 980×3.60 = 3528 − 980×3.55 = 3479 → ربح 49₪
    const r = calcPayout({ ...base, mode: 'full', sameCurrency: false, rate: 3_550_000, marketRate: 3_600_000 });
    expect(r.payoutAmount).toBe(347900);
    expect(r.fxProfit).toBe(4900);
  });
  it('غير صالح بدون سعر أو مبلغ', () => {
    expect(calcPayout({ ...base, mode: 'full', sameCurrency: false }).ok).toBe(false);
    expect(calcPayout({ ...base, mode: 'partial', sameCurrency: true }).ok).toBe(false);
  });
});
