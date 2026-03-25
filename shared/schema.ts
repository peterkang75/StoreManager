import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, date, integer, timestamp, real, uniqueIndex, jsonb, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const stores = pgTable("stores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  address: text("address"),
  active: boolean("active").default(true).notNull(),
  isExternal: boolean("is_external").default(false).notNull(),
  globalPayrollNote: text("global_payroll_note"),
  openTime: text("open_time").default("06:00").notNull(),
  closeTime: text("close_time").default("22:00").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertStoreSchema = createInsertSchema(stores).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertStore = z.infer<typeof insertStoreSchema>;
export type Store = typeof stores.$inferSelect;

export const candidates = pgTable("candidates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  dob: text("dob"),
  gender: text("gender"),
  nationality: text("nationality"),
  experience: text("experience"),
  availability: text("availability"),
  desiredRate: text("desired_rate"),
  visaType: text("visa_type"),
  visaExpiry: text("visa_expiry"),
  interviewNotes: text("interview_notes"),
  hireDecision: text("hire_decision").default("PENDING").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCandidateSchema = createInsertSchema(candidates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCandidate = z.infer<typeof insertCandidateSchema>;
export type Candidate = typeof candidates.$inferSelect;

export const employees = pgTable("employees", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  nickname: text("nickname"),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  streetAddress: text("street_address"),
  streetAddress2: text("street_address2"),
  suburb: text("suburb"),
  state: text("state"),
  postCode: text("post_code"),
  dob: text("dob"),
  gender: text("gender"),
  maritalStatus: text("marital_status"),
  visaType: text("visa_type"),
  visaSubclass: text("visa_subclass"),
  visaExpiry: text("visa_expiry"),
  workEntitlements: text("work_entitlements"),
  passportNo: text("passport_no"),
  nationality: text("nationality"),
  lastVevoCheckDate: text("last_vevo_check_date"),
  vevoUrl: text("vevo_url"),
  vevoVerifiedAt: text("vevo_verified_at"),
  vevoVerifiedBy: text("vevo_verified_by"),
  lineId: text("line_id"),
  typeOfContact: text("type_of_contact"),
  rate: text("rate"),
  contractPosition: text("contract_position"),
  fhc: text("fhc"),
  selfieUrl: text("selfie_url"),
  passportUrl: text("passport_url"),
  salaryType: text("salary_type"),
  annualLeave: text("annual_leave"),
  storeId: varchar("store_id").references(() => stores.id),
  fixedAmount: text("fixed_amount"),
  tfn: text("tfn"),
  bsb: text("bsb"),
  accountNo: text("account_no"),
  superCompany: text("super_company"),
  superMembershipNo: text("super_membership_no"),
  persistentMemo: text("persistent_memo"),
  status: text("status").default("ACTIVE").notNull(),
  pin: text("pin"),
  role: text("role").default("EMPLOYEE").notNull(),
  canSubmitCloseForm: boolean("can_submit_close_form").default(false).notNull(),
  canManageSchedule: boolean("can_manage_schedule").default(false).notNull(),
  canApproveTimesheet: boolean("can_approve_timesheet").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEmployeeSchema = createInsertSchema(employees).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employees.$inferSelect;

export const employeeStoreAssignments = pgTable("employee_store_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  rate: text("rate"),
  fixedAmount: text("fixed_amount"),
  isFixedSalary: boolean("is_fixed_salary").default(false).notNull(),
  salaryDistribute: text("salary_distribute"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmployeeStoreAssignmentSchema = createInsertSchema(employeeStoreAssignments).omit({
  id: true,
  createdAt: true,
});

export type InsertEmployeeStoreAssignment = z.infer<typeof insertEmployeeStoreAssignmentSchema>;
export type EmployeeStoreAssignment = typeof employeeStoreAssignments.$inferSelect;

export const employeeOnboardingTokens = pgTable("employee_onboarding_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  candidateId: varchar("candidate_id").references(() => candidates.id).notNull(),
  employeeId: varchar("employee_id").references(() => employees.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOnboardingTokenSchema = createInsertSchema(employeeOnboardingTokens).omit({
  id: true,
  createdAt: true,
});

export type InsertOnboardingToken = z.infer<typeof insertOnboardingTokenSchema>;
export type OnboardingToken = typeof employeeOnboardingTokens.$inferSelect;

export const employeeDocuments = pgTable("employee_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  docType: text("doc_type").notNull(),
  filePath: text("file_path").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmployeeDocumentSchema = createInsertSchema(employeeDocuments).omit({
  id: true,
  createdAt: true,
});

export type InsertEmployeeDocument = z.infer<typeof insertEmployeeDocumentSchema>;
export type EmployeeDocument = typeof employeeDocuments.$inferSelect;

export const rosterPeriods = pgTable("roster_periods", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRosterPeriodSchema = createInsertSchema(rosterPeriods).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRosterPeriod = z.infer<typeof insertRosterPeriodSchema>;
export type RosterPeriod = typeof rosterPeriods.$inferSelect;

export const shifts = pgTable("shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  rosterPeriodId: varchar("roster_period_id").references(() => rosterPeriods.id).notNull(),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  role: text("role"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertShiftSchema = createInsertSchema(shifts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shifts.$inferSelect;

// Simple flat roster table for the Weekly Grid Roster Builder
export const rosters = pgTable("rosters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRosterSchema = createInsertSchema(rosters).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRoster = z.infer<typeof insertRosterSchema>;
export type Roster = typeof rosters.$inferSelect;

// Tracks which store+week combinations have been published to employees
export const rosterPublications = pgTable("roster_publications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  weekStart: text("week_start").notNull(),
  publishedAt: timestamp("published_at").defaultNow().notNull(),
});

export type RosterPublication = typeof rosterPublications.$inferSelect;

export const timeLogs = pgTable("time_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  shiftId: varchar("shift_id").references(() => shifts.id),
  clockIn: timestamp("clock_in").notNull(),
  clockOut: timestamp("clock_out"),
  source: text("source").default("MANUAL").notNull(),
  adjustmentReason: text("adjustment_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTimeLogSchema = createInsertSchema(timeLogs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTimeLog = z.infer<typeof insertTimeLogSchema>;
export type TimeLog = typeof timeLogs.$inferSelect;

export const timesheets = pgTable("timesheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  storeId: varchar("store_id").references(() => stores.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  totalHours: real("total_hours").default(0).notNull(),
  status: text("status").default("PENDING").notNull(),
  managerId: varchar("manager_id"),
  approvedAt: timestamp("approved_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertTimesheetSchema = createInsertSchema(timesheets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertTimesheet = z.infer<typeof insertTimesheetSchema>;
export type Timesheet = typeof timesheets.$inferSelect;

export const payrolls = pgTable("payrolls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  storeId: varchar("store_id").references(() => stores.id),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  hours: real("hours").default(0).notNull(),
  rate: real("rate").default(0).notNull(),
  fixedAmount: real("fixed_amount").default(0).notNull(),
  calculatedAmount: real("calculated_amount").default(0).notNull(),
  adjustment: real("adjustment").default(0).notNull(),
  adjustmentReason: text("adjustment_reason"),
  totalWithAdjustment: real("total_with_adjustment").default(0).notNull(),
  cashAmount: real("cash_amount").default(0).notNull(),
  bankDepositAmount: real("bank_deposit_amount").default(0).notNull(),
  taxAmount: real("tax_amount").default(0).notNull(),
  grossAmount: real("gross_amount").default(0).notNull(),
  superAmount: real("super_amount").default(0).notNull(),
  memo: text("memo"),
  isBankTransferDone: boolean("is_bank_transfer_done").default(false).notNull(),
  bankTransferDate: text("bank_transfer_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertPayrollSchema = createInsertSchema(payrolls).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payrolls.$inferSelect;

export const dailyClosings = pgTable("daily_closings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  date: text("date").notNull(),
  staffNames: text("staff_names"),
  previousFloat: real("previous_float").default(0).notNull(),
  salesTotal: real("sales_total").default(0).notNull(),
  cashSales: real("cash_sales").default(0).notNull(),
  cashOut: real("cash_out").default(0).notNull(),
  nextFloat: real("next_float").default(0).notNull(),
  actualCashCounted: real("actual_cash_counted").default(0).notNull(),
  differenceAmount: real("difference_amount").default(0).notNull(),
  creditAmount: real("credit_amount").default(0).notNull(),
  ubereatsAmount: real("ubereats_amount").default(0).notNull(),
  doordashAmount: real("doordash_amount").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDailyClosingSchema = createInsertSchema(dailyClosings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDailyClosing = z.infer<typeof insertDailyClosingSchema>;
export type DailyClosing = typeof dailyClosings.$inferSelect;

export const cashSalesDetails = pgTable("cash_sales_details", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  date: text("date").notNull(),
  envelopeAmount: real("envelope_amount").default(0).notNull(),
  countedAmount: real("counted_amount").default(0).notNull(),
  note100Count: integer("note_100_count").default(0).notNull(),
  note50Count: integer("note_50_count").default(0).notNull(),
  note20Count: integer("note_20_count").default(0).notNull(),
  note10Count: integer("note_10_count").default(0).notNull(),
  note5Count: integer("note_5_count").default(0).notNull(),
  coin2Count: integer("coin_2_count").default(0).notNull(),
  coin1Count: integer("coin_1_count").default(0).notNull(),
  coin050Count: integer("coin_050_count").default(0).notNull(),
  coin020Count: integer("coin_020_count").default(0).notNull(),
  coin010Count: integer("coin_010_count").default(0).notNull(),
  coin005Count: integer("coin_005_count").default(0).notNull(),
  differenceAmount: real("difference_amount").default(0).notNull(),
  memo: text("memo"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCashSalesDetailSchema = createInsertSchema(cashSalesDetails).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCashSalesDetail = z.infer<typeof insertCashSalesDetailSchema>;
export type CashSalesDetail = typeof cashSalesDetails.$inferSelect;

export const dailyCloseForms = pgTable("daily_close_forms", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  date: text("date").notNull(),
  submittedBy: varchar("submitted_by").references(() => employees.id),
  submitterName: text("submitter_name"),
  note100Count: integer("note_100_count").default(0).notNull(),
  note50Count: integer("note_50_count").default(0).notNull(),
  note20Count: integer("note_20_count").default(0).notNull(),
  note10Count: integer("note_10_count").default(0).notNull(),
  note5Count: integer("note_5_count").default(0).notNull(),
  coin2Count: integer("coin_2_count").default(0).notNull(),
  coin1Count: integer("coin_1_count").default(0).notNull(),
  coin050Count: integer("coin_050_count").default(0).notNull(),
  coin020Count: integer("coin_020_count").default(0).notNull(),
  coin010Count: integer("coin_010_count").default(0).notNull(),
  coin005Count: integer("coin_005_count").default(0).notNull(),
  numberOfReceipts: integer("number_of_receipts").default(0).notNull(),
  totalCalculated: real("total_calculated").default(0).notNull(),
  envelopeAmount: real("envelope_amount").default(0).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDailyCloseFormSchema = createInsertSchema(dailyCloseForms).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDailyCloseForm = z.infer<typeof insertDailyCloseFormSchema>;
export type DailyCloseForm = typeof dailyCloseForms.$inferSelect;

export const suppliers = pgTable("suppliers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  abn: text("abn"),
  contactName: text("contact_name"),
  contactEmails: text("contact_emails").array(),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  bsb: text("bsb"),
  accountNumber: text("account_number"),
  notes: text("notes"),
  active: boolean("active").default(true).notNull(),
  isAutoPay: boolean("is_auto_pay").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

export const supplierInvoices = pgTable("supplier_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supplierId: varchar("supplier_id").references(() => suppliers.id),  // nullable: REVIEW invoices from unknown senders have no supplierId yet
  storeId: varchar("store_id").references(() => stores.id),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date"),
  amount: real("amount").default(0).notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING | PAID | OVERDUE | QUARANTINE | REVIEW
  pdfUrl: text("pdf_url"),
  notes: text("notes"),
  // Stores extracted supplier + invoice data for REVIEW-state invoices (unknown senders)
  rawExtractedData: jsonb("raw_extracted_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // NULL supplierId values don't conflict in unique indexes (PostgreSQL treats NULLs as distinct)
  supplierInvoiceUniq: uniqueIndex("supplier_invoice_supplier_number_uniq").on(table.supplierId, table.invoiceNumber),
}));

export const insertSupplierInvoiceSchema = createInsertSchema(supplierInvoices).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSupplierInvoice = z.infer<typeof insertSupplierInvoiceSchema>;
export type SupplierInvoice = typeof supplierInvoices.$inferSelect;

export const supplierPayments = pgTable("supplier_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  supplierId: varchar("supplier_id").references(() => suppliers.id).notNull(),
  invoiceId: varchar("invoice_id").references(() => supplierInvoices.id).notNull(),
  paymentDate: text("payment_date").notNull(),
  amount: real("amount").default(0).notNull(),
  method: text("method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSupplierPaymentSchema = createInsertSchema(supplierPayments).omit({
  id: true,
  createdAt: true,
});

export type InsertSupplierPayment = z.infer<typeof insertSupplierPaymentSchema>;
export type SupplierPayment = typeof supplierPayments.$inferSelect;

// Emails from unknown senders with attachments — quarantined for manager review
export const quarantinedEmails = pgTable("quarantined_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  senderEmail: text("sender_email").notNull(),
  subject: text("subject").notNull(),
  hasAttachment: boolean("has_attachment").default(false).notNull(),
  rawPayload: text("raw_payload"), // full JSON for debugging
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertQuarantinedEmailSchema = createInsertSchema(quarantinedEmails).omit({
  id: true,
  createdAt: true,
});

export type InsertQuarantinedEmail = z.infer<typeof insertQuarantinedEmailSchema>;
export type QuarantinedEmail = typeof quarantinedEmails.$inferSelect;

// Email routing rules — manager-set ALLOW/IGNORE decisions for inbound invoice senders
export const emailRoutingRules = pgTable("email_routing_rules", {
  email: text("email").primaryKey(), // normalized lowercase sender email
  action: text("action").notNull(), // 'ALLOW' | 'IGNORE'
  supplierName: text("supplier_name"), // optional: display name from the email header
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEmailRoutingRuleSchema = createInsertSchema(emailRoutingRules).omit({
  createdAt: true,
});

export type InsertEmailRoutingRule = z.infer<typeof insertEmailRoutingRuleSchema>;
export type EmailRoutingRule = typeof emailRoutingRules.$inferSelect;

// ── AI Executive Assistant: To-Do items extracted from emails ────────────────
export const todos = pgTable("todos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  sourceEmail: varchar("source_email"),
  dueDate: timestamp("due_date"),
  status: text("status").default("TODO").notNull(), // 'TODO' | 'IN_PROGRESS' | 'DONE'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTodoSchema = createInsertSchema(todos).omit({
  id: true,
  createdAt: true,
});

export type InsertTodo = z.infer<typeof insertTodoSchema>;
export type Todo = typeof todos.$inferSelect;

export const financialTransactions = pgTable("financial_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  transactionType: text("transaction_type").notNull(),
  fromStoreId: varchar("from_store_id").references(() => stores.id),
  toStoreId: varchar("to_store_id").references(() => stores.id),
  cashAmount: real("cash_amount").default(0).notNull(),
  bankAmount: real("bank_amount").default(0).notNull(),
  referenceNote: text("reference_note"),
  category: text("category"),
  executedAt: timestamp("executed_at").defaultNow().notNull(),
  executedBy: text("executed_by"),
  isBankSettled: boolean("is_bank_settled").default(false).notNull(),
});

export const insertFinancialTransactionSchema = createInsertSchema(financialTransactions).omit({
  id: true,
  executedAt: true,
});

export type InsertFinancialTransaction = z.infer<typeof insertFinancialTransactionSchema>;
export type FinancialTransaction = typeof financialTransactions.$inferSelect;

// Per-day shift timesheet submitted by employee via portal
export const shiftTimesheets = pgTable("shift_timesheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storeId: varchar("store_id").references(() => stores.id).notNull(),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  date: text("date").notNull(),
  actualStartTime: text("actual_start_time").notNull(),
  actualEndTime: text("actual_end_time").notNull(),
  status: text("status").default("PENDING").notNull(), // PENDING | APPROVED | REJECTED
  adjustmentReason: text("adjustment_reason"),
  isUnscheduled: boolean("is_unscheduled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertShiftTimesheetSchema = createInsertSchema(shiftTimesheets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertShiftTimesheet = z.infer<typeof insertShiftTimesheetSchema>;
export type ShiftTimesheet = typeof shiftTimesheets.$inferSelect;

export const notices = pgTable("notices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  targetStoreId: varchar("target_store_id").references(() => stores.id),
  authorId: varchar("author_id"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNoticeSchema = createInsertSchema(notices).omit({
  id: true,
  createdAt: true,
});

export type InsertNotice = z.infer<typeof insertNoticeSchema>;
export type Notice = typeof notices.$inferSelect;

// ─── Intercompany Settlements ──────────────────────────────────────────────
// Tracks cost-sharing obligations when a fixed-salary employee works across
// multiple stores. The "to" store paid the employee; the "from" store owes.
export const intercompanySettlements = pgTable("intercompany_settlements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  payrollId: varchar("payroll_id").references(() => payrolls.id).notNull(),
  employeeId: varchar("employee_id").references(() => employees.id).notNull(),
  fromStoreId: varchar("from_store_id").references(() => stores.id).notNull(),
  toStoreId: varchar("to_store_id").references(() => stores.id).notNull(),
  totalAmountDue: real("total_amount_due").default(0).notNull(),
  paidInCash: real("paid_in_cash").default(0).notNull(),
  paidInBank: real("paid_in_bank").default(0).notNull(),
  status: varchar("status", { length: 20 }).default("PENDING").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  settledAt: timestamp("settled_at"),
});

export const insertIntercompanySettlementSchema = createInsertSchema(intercompanySettlements).omit({
  id: true,
  createdAt: true,
  settledAt: true,
});

export type InsertIntercompanySettlement = z.infer<typeof insertIntercompanySettlementSchema>;
export type IntercompanySettlement = typeof intercompanySettlements.$inferSelect;

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ── Role-Based Access Control ─────────────────────────────────────────────────
// Roles: ADMIN | MANAGER | STAFF
export const adminPermissions = pgTable("admin_permissions", {
  role: varchar("role", { length: 20 }).notNull(),
  route: varchar("route", { length: 200 }).notNull(),
  label: text("label").notNull(),
  allowed: boolean("allowed").notNull().default(false),
}, (table) => ({
  pk: primaryKey({ columns: [table.role, table.route] }),
}));

export type AdminPermission = typeof adminPermissions.$inferSelect;
export type InsertAdminPermission = typeof adminPermissions.$inferInsert;
