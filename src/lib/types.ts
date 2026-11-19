// نموذج البيانات — كل المبالغ أعداد صحيحة بأصغر وحدة للعملة (سنت/أغورة/فلس)
// النسب بنقاط الأساس (2% = 200)، وأسعار الصرف × 1,000,000

export type CurrencyCode = string; // ILS / USD / USDT / JOD / EUR ... قابلة للإضافة

export interface Currency {
  code: CurrencyCode;
  name: string;
  symbol: string;
  decimals: number; // عدد الخانات العشرية (JOD = 3 فلس)
  active: boolean;
  order: number;
}

/** الزبون — محور العمل: كم بعث لي، كم حوّلت له، وكم بقي له. */
export interface Customer {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  commissionBp?: number | null; // نسبة العمولة الافتراضية لهذا الزبون (null = الافتراضي العام)
  createdAt: string;
  updatedAt: string;
}

/** طريقة استلام أو تحويل (USDT، بنك، نقدي، ويسترن…) — قائمة حرة يعدّلها المستخدم. */
export interface Method {
  id: string;
  name: string;
  use: 'in' | 'out' | 'both';
  active: boolean;
  order: number;
}

export type RecordStatus = 'active' | 'cancelled';
export type CommissionMode = 'percent' | 'fixed';

/** عملية استلام: الزبون بعث لي مبلغاً، أخصم عمولتي، والباقي مستحق له. */
export interface Operation {
  id: string;
  date: string; // ISO
  customerId: string;
  customerName: string; // نسخة للبحث والعرض
  method: string; // طريقة الاستلام
  reference?: string; // رقم مرجعي اختياري (hash، رقم حوالة…)
  amount: number; // المبلغ المستلم
  currency: CurrencyCode;
  commissionMode: CommissionMode;
  commissionBp?: number; // عند النسبة
  commission: number; // ربحي (بعملة الاستلام)
  due: number; // المستحق للزبون = amount − commission
  notes?: string;
  status: RecordStatus;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** دفعة: ما حوّلته للزبون. تُخصم من رصيده (settled) بعملة الرصيد. */
export interface Payment {
  id: string;
  date: string;
  customerId: string;
  customerName: string;
  operationId?: string; // إن كانت جزءاً من عملية
  currency: CurrencyCode; // عملة رصيد الزبون التي تُسدَّد
  settled: number; // المخصوم من رصيد الزبون
  payoutCurrency: CurrencyCode; // العملة التي حوّلت بها فعلياً
  payoutAmount: number; // المبلغ الذي خرج مني
  rate?: number; // سعر الصرف × 1e6 (عند اختلاف العملة)
  marketRate?: number; // سعر السوق × 1e6 (اختياري، لحساب ربح فرق السعر)
  fxProfit?: number; // ربح فرق السعر بعملة التحويل
  method: string; // طريقة التحويل
  reference?: string;
  notes?: string;
  status: RecordStatus;
  cancelledAt?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
}

export type MovementType = 'deposit' | 'withdraw' | 'exchange_out' | 'exchange_in' | 'adjust';

/** حركة صندوق يدوية. (الاستلامات والدفعات تُحسب تلقائياً من العمليات.) */
export interface CashMovement {
  id: string;
  date: string;
  type: MovementType;
  currency: CurrencyCode;
  amount: number; // موجب = دخول، سالب = خروج
  groupId?: string;
  note?: string;
  createdAt: string;
}

export interface CashCount {
  id: string;
  date: string;
  currency: CurrencyCode;
  expected: number;
  actual: number;
  diff: number;
  note?: string;
  adjusted: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  entity: 'operation' | 'payment' | 'customer' | 'cash' | 'settings' | 'backup' | 'transfer';
  entityId?: string;
  action: string;
  details?: string;
}

export interface Setting {
  key: string;
  value: unknown;
}

// ───────── نموذج الإصدار 1 (للترحيل فقط) ─────────
export interface LegacyTransfer {
  id: string;
  date: string;
  referenceNo: string;
  provider: string;
  senderName: string;
  recipientName: string;
  recipientPhone?: string;
  amount: number;
  currency: CurrencyCode;
  commission: number;
  netPaid: number;
  payoutCurrency?: CurrencyCode;
  payoutRate?: number;
  marketRate?: number;
  payoutAmount?: number;
  fxProfit?: number;
  status: 'pending' | 'paid' | 'cancelled';
  paidAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
