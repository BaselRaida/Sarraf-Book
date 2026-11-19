import { describe, expect, it } from 'vitest';
import { pairKey, recallRate, rememberRate } from './fxMemory';

describe('ذاكرة أسعار الصرف', () => {
  it('تحفظ وتسترجع حسب الزوج والاتجاه', () => {
    const m = rememberRate(undefined, 'USD', 'ILS', 3_600_000, 3_650_000, 't1');
    expect(recallRate(m, 'USD', 'ILS')).toEqual({ payoutRate: 3_600_000, marketRate: 3_650_000, at: 't1' });
    expect(recallRate(m, 'ILS', 'USD')).toBeUndefined(); // الاتجاه مهم
    expect(pairKey('USD', 'ILS')).toBe('USD>ILS');
  });
  it('السعر الأحدث يستبدل القديم ولا يمس الأزواج الأخرى', () => {
    let m = rememberRate(undefined, 'USD', 'ILS', 3_600_000, null, 't1');
    m = rememberRate(m, 'JOD', 'ILS', 5_100_000, null, 't2');
    const m2 = rememberRate(m, 'USD', 'ILS', 3_550_000, undefined, 't3');
    expect(recallRate(m2, 'USD', 'ILS')?.payoutRate).toBe(3_550_000);
    expect(recallRate(m2, 'USD', 'ILS')?.marketRate).toBeUndefined();
    expect(recallRate(m2, 'JOD', 'ILS')?.payoutRate).toBe(5_100_000);
    expect(recallRate(m, 'USD', 'ILS')?.payoutRate).toBe(3_600_000); // الأصل لم يتغيّر
  });
  it('يتجاهل نفس العملة والسعر غير الموجب', () => {
    expect(rememberRate(undefined, 'USD', 'USD', 1_000_000, null, 't')).toEqual({});
    expect(rememberRate(undefined, 'USD', 'ILS', 0, null, 't')).toEqual({});
    expect(recallRate({}, 'USD', '')).toBeUndefined();
  });
});
