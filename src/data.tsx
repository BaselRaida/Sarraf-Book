import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';
import { formatMoney } from './lib/money';
import type { Currency, Method } from './lib/types';

interface AppData {
  ready: boolean;
  currencies: Currency[];
  activeCurrencies: Currency[];
  methods: Method[];
  inMethods: Method[]; // طرق الاستلام المفعّلة
  outMethods: Method[]; // طرق التحويل المفعّلة
  defaultCommissionBp: number;
  cur: (code: string) => Currency;
  fmt: (minor: number, code: string, withSymbol?: boolean) => string;
}

const Ctx = createContext<AppData | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const currencies = useLiveQuery(() => db.currencies.orderBy('order').toArray(), []);
  const methods = useLiveQuery(() => db.methods.orderBy('order').toArray(), []);
  const defBp = useLiveQuery(async () => ((await db.settings.get('defaultCommissionBp'))?.value as number | undefined) ?? 100, []);

  const value = useMemo<AppData>(() => {
    const list = currencies ?? [];
    const map = new Map(list.map((c) => [c.code, c]));
    const cur = (code: string): Currency => map.get(code) ?? { code, name: code, symbol: code, decimals: 2, active: true, order: 99 };
    const m = (methods ?? []).filter((x) => x.active);
    return {
      ready: !!currencies && !!methods && defBp !== undefined,
      currencies: list,
      activeCurrencies: list.filter((c) => c.active),
      methods: methods ?? [],
      inMethods: m.filter((x) => x.use !== 'out'),
      outMethods: m.filter((x) => x.use !== 'in'),
      defaultCommissionBp: defBp ?? 100,
      cur,
      fmt: (minor, code, withSymbol = true) => {
        const c = cur(code);
        const s = formatMoney(minor, c.decimals);
        return withSymbol ? `${s} ${c.symbol}` : s;
      },
    };
  }, [currencies, methods, defBp]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useData outside provider');
  return v;
}
