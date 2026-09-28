// Semua interface di sini adalah cermin manual dari model Pydantic di backend.
// Ubah model Python -> ubah interface ini di edit yang sama.

export type Role = "admin" | "kasir";
export type PaymentMethod = "TUNAI" | "QRIS" | "TRANSFER" | "DEBIT";
export type TxType = "SALE" | "TUKAR";
export type TransferStatus = "MENUNGGU" | "DISETUJUI" | "DITOLAK";
export type ExpenseCategory = "RESTOK" | "OPERASIONAL" | "GAJI" | "LAINNYA";

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: Role;
  branch_id: string | null;
  branch_name: string | null;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string;
  created_at: string;
}

export interface Article {
  id: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  barcode: string;
  cost_price: number | null; // null untuk kasir — modal disembunyikan
  image_url: string;
  is_active: boolean;
  created_at: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface SizeStock {
  id: string;
  size: string;
  qty: number;
  selling_price: number;
}

export interface StockRow {
  article_id: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  image_url: string;
  cost_price: number | null;
  sizes: SizeStock[];
}

export interface StockAddResult {
  ok: boolean;
  stock_id: string;
  qty: number;
  merged: boolean;
}

export interface TxItem {
  id: string;
  article_id: string;
  article_code: string;
  article_name: string;
  size: string;
  qty: number;
  price: number;
  cost: number;
  line_revenue: number;
  discount_alloc: number;
  line_cost: number;
  new_size: string | null;
  new_price: number | null;
  exchanged_qty: number; // total pasang yang sudah ditukar dari baris ini
  from_exchange: boolean; // baris hasil tukar (pengganti artikel/ukuran lama)
  new_article_id: string | null;
  new_article_code: string | null;
  new_article_name: string | null;
}

export interface Transaction {
  id: string;
  receipt_no: string;
  branch_id: string;
  branch_name: string;
  type: TxType;
  cashier_id: string;
  cashier_name: string;
  items: TxItem[];
  subtotal: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod;
  paid: number;
  change: number;
  customer_phone: string;
  note: string;
  wa_sent: boolean;
  wa_status: string | null;
  created_at: string;
}

export interface TransferItem {
  article_id: string;
  article_code: string;
  article_name: string;
  size: string;
  qty: number;
}

export interface Transfer {
  id: string;
  from_branch_id: string;
  from_branch_name: string;
  to_branch_id: string;
  to_branch_name: string;
  items: TransferItem[];
  note: string;
  status: TransferStatus;
  created_by_name: string;
  created_at: string;
  decided_by_name: string | null;
  decided_at: string | null;
  reject_reason: string;
}

export interface OpnameItem {
  article_id: string;
  article_code: string;
  article_name: string;
  size: string;
  system_qty: number;
  counted_qty: number;
  diff: number;
}

export interface Opname {
  id: string;
  branch_id: string;
  branch_name: string;
  items: OpnameItem[];
  note: string;
  created_by_name: string;
  created_at: string;
}

export interface CashMovement {
  id: string;
  type: "IN" | "OUT";
  amount: number;
  note: string;
  created_by_name: string;
  created_at: string;
}

export interface CashSession {
  id: string;
  branch_id: string;
  branch_name: string;
  status: "OPEN" | "CLOSED";
  opening_cash: number;
  opened_by_name: string;
  opened_at: string;
  closed_at: string | null;
  counted_cash: number | null;
  difference: number | null;
  closed_by_name: string | null;
  movements: CashMovement[];
  cash_sales: number;
  movement_in: number;
  movement_out: number;
  expected_cash: number;
}

export interface ActiveCash {
  session: CashSession | null;
}

export interface Expense {
  id: string;
  branch_id: string;
  branch_name: string;
  category: ExpenseCategory;
  amount: number;
  note: string;
  created_by_name: string;
  created_at: string;
}

export interface DashboardToday {
  count: number;
  revenue: number;
  items: number;
  profit: number | null; // null untuk kasir
}

export interface TrendPoint {
  date: string;
  total: number;
  count: number;
}

export interface BestSeller {
  article_id: string;
  article_name: string;
  qty: number;
  revenue: number;
}

export interface LowStockItem {
  id: string;
  article_name: string;
  article_code: string;
  size: string;
  qty: number;
  selling_price: number;
}

export interface Dashboard {
  today: DashboardToday;
  trend: TrendPoint[];
  best_sellers: BestSeller[];
  low_stock: LowStockItem[];
  out_of_stock: number;
}

export interface ProfitRow {
  key: string;
  label: string;
  sublabel: string;
  qty: number;
  revenue: number;
  discount: number;
  cost: number;
  profit: number;
  expense: number;
  net_profit: number;
}

export interface GrossProfit {
  rows: ProfitRow[];
  totals: ProfitRow;
  expense_included: boolean;
}

export interface ResetResult {
  ok: boolean;
  wipe_master: boolean;
  deleted: Record<string, number>;
  message: string;
}

export interface BackupItem {
  name: string;
  size_kb: number;
  created_at: string;
}

export interface BackupList {
  dir: string;
  keep_days: number;
  items: BackupItem[];
}

export interface WaResult {
  ok: boolean;
  to: string;
  sid: string;
  status: string;
}

export interface OkResult {
  ok: boolean;
}
