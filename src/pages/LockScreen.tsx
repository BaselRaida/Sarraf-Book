import { useEffect, useState } from 'react';
import { verifyPin, type PinRecord } from '../lib/pin';
import { normalizeDigits } from '../lib/money';
import { cx } from '../components/ui';

export default function LockScreen({ pin, onUnlock }: { pin: PinRecord; onUnlock: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [waitUntil, setWaitUntil] = useState(0);
  const [, tick] = useState(0);

  const waiting = Date.now() < waitUntil;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [waiting]);

  const tryPin = async (v: string) => {
    if (v.length < 4) return;
    if (await verifyPin(v, pin)) return onUnlock();
    if (v.length >= (pin.length ?? 8)) fail();
  };
  const fail = () => {
    const n = attempts + 1;
    setAttempts(n);
    setError(true);
    setValue('');
    if (n >= 5) setWaitUntil(Date.now() + 30_000 * (n - 4)); // تأخير متزايد بعد 5 محاولات
  };

  const press = (d: string) => {
    if (waiting) return;
    setError(false);
    const v = (value + d).slice(0, 8);
    setValue(v);
    void tryPin(v);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = normalizeDigits(e.key);
      if (/^\d$/.test(k)) press(k);
      else if (e.key === 'Backspace') setValue((v) => v.slice(0, -1));
      else if (e.key === 'Enter' && value.length >= 4) fail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="hero flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="h-16 w-16 rounded-2xl shadow-lg" />
      <div className="text-center">
        <h1 className="text-2xl font-bold">صرّاف بوك</h1>
        <p className="mt-1 text-sm opacity-80">{waiting ? `محاولات كثيرة — انتظر ${Math.ceil((waitUntil - Date.now()) / 1000)} ثانية` : 'أدخل رمز PIN'}</p>
      </div>
      <div className={cx('flex h-4 gap-3', error && 'animate-[shake_.3s]')}>
        {Array.from({ length: pin.length ?? Math.max(4, value.length) }).map((_, i) => (
          <span key={i} className={cx('h-3.5 w-3.5 rounded-full border-2 border-gold', i < value.length && 'bg-gold')} />
        ))}
      </div>
      {error && <p className="text-sm text-gold">رمز غير صحيح</p>}
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) =>
          d === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              disabled={waiting}
              onClick={() => (d === '⌫' ? setValue((v) => v.slice(0, -1)) : press(d))}
              className="num h-16 rounded-2xl bg-white/10 text-2xl font-semibold transition active:scale-95 active:bg-white/20 disabled:opacity-40"
            >
              {d}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
