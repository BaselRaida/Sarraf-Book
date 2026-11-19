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

const dtf = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const df = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' });
const tf = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeStyle: 'short' });

export const fmtDateTime = (iso: string) => dtf.format(new Date(iso));
export const fmtDate = (iso: string) => df.format(new Date(iso));
export const fmtTime = (iso: string) => tf.format(new Date(iso));
