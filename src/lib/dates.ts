// تواريخ محلية (حسب جهاز المستخدم)

const pad = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD بالتوقيت المحلي */
export function localDay(d: Date | string = new Date()): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

/** قيمة لحقل datetime-local */
export function toLocalInput(d: Date | string = new Date()): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${localDay(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

/** بداية اليوم المحلي (ISO) */
export function startOfDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** نهاية اليوم المحلي (ISO) */
export function endOfDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

export function monthRange(d: Date = new Date()): [string, string] {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return [localDay(first), localDay(last)];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + n));
}

// التواريخ بأسماء الأشهر العربية («18 نوفمبر 2026») بدل الشَّرطات المائلة:
// الصيغة الرقمية 18/11/2026 تختلط اتجاهها مع الكلمات اللاتينية المجاورة (مثل USDT) فتظهر مقلوبة.
const L = 'ar-EG-u-nu-latn';
const dFull = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'long', year: 'numeric' });
const dMonth = new Intl.DateTimeFormat(L, { day: 'numeric', month: 'long' });
const tf = new Intl.DateTimeFormat(L, { hour: 'numeric', minute: '2-digit' });

export const fmtTime = (iso: string) => tf.format(new Date(iso));
export const fmtDate = (iso: string) => dFull.format(new Date(iso));
export const fmtDateTime = (iso: string) => `${dFull.format(new Date(iso))}، ${fmtTime(iso)}`;

/**
 * تاريخ مختصر ودود للقوائم:
 * اليوم ← «اليوم 2:13 م»، أمس ← «أمس 2:13 م»، هذه السنة ← «18 نوفمبر»، غير ذلك ← «18 نوفمبر 2025».
 * (قصير عمداً حتى لا يُقصّ في القوائم؛ التاريخ الكامل يظهر في التفاصيل)
 */
export function fmtSmart(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = localDay(d);
  const today = localDay(now);
  if (day === today) return `اليوم ${fmtTime(iso)}`;
  if (day === addDays(today, -1)) return `أمس ${fmtTime(iso)}`;
  if (d.getFullYear() === now.getFullYear()) return dMonth.format(d);
  return dFull.format(d);
}
