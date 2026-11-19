import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
// خط Cairo مضمَّن في التطبيق (يعمل دون إنترنت)
import '@fontsource/cairo/arabic-400.css';
import '@fontsource/cairo/arabic-600.css';
import '@fontsource/cairo/arabic-700.css';
import '@fontsource/cairo/arabic-500.css';
import '@fontsource/cairo/latin-400.css';
import '@fontsource/cairo/latin-600.css';
import '@fontsource/cairo/latin-700.css';
import '@fontsource/cairo/latin-500.css';
import App from './App';
import { seedIfEmpty } from './db/db';
import { applyTheme } from './theme';
import './index.css';

applyTheme();

// اطلب من المتصفح عدم حذف البيانات تلقائياً عند امتلاء التخزين
if (navigator.storage?.persist) {
  navigator.storage.persisted().then((p) => (p ? null : navigator.storage.persist())).catch(() => {});
}

// Service Worker: يعمل التطبيق بالكامل دون اتصال بعد أول تحميل
registerSW({ immediate: true });

seedIfEmpty()
  .catch((e) => console.error('seed failed', e))
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
