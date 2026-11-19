/** @type {import('tailwindcss').Config} */
// الألوان معرّفة كمتغيرات CSS في src/index.css (مكان واحد للتعديل)
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class'],
  theme: {
    extend: {
      colors: {
        primary: v('primary'),
        'primary-2': v('primary-2'),
        gold: v('gold'),
        'gold-ink': v('gold-ink'),
        income: v('income'),
        paper: v('paper'),
        card: v('card'),
        'card-border': v('card-border'),
        ink: v('ink'),
        muted: v('muted'),
        'pending-bg': v('pending-bg'),
        'pending-ink': v('pending-ink'),
        paid: v('paid'),
        cancelled: v('cancelled'),
        danger: v('danger'),
        'on-primary': v('on-primary'),
      },
      fontFamily: { sans: ['Cairo', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
