// الوضع الداكن: يتبع الجهاز تلقائياً مع إمكانية التبديل اليدوي (يُحفظ على هذا الجهاز)
import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'sarraf-theme';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* تخزين غير متاح */
  }
  return 'system';
}

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(pref: ThemePref = read()) {
  const dark = pref === 'dark' || (pref === 'system' && mq().matches);
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#103A2C' : '#14503B');
  return dark;
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  const [dark, setDark] = useState(() => applyTheme(pref));
  useEffect(() => {
    setDark(applyTheme(pref));
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      /* تجاهل */
    }
    const m = mq();
    const on = () => setDark(applyTheme(pref));
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [pref]);
  return { pref, setPref, dark, toggle: () => setPref(dark ? 'light' : 'dark') };
}
