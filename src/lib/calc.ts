// حسابات العملية والدفعة — دوال نقية بدون float، كلها مُختبَرة في calc.test.ts
import { RATE_SCALE, applyBasisPoints, convert, divRound } from './money';
import type { CommissionMode } from './types';

/** العمولة: نسبة (نقاط أساس) أو مبلغ ثابت، ولا تتجاوز المبلغ ولا تكون سالبة. */
export function commissionOf(amount: number, mode: CommissionMode, value: number): number {
  if (amount <= 0) return 0;
  const c = mode === 'percent' ? applyBasisPoints(amount, value) : value;
  return Math.max(0, Math.min(c, amount));
}

/**
 * عكس التحويل: كم يعادل مبلغ الدفعة (بعملة التحويل) من عملة رصيد الزبون.
 * convertBack(3528₪, عشريات الرصيد 2, عشريات الدفعة 2, 3.6) = 980 USDT
 */
export function convertBack(payout: number, balanceDecimals: number, payoutDecimals: number, rate: number): number {
  const num = BigInt(payout) * 10n ** BigInt(balanceDecimals) * BigInt(RATE_SCALE);
  const den = BigInt(rate) * 10n ** BigInt(payoutDecimals);
  return Number(divRound(num, den));
}

export type PayoutMode = 'full' | 'partial' | 'later';

export interface PayoutInput {
  due: number; // المبلغ المراد تسديده من رصيد الزبون (بعملة الرصيد)
  decimals: number; // عشريات عملة الرصيد
  mode: PayoutMode;
  sameCurrency: boolean;
  payoutDecimals: number;
  rate: number | null; // سعر الصرف × 1e6 (مطلوب عند اختلاف العملة)
  partialAmount: number | null; // المبلغ المحوَّل عند "جزء" (بعملة التحويل)
  marketRate?: number | null;
}

export interface PayoutResult {
  payoutAmount: number; // ما خرج مني بعملة التحويل
  settled: number; // ما خُصم من رصيد الزبون
  remaining: number; // الباقي للزبون (سالب = دفعت له زيادة)
  fxProfit: number; // ربح فرق السعر بعملة التحويل
  ok: boolean; // false إن نقص سعر الصرف أو المبلغ
}

/** حساب التحويل للزبون: كامل المستحق، أو جزء منه، أو لاحقاً. */
export function calcPayout(p: PayoutInput): PayoutResult {
  if (p.mode === 'later') return { payoutAmount: 0, settled: 0, remaining: p.due, fxProfit: 0, ok: true };
  const needsRate = !p.sameCurrency;
  if (needsRate && !p.rate) return { payoutAmount: 0, settled: 0, remaining: p.due, fxProfit: 0, ok: false };

  let payoutAmount: number;
  let settled: number;
  if (p.mode === 'full') {
    settled = p.due;
    payoutAmount = p.sameCurrency ? p.due : convert(p.due, p.decimals, p.payoutDecimals, p.rate!);
  } else {
    if (p.partialAmount == null || p.partialAmount <= 0) return { payoutAmount: 0, settled: 0, remaining: p.due, fxProfit: 0, ok: false };
    payoutAmount = p.partialAmount;
    settled = p.sameCurrency ? p.partialAmount : convertBack(p.partialAmount, p.decimals, p.payoutDecimals, p.rate!);
  }
  const fxProfit = needsRate && p.marketRate ? convert(settled, p.decimals, p.payoutDecimals, p.marketRate) - payoutAmount : 0;
  return { payoutAmount, settled, remaining: p.due - settled, fxProfit, ok: true };
}
