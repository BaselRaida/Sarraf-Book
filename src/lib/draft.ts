// المسودات: كل ما يكتبه المستخدم في نموذج يُحفظ فوراً على الجهاز،
// فلا يضيع إن خرج من الشاشة أو أُغلق التطبيق أو تحدّث تلقائياً قبل الضغط على «حفظ».
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'sarraf-draft:';

export interface Draft<T> {
  data: T;
  savedAt: string; // ISO
}

/** تخزين بسيط قابل للاستبدال في الاختبارات */
export interface DraftStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  key(i: number): string | null;
  readonly length: number;
}

const defaultStore = (): DraftStore | null => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
};

export function readDraft<T>(key: string, store: DraftStore | null = defaultStore()): Draft<T> | null {
  if (!store) return null;
  try {
    const raw = store.getItem(PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft<T>;
    return d && typeof d === 'object' && 'data' in d ? d : null;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, data: T, store: DraftStore | null = defaultStore(), now: Date = new Date()) {
  if (!store) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify({ data, savedAt: now.toISOString() } satisfies Draft<T>));
  } catch {
    /* التخزين ممتلئ أو غير متاح — نتجاهل بهدوء */
  }
}

export function clearDraft(key: string, store: DraftStore | null = defaultStore()) {
  try {
    store?.removeItem(PREFIX + key);
  } catch {
    /* تجاهل */
  }
}

/** كل المسودات المحفوظة (لإظهار تنبيه «لديك عمل غير محفوظ») */
export function listDrafts(store: DraftStore | null = defaultStore()): { key: string; savedAt: string }[] {
  if (!store) return [];
  const out: { key: string; savedAt: string }[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const d = readDraft<unknown>(k.slice(PREFIX.length), store);
      if (d) out.push({ key: k.slice(PREFIX.length), savedAt: d.savedAt });
    }
  } catch {
    /* تجاهل */
  }
  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/**
 * يحفظ حالة النموذج تلقائياً ويسترجعها عند العودة.
 * - isDirty: هل في النموذج شيء يستحق الحفظ (لا نحفظ نموذجاً فارغاً)
 * - enabled: false لتعطيل المسودة (مثلاً عند تعديل عملية موجودة)
 * يُرجع: restored (وقت المسودة المسترجعة إن وُجدت)، و discard لمسحها، و clear بعد الحفظ الناجح.
 */
export function useDraft<T>(key: string, value: T, apply: (v: T) => void, isDirty: (v: T) => boolean, enabled = true) {
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const ready = useRef(false);
  const restoring = useRef(false); // لا نمسح المسودة قبل أن تصل القيم المسترجعة للنموذج
  const latest = useRef(value);
  latest.current = value;

  // الاسترجاع مرة واحدة عند الفتح
  useEffect(() => {
    if (!enabled) return;
    const d = readDraft<T>(key);
    if (d && isDirty(d.data)) {
      restoring.current = true;
      apply(d.data);
      setRestoredAt(d.savedAt);
    }
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  // الحفظ مع كل تغيير
  useEffect(() => {
    if (!enabled || !ready.current) return;
    if (isDirty(value)) {
      restoring.current = false;
      writeDraft(key, value);
    } else if (!restoring.current) clearDraft(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, value]);

  // حفظ فوري عند إخفاء التطبيق أو إغلاقه
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (ready.current && isDirty(latest.current)) writeDraft(key, latest.current);
    };
    const onVis = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const clear = useCallback(() => {
    clearDraft(key);
    setRestoredAt(null);
  }, [key]);

  return { restoredAt, clear };
}
