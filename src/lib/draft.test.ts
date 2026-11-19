import { describe, expect, it } from 'vitest';
import { clearDraft, listDrafts, readDraft, writeDraft, type DraftStore } from './draft';

const memStore = (): DraftStore => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
};

describe('المسودات', () => {
  it('تحفظ وتسترجع وتُمسح', () => {
    const s = memStore();
    writeDraft('op', { amount: '1000', customer: 'أبو أحمد' }, s, new Date('2026-11-19T10:00:00Z'));
    expect(readDraft('op', s)).toEqual({ data: { amount: '1000', customer: 'أبو أحمد' }, savedAt: '2026-11-19T10:00:00.000Z' });
    clearDraft('op', s);
    expect(readDraft('op', s)).toBeNull();
  });
  it('تتجاهل البيانات التالفة', () => {
    const s = memStore();
    s.setItem('sarraf-draft:op', '{not json');
    expect(readDraft('op', s)).toBeNull();
    s.setItem('sarraf-draft:x', '42');
    expect(readDraft('x', s)).toBeNull();
  });
  it('تسرد المسودات فقط، الأحدث أولاً', () => {
    const s = memStore();
    s.setItem('other-key', 'x');
    writeDraft('a', 1, s, new Date('2026-11-19T09:00:00Z'));
    writeDraft('b', 2, s, new Date('2026-11-19T11:00:00Z'));
    expect(listDrafts(s).map((d) => d.key)).toEqual(['b', 'a']);
  });
  it('لا تنهار بدون تخزين', () => {
    expect(readDraft('op', null)).toBeNull();
    expect(listDrafts(null)).toEqual([]);
    expect(() => writeDraft('op', 1, null)).not.toThrow();
  });
});
