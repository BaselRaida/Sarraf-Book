import { describe, expect, it } from 'vitest';
import { fmtDate, fmtSmart } from './dates';

describe('التواريخ', () => {
  const now = new Date(2026, 10, 19, 15, 0); // 19 نوفمبر 2026 محلياً
  it('fmtDate بأسماء الأشهر وبلا شرطات مائلة', () => {
    const s = fmtDate(new Date(2026, 10, 18, 10, 0).toISOString());
    expect(s).toContain('نوفمبر');
    expect(s).toContain('18');
    expect(s).toContain('2026');
    expect(s).not.toContain('/');
  });
  it('fmtSmart: اليوم وأمس وهذه السنة وما قبلها', () => {
    expect(fmtSmart(new Date(2026, 10, 19, 9, 5).toISOString(), now)).toMatch(/^اليوم /);
    expect(fmtSmart(new Date(2026, 10, 18, 23, 59).toISOString(), now)).toMatch(/^أمس /);
    const thisYear = fmtSmart(new Date(2026, 2, 3, 8, 0).toISOString(), now);
    expect(thisYear).toContain('مارس');
    expect(thisYear).not.toContain('2026');
    const older = fmtSmart(new Date(2025, 11, 31, 8, 0).toISOString(), now);
    expect(older).toContain('2025');
    expect(older).toContain('ديسمبر');
  });
});
