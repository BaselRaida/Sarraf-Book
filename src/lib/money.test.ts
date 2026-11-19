import { describe, expect, it } from 'vitest';
import { applyBasisPoints, convert, divRound, formatMoney, formatPercent, formatRate, parseMoney, parsePercent, parseRate, sum, toInputString } from './money';

describe('parseMoney', () => {
  it('يحوّل النص إلى أصغر وحدة', () => {
    expect(parseMoney('100', 2)).toBe(10000);
    expect(parseMoney('100.5', 2)).toBe(10050);
    expect(parseMoney('0.05', 2)).toBe(5);
    expect(parseMoney('.5', 2)).toBe(50);
    expect(parseMoney('1,234.56', 2)).toBe(123456);
  });
  it('يدعم الدينار بثلاث خانات (فلس)', () => {
    expect(parseMoney('12.345', 3)).toBe(12345);
    expect(parseMoney('1.5', 3)).toBe(1500);
  });
  it('يدعم الأرقام العربية والفاصلة العربية', () => {
    expect(parseMoney('١٢٣٤٫٥', 2)).toBe(123450);
    expect(parseMoney('١٬٠٠٠', 2)).toBe(100000);
  });
  it('يرفض المدخلات غير الصالحة', () => {
    expect(parseMoney('', 2)).toBeNull();
    expect(parseMoney('abc', 2)).toBeNull();
    expect(parseMoney('1.234', 2)).toBeNull();
    expect(parseMoney('1.2.3', 2)).toBeNull();
    expect(parseMoney('.', 2)).toBeNull();
  });
  it('يتجنّب أخطاء float الشهيرة', () => {
    // 0.1 + 0.2 في float = 0.30000000000000004
    expect(parseMoney('0.1', 2)! + parseMoney('0.2', 2)!).toBe(parseMoney('0.3', 2));
    expect(parseMoney('1.15', 2)).toBe(115);
    expect(parseMoney('4.35', 2)).toBe(435);
  });
  it('يدعم السالب', () => {
    expect(parseMoney('-5.25', 2)).toBe(-525);
  });
});

describe('formatMoney', () => {
  it('ينسّق المبالغ', () => {
    expect(formatMoney(123456, 2)).toBe('1,234.56');
    expect(formatMoney(5, 2)).toBe('0.05');
    expect(formatMoney(-525, 2)).toBe('-5.25');
    expect(formatMoney(12345, 3)).toBe('12.345');
    expect(formatMoney(100000000, 2)).toBe('1,000,000.00');
    expect(formatMoney(0, 2)).toBe('0.00');
  });
  it('خيارات بدون فواصل وأصفار', () => {
    expect(toInputString(10050, 2)).toBe('100.5');
    expect(toInputString(10000, 2)).toBe('100');
    expect(formatMoney(123456, 2, { grouping: false })).toBe('1234.56');
  });
  it('ذهاب وإياب', () => {
    for (const v of [0, 1, 99, 100, 12345, 999999999]) {
      expect(parseMoney(formatMoney(v, 2), 2)).toBe(v);
      expect(parseMoney(formatMoney(v, 3), 3)).toBe(v);
    }
  });
});

describe('divRound / applyBasisPoints', () => {
  it('يقرّب النصف بعيداً عن الصفر', () => {
    expect(divRound(5n, 10n)).toBe(1n);
    expect(divRound(4n, 10n)).toBe(0n);
    expect(divRound(15n, 10n)).toBe(2n);
    expect(divRound(-15n, 10n)).toBe(-2n);
  });
  it('يحسب النسبة بنقاط الأساس', () => {
    expect(applyBasisPoints(10000, 150)).toBe(150); // 1.5% من 100.00 = 1.50
    expect(applyBasisPoints(33333, 100)).toBe(333); // 1% من 333.33 = 3.3333 → 3.33
    expect(applyBasisPoints(33350, 100)).toBe(334); // 3.335 → 3.34
    expect(applyBasisPoints(0, 150)).toBe(0);
  });
  it('لا يفيض مع المبالغ الكبيرة', () => {
    expect(applyBasisPoints(900_000_000_000_00, 250)).toBe(2_250_000_000_000); // 2.5% من 900 مليار = 22.5 مليار
  });
  it('يرفض مقاماً غير موجب', () => {
    expect(() => divRound(1n, 0n)).toThrow();
  });
});

describe('النسب وأسعار الصرف', () => {
  it('parsePercent / formatPercent', () => {
    expect(parsePercent('1.5')).toBe(150);
    expect(parsePercent('2')).toBe(200);
    expect(parsePercent('0.25')).toBe(25);
    expect(parsePercent('1.255')).toBeNull();
    expect(formatPercent(150)).toBe('1.5');
  });
  it('parseRate / formatRate', () => {
    expect(parseRate('3.65')).toBe(3_650_000);
    expect(parseRate('0.709')).toBe(709_000);
    expect(parseRate('0')).toBeNull();
    expect(formatRate(3_650_000)).toBe('3.65');
  });
  it('convert بين عملات بخانات مختلفة', () => {
    expect(convert(10000, 2, 2, 3_650_000)).toBe(36500); // 100$ × 3.65 = 365₪
    expect(convert(100000, 3, 2, 5_150_000)).toBe(51500); // 100 د.أ × 5.15 = 515₪
    expect(convert(10000, 2, 3, 709_000)).toBe(70900); // 100$ × 0.709 = 70.900 د.أ
    expect(convert(333, 2, 2, 3_333_333)).toBe(1110); // 3.33 × 3.333333 = 11.0999… → 11.10
  });
  it('sum', () => {
    expect(sum([1, 2, 3])).toBe(6);
    expect(sum([])).toBe(0);
  });
});
