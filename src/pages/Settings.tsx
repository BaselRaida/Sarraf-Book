import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, logAudit, setSetting, uid } from '../db/db';
import { exportBackup, importBackup, validateBackup } from '../db/ops';
import { useData } from '../data';
import { fmtDateTime, localDay } from '../lib/dates';
import { formatPercent, parsePercent } from '../lib/money';
import { createPin, isValidPin, verifyPin, type PinRecord } from '../lib/pin';
import { Chips, Field, Modal, MoneyInput, PageTitle, cx, downloadFile, useToast } from '../components/ui';
import { Icon } from '../components/icons';
import { useTheme, type ThemePref } from '../theme';
import type { Currency, Method } from '../lib/types';

export default function Settings() {
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth' });
  }, [loc.hash]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageTitle>الإعدادات</PageTitle>
      <ThemeSection />
      <CommissionSection />
      <MethodsSection />
      <CurrenciesSection />
      <BackupSection />
      <PinSection />
      <AuditSection />
      <p className="pb-4 text-center text-xs text-muted">صرّاف بوك · يعمل دون اتصال · بياناتك محفوظة على هذا الجهاز فقط</p>
    </div>
  );
}

function Section({ id, title, children, action }: { id?: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="section-title mb-0 text-base">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// ───────── المظهر ─────────
function ThemeSection() {
  const { pref, setPref } = useTheme();
  return (
    <Section title="المظهر">
      <Chips<ThemePref>
        value={pref}
        onChange={setPref}
        options={[
          { value: 'system', label: 'حسب الجهاز' },
          { value: 'light', label: 'فاتح' },
          { value: 'dark', label: 'داكن' },
        ]}
      />
    </Section>
  );
}

// ───────── العمولة الافتراضية ─────────
function CommissionSection() {
  const { defaultCommissionBp } = useData();
  const toast = useToast();
  const [v, setV] = useState(formatPercent(defaultCommissionBp));
  const save = async () => {
    const bp = parsePercent(v);
    if (bp == null || bp < 0 || bp > 10000) return toast('نسبة غير صالحة', 'error');
    await setSetting('defaultCommissionBp', bp);
    await logAudit({ entity: 'settings', action: 'default-commission', details: `${v}%` });
    toast('حُفظت النسبة');
  };
  return (
    <Section title="العمولة الافتراضية">
      <p className="mb-3 text-sm text-muted">تُستخدم للزبون الجديد. لكل زبون نسبته الخاصة، وتُحفظ تلقائياً من آخر عملية له، ويمكن تعديلها في كل عملية.</p>
      <div className="flex max-w-xs gap-2">
        <MoneyInput value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <span className="self-center text-xl font-bold">%</span>
        <button className="btn-outline" onClick={save}>
          حفظ
        </button>
      </div>
    </Section>
  );
}

// ───────── طرق الاستلام والتحويل ─────────
const USE_LABEL: Record<Method['use'], string> = { in: 'استلام', out: 'تحويل', both: 'الاثنين' };

function MethodsSection() {
  const { methods } = useData();
  const toast = useToast();
  const [name, setName] = useState('');
  const [use, setUse] = useState<Method['use']>('both');
  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (methods.some((m) => m.name === n)) return toast('الطريقة موجودة', 'error');
    await db.methods.add({ id: uid(), name: n, use, active: true, order: Math.max(0, ...methods.map((m) => m.order)) + 1 });
    setName('');
  };
  const move = async (i: number, d: -1 | 1) => {
    const a = methods[i];
    const b = methods[i + d];
    if (!a || !b) return;
    await db.transaction('rw', db.methods, async () => {
      await db.methods.update(a.id, { order: b.order });
      await db.methods.update(b.id, { order: a.order });
    });
  };
  const cycle = (m: Method) => db.methods.update(m.id, { use: m.use === 'both' ? 'in' : m.use === 'in' ? 'out' : 'both' });
  return (
    <Section id="methods" title="طرق الاستلام والتحويل">
      <p className="mb-3 text-sm text-muted">USDT، بنك، نقدي، ويسترن… أضف أي طريقة تتعامل بها. اضغط على النوع لتغييره.</p>
      <div className="space-y-1">
        {methods.map((m, i) => (
          <div key={m.id} className={cx('flex items-center gap-2 rounded-2xl px-2 py-1.5', !m.active && 'opacity-50')}>
            <span className="flex-1 font-bold">{m.name}</span>
            <button className="rounded-full bg-paper px-3 py-1 text-xs font-bold" onClick={() => cycle(m)}>
              {USE_LABEL[m.use]}
            </button>
            <button className="btn-ghost px-2 py-1" onClick={() => move(i, -1)} disabled={i === 0} aria-label="أعلى">
              <Icon name="up" size={16} />
            </button>
            <button className="btn-ghost px-2 py-1" onClick={() => move(i, 1)} disabled={i === methods.length - 1} aria-label="أسفل">
              <Icon name="down" size={16} />
            </button>
            <button className="btn-ghost px-2 py-1 text-sm" onClick={() => db.methods.update(m.id, { active: !m.active })}>
              {m.active ? 'إخفاء' : 'إظهار'}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input className="input" placeholder="طريقة جديدة (مثلاً: بنك فلسطين)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn-outline" onClick={add}>
            إضافة
          </button>
        </div>
        <Chips
          small
          value={use}
          onChange={setUse}
          options={[
            { value: 'both', label: 'استلام وتحويل' },
            { value: 'in', label: 'استلام فقط' },
            { value: 'out', label: 'تحويل فقط' },
          ]}
        />
      </div>
      <p className="mt-2 text-xs text-muted">لا تُحذف الطرق حفاظاً على السجل؛ يمكن إخفاؤها.</p>
    </Section>
  );
}

// ───────── العملات ─────────
function CurrenciesSection() {
  const { currencies } = useData();
  const toast = useToast();
  const [c, setC] = useState({ code: '', name: '', symbol: '', decimals: '2' });
  const add = async () => {
    const code = c.code.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) return toast('رمز العملة 3 أحرف لاتينية (مثل SAR)', 'error');
    if (currencies.some((x) => x.code === code)) return toast('العملة موجودة', 'error');
    const cur: Currency = { code, name: c.name.trim() || code, symbol: c.symbol.trim() || code, decimals: Math.min(3, Math.max(0, Number(c.decimals) || 0)), active: true, order: currencies.length + 1 };
    await db.currencies.add(cur);
    setC({ code: '', name: '', symbol: '', decimals: '2' });
  };
  return (
    <Section title="العملات">
      <div className="space-y-1.5">
        {currencies.map((x) => (
          <div key={x.code} className={cx('flex items-center gap-3 px-2 py-1', !x.active && 'opacity-50')}>
            <span className="num w-12 font-bold">{x.code}</span>
            <span className="flex-1">
              {x.name} <span className="text-muted">({x.symbol})</span>
            </span>
            <span className="text-xs text-muted">{x.decimals} خانات</span>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => db.currencies.update(x.code, { active: !x.active })}>
              {x.active ? 'إخفاء' : 'إظهار'}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input className="input num" placeholder="SAR" maxLength={3} value={c.code} onChange={(e) => setC({ ...c, code: e.target.value })} />
        <input className="input" placeholder="الاسم" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        <input className="input" placeholder="الرمز" value={c.symbol} onChange={(e) => setC({ ...c, symbol: e.target.value })} />
        <select className="input" value={c.decimals} onChange={(e) => setC({ ...c, decimals: e.target.value })}>
          <option value="0">0 خانات</option>
          <option value="2">2 خانات</option>
          <option value="3">3 خانات</option>
        </select>
        <button className="btn-outline col-span-2 sm:col-span-1" onClick={add}>
          إضافة
        </button>
      </div>
    </Section>
  );
}

// ───────── النسخ الاحتياطي ─────────
function BackupSection() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const last = useLiveQuery(async () => (await db.settings.get('lastBackupAt'))?.value as string | undefined, []);
  const counts = useLiveQuery(async () => ({ t: await db.operations.count(), m: await db.customers.count() }), []);
  const [pending, setPending] = useState<{ data: unknown; info: string } | null>(null);

  const doExport = async () => {
    const data = await exportBackup();
    downloadFile(`sarraf-backup_${localDay()}.json`, JSON.stringify(data), 'application/json');
    await setSetting('lastBackupAt', new Date().toISOString());
    await logAudit({ entity: 'backup', action: 'export' });
    toast('تم حفظ النسخة الاحتياطية');
  };

  const onFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (!validateBackup(data)) throw new Error('الملف ليس نسخة احتياطية من صرّاف بوك');
      setPending({ data, info: `${(data.tables.operations ?? data.tables.transfers ?? []).length} عملية · بتاريخ ${fmtDateTime(data.exportedAt)}` });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    try {
      // نسخة أمان تلقائية من البيانات الحالية قبل الاستبدال
      const current = await exportBackup();
      downloadFile(`sarraf-before-import_${localDay()}.json`, JSON.stringify(current), 'application/json');
      await importBackup(pending.data);
      toast('تمت الاستعادة بنجاح');
      setPending(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Section id="backup" title="النسخ الاحتياطي">
      <p className="mb-3 text-sm text-muted">
        كل إدخال يُحفظ فوراً على هذا الجهاز. للأمان احفظ نسخة دورياً على مكان آخر (فلاشة، Google Drive، واتساب لنفسك).
        <br />
        آخر نسخة: <span className="font-semibold text-ink">{last ? fmtDateTime(last) : 'لم تُؤخذ بعد'}</span>
        {counts && (
          <>
            {' '}
            · البيانات الحالية: <span className="num">{counts.t}</span> عملية، <span className="num">{counts.m}</span> زبون
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-gold" onClick={doExport}>
          <Icon name="download" size={18} /> تصدير نسخة احتياطية
        </button>
        <button className="btn-outline" onClick={() => fileRef.current?.click()}>
          <Icon name="upload" size={18} /> استيراد نسخة
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </div>
      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        title="استعادة نسخة احتياطية"
        footer={
          <>
            <button className="btn-ghost" onClick={() => setPending(null)}>
              إلغاء
            </button>
            <button className="btn-danger" onClick={confirmImport}>
              استبدال البيانات
            </button>
          </>
        }
      >
        <p className="text-sm">
          سيتم <b>استبدال كل البيانات الحالية</b> بمحتوى النسخة:
          <br />
          <span className="num font-semibold">{pending?.info}</span>
        </p>
        <p className="mt-3 text-sm text-muted">للأمان، سيُحفظ ملف بالبيانات الحالية تلقائياً قبل الاستبدال.</p>
      </Modal>
    </Section>
  );
}

// ───────── قفل PIN ─────────
function PinSection() {
  const toast = useToast();
  const pinRec = useLiveQuery(async () => ((await db.settings.get('pin'))?.value as PinRecord | undefined) ?? null, []);
  const autoLock = useLiveQuery(async () => ((await db.settings.get('autoLockMinutes'))?.value as number | undefined) ?? 2, []);
  const [mode, setMode] = useState<null | 'set' | 'remove'>(null);
  const [oldPin, setOldPin] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const reset = () => {
    setMode(null);
    setOldPin('');
    setP1('');
    setP2('');
  };

  const save = async () => {
    if (pinRec && !(await verifyPin(oldPin, pinRec))) return toast('الرمز الحالي غير صحيح', 'error');
    if (mode === 'remove') {
      await db.settings.delete('pin');
      await logAudit({ entity: 'settings', action: 'pin-remove' });
      toast('أُزيل قفل PIN');
      return reset();
    }
    if (!isValidPin(p1)) return toast('الرمز من 4 إلى 8 أرقام', 'error');
    if (p1 !== p2) return toast('الرمزان غير متطابقين', 'error');
    await setSetting('pin', await createPin(p1));
    await logAudit({ entity: 'settings', action: pinRec ? 'pin-change' : 'pin-set' });
    toast('حُفظ رمز PIN');
    reset();
  };

  if (pinRec === undefined) return null;
  const numeric = { inputMode: 'numeric' as const, type: 'password', autoComplete: 'off', maxLength: 8, dir: 'ltr' };

  return (
    <Section title="قفل التطبيق (PIN)">
      <p className="mb-3 text-sm text-muted">{pinRec ? 'القفل مفعّل. يُطلب الرمز عند فتح التطبيق وبعد البقاء في الخلفية.' : 'القفل غير مفعّل.'}</p>
      {!mode ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-outline" onClick={() => setMode('set')}>
            <Icon name="lock" size={16} /> {pinRec ? 'تغيير الرمز' : 'تفعيل القفل'}
          </button>
          {pinRec && (
            <>
              <button className="btn-ghost" onClick={() => setMode('remove')}>
                إزالة القفل
              </button>
              <label className="ms-auto flex items-center gap-2 text-sm">
                قفل بعد
                <select className="input w-auto py-1.5" value={autoLock} onChange={(e) => setSetting('autoLockMinutes', Number(e.target.value))}>
                  {[0, 1, 2, 5, 15, 60].map((m) => (
                    <option key={m} value={m}>
                      {m === 0 ? 'فوراً' : `${m} دقيقة`}
                    </option>
                  ))}
                </select>
                في الخلفية
              </label>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {pinRec && (
            <Field label="الرمز الحالي">
              <input className="input num" {...numeric} value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} autoFocus />
            </Field>
          )}
          {mode === 'set' && (
            <>
              <Field label="الرمز الجديد (4–8 أرقام)">
                <input className="input num" {...numeric} value={p1} onChange={(e) => setP1(e.target.value.replace(/\D/g, ''))} autoFocus={!pinRec} />
              </Field>
              <Field label="تأكيد الرمز">
                <input className="input num" {...numeric} value={p2} onChange={(e) => setP2(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && save()} />
              </Field>
            </>
          )}
          <div className="flex gap-2 sm:col-span-3">
            <button className="btn-ghost" onClick={reset}>
              إلغاء
            </button>
            <button className={mode === 'remove' ? 'btn-danger' : 'btn-outline'} onClick={save}>
              {mode === 'remove' ? 'إزالة القفل' : 'حفظ الرمز'}
            </button>
          </div>
          {mode === 'set' && <p className="text-xs text-pending-ink sm:col-span-3">⚠ لا يمكن استرجاع الرمز إن نسيته. خذ نسخة احتياطية أولاً.</p>}
        </div>
      )}
    </Section>
  );
}

// ───────── سجل التدقيق ─────────
const AUDIT_LABEL: Record<string, string> = {
  'op-create': 'عملية جديدة',
  'op-update': 'تعديل عملية',
  'op-cancel': 'إلغاء عملية',
  'pay-create': 'تحويل لزبون',
  'pay-cancel': 'إلغاء تحويل',
  'customer-create': 'زبون جديد',
  'customer-update': 'تعديل زبون',
  'default-commission': 'تغيير العمولة الافتراضية',
  deposit: 'إيداع',
  withdraw: 'سحب',
  adjust: 'تسوية',
  exchange: 'تحويل عملة',
  count: 'جرد',
  export: 'تصدير نسخة',
  import: 'استيراد نسخة',
  'rule-create': 'إضافة قاعدة',
  'rule-update': 'تعديل قاعدة',
  'rule-delete': 'حذف قاعدة',
  'pin-set': 'تفعيل PIN',
  'pin-change': 'تغيير PIN',
  'pin-remove': 'إزالة PIN',
};

function AuditSection() {
  const [open, setOpen] = useState(false);
  const entries = useLiveQuery(() => (open ? db.audit.orderBy('at').reverse().limit(200).toArray() : []), [open]);
  return (
    <Section
      title="سجل العمليات"
      action={
        <button className="btn-ghost py-1" onClick={() => setOpen((o) => !o)}>
          <Icon name="history" size={16} /> {open ? 'إخفاء' : 'عرض'}
        </button>
      }
    >
      {open && (
        <ul className="max-h-96 divide-y divide-card-border/40 overflow-y-auto text-sm">
          {entries?.map((a) => (
            <li key={a.id} className="py-2">
              <span className="font-medium">{AUDIT_LABEL[a.action] ?? a.action}</span> <span className="text-xs text-muted">· {fmtDateTime(a.at)}</span>
              {a.details && <pre className="mt-0.5 whitespace-pre-wrap font-sans text-xs text-muted">{a.details}</pre>}
            </li>
          ))}
        </ul>
      )}
      {!open && <p className="text-sm text-muted">كل إضافة وتعديل وإلغاء مسجّل هنا مع الوقت.</p>}
    </Section>
  );
}
