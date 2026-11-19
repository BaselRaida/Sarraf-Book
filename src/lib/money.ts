// دوال المال — بدون float. كل المبالغ أعداد صحيحة بأصغر وحدة.

const pow10 = (n: number) => 10 ** n;

/** تحويل الأرقام العربية-الهندية والفارسية إلى لاتينية. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/**
 * تحويل نص يكتبه المستخدم ("1,234.5" أو "١٢٣٤٫٥") إلى عدد صحيح بأصغر وحدة.
 * يُرجع null إذا كان النص غير صالح أو يحوي خانات عشرية أكثر من المسموح.
 */
export function parseMoney(input: string, decimals: number): number | null {
  if (input == null) return null;
  let s = normalizeDigits(String(input).trim());
  if (!s) return null;
  s = s.replace(/٫/g, '.').replace(/[,٬\s]/g, '');
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d*(\.\d*)?$/.test(s) || s === '.' || s === '') return null;
  const [intPart = '', fracPart = ''] = s.split('.');
  if (fracPart.length > decimals) return null;
  const whole = intPart === '' ? 0 : Number(intPart);
  const frac = fracPart === '' ? 0 : Number(fracPart.padEnd(decimals, '0'));
  const v = whole * pow10(decimals) + frac;
  if (!Number.isSafeInteger(v)) return null;
  return negative ? -v : v;
}

/** تحويل عدد صحيح بأصغر وحدة إلى نص منسّق ("1,234.50"). */
export function formatMoney(minor: number, decimals: number, opts: { grouping?: boolean; trimZeros?: boolean } = {}): string {
  const { grouping = true, trimZeros = false } = opts;
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const base = pow10(decimals);
  const whole = Math.floor(abs / base);
  const frac = abs % base;
  let wholeStr = String(whole);
  if (grouping) wholeStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let fracStr = decimals > 0 ? String(frac).padStart(decimals, '0') : '';
  if (trimZeros) fracStr = fracStr.replace(/0+$/, '');
  return (negative ? '-' : '') + wholeStr + (fracStr ? '.' + fracStr : '');
}

/** للحقول القابلة للتعديل: بلا فواصل آلاف وبلا أصفار زائدة. */
export function toInputString(minor: number, decimals: number): string {
  return formatMoney(minor, decimals, { grouping: false, trimZeros: true });
}

/** قسمة عددين صحيحين مع التقريب لأقرب عدد صحيح (النصف بعيداً عن الصفر). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('denominator must be positive');
  const neg = numerator < 0n;
  const n = neg ? -numerator : numerator;
  const q = (n * 2n + denominator) / (denominator * 2n);
  return neg ? -q : q;
}

/** النسبة بنقاط الأساس: applyBasisPoints(10000, 150) = 150 (1.5% من 100.00). */
export function applyBasisPoints(amount: number, bp: number): number {
  return Number(divRound(BigInt(amount) * BigInt(bp), 10000n));
}

/** نسبة مئوية كنص ("1.5") → نقاط أساس (150). تقبل حتى خانتين عشريتين. */
export function parsePercent(input: string): number | null {
  return parseMoney(input, 2);
}

export function formatPercent(bp: number): string {
  return formatMoney(bp, 2, { grouping: false, trimZeros: true });
}

export const RATE_SCALE = 1_000_000;

/** سعر الصرف كنص ("3.65") → عدد صحيح × 1,000,000. */
export function parseRate(input: string): number | null {
  const v = parseMoney(input, 6);
  if (v == null || v <= 0) return null;
  return v;
}

export function formatRate(rate: number): string {
  return formatMoney(rate, 6, { grouping: false, trimZeros: true });
}

/**
 * تحويل مبلغ من عملة إلى أخرى بسعر صرف (مضروب × 1,000,000) مع مراعاة اختلاف عدد الخانات العشرية.
 * convert(10000 سنت = 100$, 2, 2, 3.65×1e6) = 36500 أغورة.
 */
export function convert(amount: number, fromDecimals: number, toDecimals: number, rate: number): number {
  const num = BigInt(amount) * BigInt(rate) * 10n ** BigInt(toDecimals);
  const den = 10n ** BigInt(fromDecimals) * BigInt(RATE_SCALE);
  return Number(divRound(num, den));
}

export function sum(values: number[]): number {
  let t = 0;
  for (const v of values) t += v;
  return t;
}
