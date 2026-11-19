import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db/db';

/** كل السجل المالي (العمليات، الدفعات، الحركات) — حجم مناسب لعمل شخصي. */
export function useLedger() {
  const ops = useLiveQuery(() => db.operations.orderBy('date').reverse().toArray(), []);
  const payments = useLiveQuery(() => db.payments.orderBy('date').reverse().toArray(), []);
  const movements = useLiveQuery(() => db.movements.orderBy('date').reverse().toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const ready = !!ops && !!payments && !!movements && !!customers;
  return { ready, ops: ops ?? [], payments: payments ?? [], movements: movements ?? [], customers: customers ?? [] };
}
