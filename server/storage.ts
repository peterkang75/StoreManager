import { 
  type Store, type InsertStore,
  type Candidate, type InsertCandidate,
  type Employee, type InsertEmployee,
  type EmployeeStoreAssignment, type InsertEmployeeStoreAssignment,
  type OnboardingToken, type InsertOnboardingToken,
  type EmployeeDocument, type InsertEmployeeDocument,
  type RosterPeriod, type InsertRosterPeriod,
  type Shift, type InsertShift,
  type TimeLog, type InsertTimeLog,
  type Timesheet, type InsertTimesheet,
  type Payroll, type InsertPayroll,
  type DailyClosing, type InsertDailyClosing,
  type CashSalesDetail, type InsertCashSalesDetail,
  type DailyCloseForm, type InsertDailyCloseForm,
  type Supplier, type InsertSupplier,
  type SupplierInvoice, type InsertSupplierInvoice,
  type SupplierPayment, type InsertSupplierPayment,
  type QuarantinedEmail, type InsertQuarantinedEmail,
  type EmailRoutingRule, type InsertEmailRoutingRule,
  type Todo, type InsertTodo,
  type FinancialTransaction, type InsertFinancialTransaction,
  type Roster, type InsertRoster,
  type RosterPublication,
  type ShiftTimesheet, type InsertShiftTimesheet,
  type Notice, type InsertNotice,
  type IntercompanySettlement, type InsertIntercompanySettlement,
  type AdminPermission, type InsertAdminPermission,
  stores, candidates, employees, employeeStoreAssignments, employeeOnboardingTokens, employeeDocuments,
  rosterPeriods, shifts, rosters, rosterPublications, timeLogs, timesheets, payrolls,
  dailyClosings, cashSalesDetails, dailyCloseForms, suppliers, supplierInvoices, supplierPayments,
  quarantinedEmails, emailRoutingRules,
  todos,
  financialTransactions, shiftTimesheets, notices, intercompanySettlements, adminPermissions,
} from "@shared/schema";
import { randomUUID, randomBytes } from "crypto";
import { db } from "./db";
import { eq, desc, and, gte, lte, or, ilike, isNull, asc, sql } from "drizzle-orm";

export interface IStorage {
  getStores(): Promise<Store[]>;
  getStore(id: string): Promise<Store | undefined>;
  createStore(store: InsertStore): Promise<Store>;
  updateStore(id: string, store: Partial<InsertStore>): Promise<Store | undefined>;

  getCandidates(): Promise<Candidate[]>;
  getCandidate(id: string): Promise<Candidate | undefined>;
  createCandidate(candidate: InsertCandidate): Promise<Candidate>;
  updateCandidate(id: string, candidate: Partial<InsertCandidate>): Promise<Candidate | undefined>;

  getEmployees(filters?: { storeId?: string; status?: string; keyword?: string }): Promise<Employee[]>;
  getEmployee(id: string): Promise<Employee | undefined>;
  getEmployeeByPin(pin: string): Promise<Employee | undefined>;
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, employee: Partial<InsertEmployee>): Promise<Employee | undefined>;

  getEmployeeStoreAssignments(filters?: { employeeId?: string; storeId?: string }): Promise<EmployeeStoreAssignment[]>;
  createEmployeeStoreAssignment(assignment: InsertEmployeeStoreAssignment): Promise<EmployeeStoreAssignment>;
  deleteEmployeeStoreAssignments(employeeId: string): Promise<void>;
  updateStoreAssignmentFields(id: string, fields: { rate?: string; fixedAmount?: string }): Promise<void>;
  getEmployeesByStoreAssignment(storeId: string, status?: string): Promise<{ employee: Employee; assignment: EmployeeStoreAssignment }[]>;

  createOnboardingToken(token: InsertOnboardingToken): Promise<OnboardingToken>;
  getOnboardingToken(token: string): Promise<OnboardingToken | undefined>;
  markOnboardingTokenUsed(token: string, employeeId: string): Promise<OnboardingToken | undefined>;

  createEmployeeDocument(doc: InsertEmployeeDocument): Promise<EmployeeDocument>;
  getEmployeeDocuments(employeeId: string): Promise<EmployeeDocument[]>;

  getRosterPeriods(filters?: { storeId?: string }): Promise<RosterPeriod[]>;
  getRosterPeriod(id: string): Promise<RosterPeriod | undefined>;
  createRosterPeriod(period: InsertRosterPeriod): Promise<RosterPeriod>;
  updateRosterPeriod(id: string, period: Partial<InsertRosterPeriod>): Promise<RosterPeriod | undefined>;

  getShifts(filters?: { storeId?: string; periodId?: string; employeeId?: string; startDate?: string; endDate?: string }): Promise<Shift[]>;
  getShift(id: string): Promise<Shift | undefined>;
  createShift(shift: InsertShift): Promise<Shift>;
  updateShift(id: string, shift: Partial<InsertShift>): Promise<Shift | undefined>;
  deleteShift(id: string): Promise<boolean>;

  getTimeLogs(filters?: { employeeId?: string; storeId?: string; startDate?: string; endDate?: string }): Promise<TimeLog[]>;
  getTimeLog(id: string): Promise<TimeLog | undefined>;
  createTimeLog(log: InsertTimeLog): Promise<TimeLog>;
  updateTimeLog(id: string, log: Partial<InsertTimeLog>): Promise<TimeLog | undefined>;
  getOpenTimeLog(employeeId: string, storeId: string): Promise<TimeLog | undefined>;

  getTimesheets(filters?: { status?: string; storeId?: string; periodStart?: string; periodEnd?: string }): Promise<Timesheet[]>;
  getTimesheet(id: string): Promise<Timesheet | undefined>;
  createTimesheet(sheet: InsertTimesheet): Promise<Timesheet>;
  updateTimesheet(id: string, sheet: Partial<InsertTimesheet>): Promise<Timesheet | undefined>;

  getPayrolls(filters?: { employeeId?: string; periodStart?: string; periodEnd?: string }): Promise<Payroll[]>;
  getPayroll(id: string): Promise<Payroll | undefined>;
  createPayroll(payroll: InsertPayroll): Promise<Payroll>;
  updatePayroll(id: string, payroll: Partial<InsertPayroll>): Promise<Payroll | undefined>;

  getDailyClosings(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<DailyClosing[]>;
  getDailyClosing(id: string): Promise<DailyClosing | undefined>;
  createDailyClosing(closing: InsertDailyClosing): Promise<DailyClosing>;
  updateDailyClosing(id: string, closing: Partial<InsertDailyClosing>): Promise<DailyClosing | undefined>;

  getCashSalesDetails(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<CashSalesDetail[]>;
  getCashSalesDetail(id: string): Promise<CashSalesDetail | undefined>;
  createCashSalesDetail(detail: InsertCashSalesDetail): Promise<CashSalesDetail>;
  updateCashSalesDetail(id: string, detail: Partial<InsertCashSalesDetail>): Promise<CashSalesDetail | undefined>;

  getSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(supplier: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: string, supplier: Partial<InsertSupplier>): Promise<Supplier | undefined>;

  getSupplierInvoices(filters?: { supplierId?: string; storeId?: string; status?: string; startDate?: string; endDate?: string }): Promise<SupplierInvoice[]>;
  getSupplierInvoice(id: string): Promise<SupplierInvoice | undefined>;
  createSupplierInvoice(invoice: InsertSupplierInvoice): Promise<SupplierInvoice>;
  updateSupplierInvoice(id: string, invoice: Partial<InsertSupplierInvoice>): Promise<SupplierInvoice | undefined>;

  getSupplierPayments(filters?: { supplierId?: string; invoiceId?: string; startDate?: string; endDate?: string }): Promise<SupplierPayment[]>;
  getSupplierPayment(id: string): Promise<SupplierPayment | undefined>;
  createSupplierPayment(payment: InsertSupplierPayment): Promise<SupplierPayment>;
  deleteSupplierPaymentsByInvoiceId(invoiceId: string): Promise<void>;

  findSupplierByEmail(email: string): Promise<Supplier | undefined>;
  findSupplierByName(name: string): Promise<Supplier | undefined>;
  sweepReviewInvoicesBySupplierName(supplierName: string, supplierId: string): Promise<number>;
  getQuarantinedEmails(): Promise<QuarantinedEmail[]>;
  createQuarantinedEmail(email: InsertQuarantinedEmail): Promise<QuarantinedEmail>;

  getEmailRoutingRules(): Promise<EmailRoutingRule[]>;
  getEmailRoutingRule(email: string): Promise<EmailRoutingRule | undefined>;
  upsertEmailRoutingRule(data: InsertEmailRoutingRule): Promise<EmailRoutingRule>;
  deleteEmailRoutingRule(email: string): Promise<boolean>;

  getTodos(): Promise<Todo[]>;
  getTodo(id: string): Promise<Todo | undefined>;
  createTodo(data: InsertTodo): Promise<Todo>;
  updateTodo(id: string, data: Partial<InsertTodo>): Promise<Todo | undefined>;

  getNotices(filters?: { storeId?: string; activeOnly?: boolean }): Promise<Notice[]>;
  getNotice(id: string): Promise<Notice | undefined>;
  createNotice(data: InsertNotice): Promise<Notice>;
  updateNotice(id: string, data: Partial<InsertNotice>): Promise<Notice | undefined>;
  deleteNotice(id: string): Promise<boolean>;

  getFinancialTransactions(limit?: number): Promise<FinancialTransaction[]>;
  createFinancialTransaction(tx: InsertFinancialTransaction): Promise<FinancialTransaction>;
  deleteFinancialTransaction(id: string): Promise<boolean>;
  settleFinancialTransaction(id: string): Promise<boolean>;
  createFinancialTransactionWithDate(tx: InsertFinancialTransaction, executedAt: Date): Promise<FinancialTransaction>;
  deleteCashSalesDetailsByStoreAndDateRange(storeId: string, startDate: string, endDate: string): Promise<number>;
  getFinancialTransactionsByRef(refNote: string): Promise<FinancialTransaction[]>;
  upsertFinancialTransactionByRef(refNote: string, data: InsertFinancialTransaction): Promise<FinancialTransaction>;

  getDailyCloseForms(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<DailyCloseForm[]>;
  upsertDailyCloseForm(storeId: string, date: string, data: InsertDailyCloseForm): Promise<DailyCloseForm>;
  deleteDailyCloseFormByStoreAndDate(storeId: string, date: string): Promise<number>;

  getRosters(filters?: { storeId?: string; startDate?: string; endDate?: string; employeeId?: string }): Promise<Roster[]>;
  getRoster(id: string): Promise<Roster | undefined>;
  upsertRoster(storeId: string, employeeId: string, date: string, data: Omit<InsertRoster, "storeId" | "employeeId" | "date">): Promise<Roster>;
  deleteRoster(id: string): Promise<boolean>;
  deleteRostersByStoreAndDateRange(storeId: string, startDate: string, endDate: string): Promise<number>;
  getRostersByEmployeeAndDateRange(employeeId: string, startDate: string, endDate: string): Promise<Roster[]>;
  isRosterWeekPublished(storeId: string, weekStart: string): Promise<boolean>;
  toggleRosterWeekPublished(storeId: string, weekStart: string): Promise<boolean>;

  getShiftTimesheet(employeeId: string, date: string): Promise<ShiftTimesheet | undefined>;
  createShiftTimesheet(data: InsertShiftTimesheet): Promise<ShiftTimesheet>;
  getShiftTimesheets(filters?: { storeId?: string; employeeId?: string; date?: string; startDate?: string; endDate?: string; status?: string; isUnscheduled?: boolean }): Promise<ShiftTimesheet[]>;
  updateShiftTimesheet(id: string, data: Partial<InsertShiftTimesheet>): Promise<ShiftTimesheet | undefined>;
  deleteShiftTimesheet(id: string): Promise<boolean>;

  // Intercompany Settlements
  getIntercompanySettlements(filters?: { status?: string; payrollId?: string }): Promise<IntercompanySettlement[]>;
  createIntercompanySettlement(data: InsertIntercompanySettlement): Promise<IntercompanySettlement>;
  updateIntercompanySettlement(id: string, data: Partial<IntercompanySettlement>): Promise<IntercompanySettlement | undefined>;

  // RBAC Permissions
  getPermissions(): Promise<AdminPermission[]>;
  setPermissions(perms: InsertAdminPermission[]): Promise<void>;
}

export class MemStorage implements IStorage {
  private stores: Map<string, Store>;
  private candidates: Map<string, Candidate>;
  private employees: Map<string, Employee>;
  private onboardingTokens: Map<string, OnboardingToken>;
  private employeeDocuments: Map<string, EmployeeDocument>;
  private rosterPeriods: Map<string, RosterPeriod>;
  private shifts: Map<string, Shift>;
  private timeLogs: Map<string, TimeLog>;
  private timesheets: Map<string, Timesheet>;
  private payrolls: Map<string, Payroll>;
  private dailyClosings: Map<string, DailyClosing>;
  private cashSalesDetails: Map<string, CashSalesDetail>;
  private suppliers: Map<string, Supplier>;
  private supplierInvoices: Map<string, SupplierInvoice>;
  private supplierPayments: Map<string, SupplierPayment>;
  private quarantinedEmails: Map<string, QuarantinedEmail>;
  private emailRoutingRulesMap: Map<string, EmailRoutingRule>;
  private todosMap: Map<string, Todo>;
  private noticesMap: Map<string, Notice>;
  private employeeStoreAssignments: Map<string, EmployeeStoreAssignment>;
  private financialTransactions: Map<string, FinancialTransaction>;
  private rostersMap: Map<string, Roster>;

  constructor() {
    this.stores = new Map();
    this.candidates = new Map();
    this.employees = new Map();
    this.employeeStoreAssignments = new Map();
    this.onboardingTokens = new Map();
    this.employeeDocuments = new Map();
    this.rosterPeriods = new Map();
    this.shifts = new Map();
    this.timeLogs = new Map();
    this.timesheets = new Map();
    this.payrolls = new Map();
    this.dailyClosings = new Map();
    this.cashSalesDetails = new Map();
    this.suppliers = new Map();
    this.supplierInvoices = new Map();
    this.supplierPayments = new Map();
    this.quarantinedEmails = new Map();
    this.emailRoutingRulesMap = new Map();
    this.todosMap = new Map();
    this.noticesMap = new Map();
    this.financialTransactions = new Map();
    this.rostersMap = new Map();
  }

  async getStores(): Promise<Store[]> {
    return Array.from(this.stores.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getStore(id: string): Promise<Store | undefined> {
    return this.stores.get(id);
  }

  async createStore(insertStore: InsertStore): Promise<Store> {
    const id = randomUUID();
    const now = new Date();
    const store: Store = {
      id,
      name: insertStore.name,
      code: insertStore.code,
      address: insertStore.address ?? null,
      active: insertStore.active ?? true,
      isExternal: insertStore.isExternal ?? false,
      globalPayrollNote: insertStore.globalPayrollNote ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.stores.set(id, store);
    return store;
  }

  async updateStore(id: string, updates: Partial<InsertStore>): Promise<Store | undefined> {
    const store = this.stores.get(id);
    if (!store) return undefined;
    
    const updatedStore: Store = {
      ...store,
      ...updates,
      updatedAt: new Date(),
    };
    this.stores.set(id, updatedStore);
    return updatedStore;
  }

  async getCandidates(): Promise<Candidate[]> {
    return Array.from(this.candidates.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getCandidate(id: string): Promise<Candidate | undefined> {
    return this.candidates.get(id);
  }

  async createCandidate(insertCandidate: InsertCandidate): Promise<Candidate> {
    const id = randomUUID();
    const now = new Date();
    const candidate: Candidate = {
      id,
      name: insertCandidate.name,
      dob: insertCandidate.dob ?? null,
      gender: insertCandidate.gender ?? null,
      nationality: insertCandidate.nationality ?? null,
      experience: insertCandidate.experience ?? null,
      availability: insertCandidate.availability ?? null,
      desiredRate: insertCandidate.desiredRate ?? null,
      visaType: insertCandidate.visaType ?? null,
      visaExpiry: insertCandidate.visaExpiry ?? null,
      interviewNotes: insertCandidate.interviewNotes ?? null,
      hireDecision: insertCandidate.hireDecision ?? "PENDING",
      createdAt: now,
      updatedAt: now,
    };
    this.candidates.set(id, candidate);
    return candidate;
  }

  async updateCandidate(id: string, updates: Partial<InsertCandidate>): Promise<Candidate | undefined> {
    const candidate = this.candidates.get(id);
    if (!candidate) return undefined;
    
    const updatedCandidate: Candidate = {
      ...candidate,
      ...updates,
      updatedAt: new Date(),
    };
    this.candidates.set(id, updatedCandidate);
    return updatedCandidate;
  }

  async getEmployees(filters?: { storeId?: string; status?: string; keyword?: string }): Promise<Employee[]> {
    let employees = Array.from(this.employees.values());
    
    if (filters?.storeId) {
      employees = employees.filter(e => e.storeId === filters.storeId);
    }
    if (filters?.status) {
      employees = employees.filter(e => e.status === filters.status);
    }
    if (filters?.keyword) {
      const keyword = filters.keyword.toLowerCase();
      employees = employees.filter(e => 
        e.firstName.toLowerCase().includes(keyword) ||
        e.lastName.toLowerCase().includes(keyword) ||
        (e.nickname?.toLowerCase().includes(keyword) ?? false) ||
        (e.email?.toLowerCase().includes(keyword) ?? false)
      );
    }
    
    return employees.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getEmployee(id: string): Promise<Employee | undefined> {
    return this.employees.get(id);
  }

  async getEmployeeByPin(pin: string): Promise<Employee | undefined> {
    return Array.from(this.employees.values()).find(e => e.pin === pin);
  }

  async createEmployee(insertEmployee: InsertEmployee): Promise<Employee> {
    const id = randomUUID();
    const now = new Date();
    const employee: Employee = {
      id,
      nickname: insertEmployee.nickname ?? null,
      firstName: insertEmployee.firstName,
      lastName: insertEmployee.lastName,
      email: insertEmployee.email ?? null,
      phone: insertEmployee.phone ?? null,
      streetAddress: insertEmployee.streetAddress ?? null,
      streetAddress2: insertEmployee.streetAddress2 ?? null,
      suburb: insertEmployee.suburb ?? null,
      state: insertEmployee.state ?? null,
      postCode: insertEmployee.postCode ?? null,
      dob: insertEmployee.dob ?? null,
      gender: insertEmployee.gender ?? null,
      maritalStatus: insertEmployee.maritalStatus ?? null,
      visaType: insertEmployee.visaType ?? null,
      visaExpiry: insertEmployee.visaExpiry ?? null,
      lineId: insertEmployee.lineId ?? null,
      typeOfContact: insertEmployee.typeOfContact ?? null,
      rate: insertEmployee.rate ?? null,
      contractPosition: insertEmployee.contractPosition ?? null,
      fhc: insertEmployee.fhc ?? null,
      salaryType: insertEmployee.salaryType ?? null,
      annualLeave: insertEmployee.annualLeave ?? null,
      storeId: insertEmployee.storeId ?? null,
      fixedAmount: insertEmployee.fixedAmount ?? null,
      tfn: insertEmployee.tfn ?? null,
      bsb: insertEmployee.bsb ?? null,
      accountNo: insertEmployee.accountNo ?? null,
      superCompany: insertEmployee.superCompany ?? null,
      superMembershipNo: insertEmployee.superMembershipNo ?? null,
      persistentMemo: insertEmployee.persistentMemo ?? null,
      status: insertEmployee.status ?? "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    this.employees.set(id, employee);
    return employee;
  }

  async updateEmployee(id: string, updates: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const employee = this.employees.get(id);
    if (!employee) return undefined;
    
    const updatedEmployee: Employee = {
      ...employee,
      ...updates,
      updatedAt: new Date(),
    };
    this.employees.set(id, updatedEmployee);
    return updatedEmployee;
  }

  async getEmployeeStoreAssignments(filters?: { employeeId?: string; storeId?: string }): Promise<EmployeeStoreAssignment[]> {
    let results = Array.from(this.employeeStoreAssignments.values());
    if (filters?.employeeId) results = results.filter(a => a.employeeId === filters.employeeId);
    if (filters?.storeId) results = results.filter(a => a.storeId === filters.storeId);
    return results;
  }

  async createEmployeeStoreAssignment(data: InsertEmployeeStoreAssignment): Promise<EmployeeStoreAssignment> {
    const id = randomUUID();
    const assignment: EmployeeStoreAssignment = {
      id,
      employeeId: data.employeeId,
      storeId: data.storeId,
      rate: data.rate ?? null,
      fixedAmount: data.fixedAmount ?? null,
      isFixedSalary: data.isFixedSalary ?? false,
      salaryDistribute: data.salaryDistribute ?? null,
      createdAt: new Date(),
    };
    this.employeeStoreAssignments.set(id, assignment);
    return assignment;
  }

  async deleteEmployeeStoreAssignments(employeeId: string): Promise<void> {
    for (const [key, val] of this.employeeStoreAssignments) {
      if (val.employeeId === employeeId) this.employeeStoreAssignments.delete(key);
    }
  }

  async updateStoreAssignmentFields(id: string, fields: { rate?: string; fixedAmount?: string }): Promise<void> {
    const a = this.employeeStoreAssignments.get(id);
    if (a) {
      if (fields.rate !== undefined) (a as any).rate = fields.rate;
      if (fields.fixedAmount !== undefined) (a as any).fixedAmount = fields.fixedAmount;
    }
  }

  async getEmployeesByStoreAssignment(storeId: string, status?: string): Promise<{ employee: Employee; assignment: EmployeeStoreAssignment }[]> {
    const assignments = Array.from(this.employeeStoreAssignments.values()).filter(a => a.storeId === storeId);
    const results: { employee: Employee; assignment: EmployeeStoreAssignment }[] = [];
    for (const a of assignments) {
      const emp = this.employees.get(a.employeeId);
      if (emp && (!status || emp.status === status)) {
        results.push({ employee: emp, assignment: a });
      }
    }
    return results;
  }

  async createOnboardingToken(insertToken: InsertOnboardingToken): Promise<OnboardingToken> {
    const id = randomUUID();
    const token: OnboardingToken = {
      id,
      candidateId: insertToken.candidateId,
      employeeId: insertToken.employeeId ?? null,
      token: insertToken.token,
      expiresAt: insertToken.expiresAt,
      usedAt: insertToken.usedAt ?? null,
      createdAt: new Date(),
    };
    this.onboardingTokens.set(insertToken.token, token);
    return token;
  }

  async getOnboardingToken(tokenString: string): Promise<OnboardingToken | undefined> {
    return this.onboardingTokens.get(tokenString);
  }

  async markOnboardingTokenUsed(tokenString: string, employeeId: string): Promise<OnboardingToken | undefined> {
    const token = this.onboardingTokens.get(tokenString);
    if (!token) return undefined;
    
    const updatedToken: OnboardingToken = {
      ...token,
      employeeId,
      usedAt: new Date(),
    };
    this.onboardingTokens.set(tokenString, updatedToken);
    return updatedToken;
  }

  async createEmployeeDocument(insertDoc: InsertEmployeeDocument): Promise<EmployeeDocument> {
    const id = randomUUID();
    const doc: EmployeeDocument = {
      id,
      employeeId: insertDoc.employeeId,
      docType: insertDoc.docType,
      filePath: insertDoc.filePath,
      createdAt: new Date(),
    };
    this.employeeDocuments.set(id, doc);
    return doc;
  }

  async getEmployeeDocuments(employeeId: string): Promise<EmployeeDocument[]> {
    return Array.from(this.employeeDocuments.values())
      .filter(doc => doc.employeeId === employeeId);
  }

  async getRosterPeriods(filters?: { storeId?: string }): Promise<RosterPeriod[]> {
    let periods = Array.from(this.rosterPeriods.values());
    if (filters?.storeId) {
      periods = periods.filter(p => p.storeId === filters.storeId);
    }
    return periods.sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async getRosterPeriod(id: string): Promise<RosterPeriod | undefined> {
    return this.rosterPeriods.get(id);
  }

  async createRosterPeriod(insertPeriod: InsertRosterPeriod): Promise<RosterPeriod> {
    const id = randomUUID();
    const now = new Date();
    const period: RosterPeriod = {
      id,
      storeId: insertPeriod.storeId,
      startDate: insertPeriod.startDate,
      endDate: insertPeriod.endDate,
      description: insertPeriod.description ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.rosterPeriods.set(id, period);
    return period;
  }

  async updateRosterPeriod(id: string, updates: Partial<InsertRosterPeriod>): Promise<RosterPeriod | undefined> {
    const period = this.rosterPeriods.get(id);
    if (!period) return undefined;
    const updated: RosterPeriod = { ...period, ...updates, updatedAt: new Date() };
    this.rosterPeriods.set(id, updated);
    return updated;
  }

  async getShifts(filters?: { storeId?: string; periodId?: string; employeeId?: string; startDate?: string; endDate?: string }): Promise<Shift[]> {
    let shifts = Array.from(this.shifts.values());
    if (filters?.storeId) shifts = shifts.filter(s => s.storeId === filters.storeId);
    if (filters?.periodId) shifts = shifts.filter(s => s.rosterPeriodId === filters.periodId);
    if (filters?.employeeId) shifts = shifts.filter(s => s.employeeId === filters.employeeId);
    if (filters?.startDate) shifts = shifts.filter(s => s.date >= filters.startDate!);
    if (filters?.endDate) shifts = shifts.filter(s => s.date <= filters.endDate!);
    return shifts.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  }

  async getShift(id: string): Promise<Shift | undefined> {
    return this.shifts.get(id);
  }

  async createShift(insertShift: InsertShift): Promise<Shift> {
    const id = randomUUID();
    const now = new Date();
    const shift: Shift = {
      id,
      rosterPeriodId: insertShift.rosterPeriodId,
      storeId: insertShift.storeId,
      employeeId: insertShift.employeeId,
      date: insertShift.date,
      startTime: insertShift.startTime,
      endTime: insertShift.endTime,
      role: insertShift.role ?? null,
      notes: insertShift.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.shifts.set(id, shift);
    return shift;
  }

  async updateShift(id: string, updates: Partial<InsertShift>): Promise<Shift | undefined> {
    const shift = this.shifts.get(id);
    if (!shift) return undefined;
    const updated: Shift = { ...shift, ...updates, updatedAt: new Date() };
    this.shifts.set(id, updated);
    return updated;
  }

  async deleteShift(id: string): Promise<boolean> {
    return this.shifts.delete(id);
  }

  async getTimeLogs(filters?: { employeeId?: string; storeId?: string; startDate?: string; endDate?: string }): Promise<TimeLog[]> {
    let logs = Array.from(this.timeLogs.values());
    if (filters?.employeeId) logs = logs.filter(l => l.employeeId === filters.employeeId);
    if (filters?.storeId) logs = logs.filter(l => l.storeId === filters.storeId);
    if (filters?.startDate) {
      const start = new Date(filters.startDate);
      logs = logs.filter(l => l.clockIn >= start);
    }
    if (filters?.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      logs = logs.filter(l => l.clockIn <= end);
    }
    return logs.sort((a, b) => b.clockIn.getTime() - a.clockIn.getTime());
  }

  async getTimeLog(id: string): Promise<TimeLog | undefined> {
    return this.timeLogs.get(id);
  }

  async createTimeLog(insertLog: InsertTimeLog): Promise<TimeLog> {
    const id = randomUUID();
    const now = new Date();
    const log: TimeLog = {
      id,
      employeeId: insertLog.employeeId,
      storeId: insertLog.storeId,
      shiftId: insertLog.shiftId ?? null,
      clockIn: insertLog.clockIn,
      clockOut: insertLog.clockOut ?? null,
      source: insertLog.source ?? "MANUAL",
      adjustmentReason: insertLog.adjustmentReason ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.timeLogs.set(id, log);
    return log;
  }

  async updateTimeLog(id: string, updates: Partial<InsertTimeLog>): Promise<TimeLog | undefined> {
    const log = this.timeLogs.get(id);
    if (!log) return undefined;
    const updated: TimeLog = { ...log, ...updates as any, updatedAt: new Date() };
    this.timeLogs.set(id, updated);
    return updated;
  }

  async getOpenTimeLog(employeeId: string, storeId: string): Promise<TimeLog | undefined> {
    const logs = Array.from(this.timeLogs.values());
    return logs.find(l => l.employeeId === employeeId && l.storeId === storeId && !l.clockOut);
  }

  async getTimesheets(filters?: { status?: string; storeId?: string; periodStart?: string; periodEnd?: string }): Promise<Timesheet[]> {
    let sheets = Array.from(this.timesheets.values());
    if (filters?.status) sheets = sheets.filter(s => s.status === filters.status);
    if (filters?.storeId) sheets = sheets.filter(s => s.storeId === filters.storeId);
    if (filters?.periodStart) sheets = sheets.filter(s => s.periodStart >= filters.periodStart!);
    if (filters?.periodEnd) sheets = sheets.filter(s => s.periodEnd <= filters.periodEnd!);
    return sheets.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  }

  async getTimesheet(id: string): Promise<Timesheet | undefined> {
    return this.timesheets.get(id);
  }

  async createTimesheet(insertSheet: InsertTimesheet): Promise<Timesheet> {
    const id = randomUUID();
    const now = new Date();
    const sheet: Timesheet = {
      id,
      employeeId: insertSheet.employeeId,
      storeId: insertSheet.storeId ?? null,
      periodStart: insertSheet.periodStart,
      periodEnd: insertSheet.periodEnd,
      totalHours: insertSheet.totalHours ?? 0,
      status: insertSheet.status ?? "PENDING",
      managerId: insertSheet.managerId ?? null,
      approvedAt: insertSheet.approvedAt ?? null,
      notes: insertSheet.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.timesheets.set(id, sheet);
    return sheet;
  }

  async updateTimesheet(id: string, updates: Partial<InsertTimesheet>): Promise<Timesheet | undefined> {
    const sheet = this.timesheets.get(id);
    if (!sheet) return undefined;
    const updated: Timesheet = { ...sheet, ...updates as any, updatedAt: new Date() };
    this.timesheets.set(id, updated);
    return updated;
  }

  async getPayrolls(filters?: { employeeId?: string; periodStart?: string; periodEnd?: string }): Promise<Payroll[]> {
    let payrolls = Array.from(this.payrolls.values());
    if (filters?.employeeId) payrolls = payrolls.filter(p => p.employeeId === filters.employeeId);
    if (filters?.periodStart) payrolls = payrolls.filter(p => p.periodStart >= filters.periodStart!);
    if (filters?.periodEnd) payrolls = payrolls.filter(p => p.periodEnd <= filters.periodEnd!);
    return payrolls.sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  }

  async getPayroll(id: string): Promise<Payroll | undefined> {
    return this.payrolls.get(id);
  }

  async createPayroll(insertPayroll: InsertPayroll): Promise<Payroll> {
    const id = randomUUID();
    const now = new Date();
    const payroll: Payroll = {
      id,
      employeeId: insertPayroll.employeeId,
      periodStart: insertPayroll.periodStart,
      periodEnd: insertPayroll.periodEnd,
      hours: insertPayroll.hours ?? 0,
      rate: insertPayroll.rate ?? 0,
      fixedAmount: insertPayroll.fixedAmount ?? 0,
      calculatedAmount: insertPayroll.calculatedAmount ?? 0,
      adjustment: insertPayroll.adjustment ?? 0,
      adjustmentReason: insertPayroll.adjustmentReason ?? null,
      totalWithAdjustment: insertPayroll.totalWithAdjustment ?? 0,
      cashAmount: insertPayroll.cashAmount ?? 0,
      bankDepositAmount: insertPayroll.bankDepositAmount ?? 0,
      taxAmount: insertPayroll.taxAmount ?? 0,
      grossAmount: insertPayroll.grossAmount ?? 0,
      superAmount: insertPayroll.superAmount ?? 0,
      memo: insertPayroll.memo ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.payrolls.set(id, payroll);
    return payroll;
  }

  async updatePayroll(id: string, updates: Partial<InsertPayroll>): Promise<Payroll | undefined> {
    const payroll = this.payrolls.get(id);
    if (!payroll) return undefined;
    const updated: Payroll = { ...payroll, ...updates as any, updatedAt: new Date() };
    this.payrolls.set(id, updated);
    return updated;
  }

  async getDailyClosings(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<DailyClosing[]> {
    let closings = Array.from(this.dailyClosings.values());
    if (filters?.storeId) closings = closings.filter(c => c.storeId === filters.storeId);
    if (filters?.startDate) closings = closings.filter(c => c.date >= filters.startDate!);
    if (filters?.endDate) closings = closings.filter(c => c.date <= filters.endDate!);
    return closings.sort((a, b) => b.date.localeCompare(a.date));
  }

  async getDailyClosing(id: string): Promise<DailyClosing | undefined> {
    return this.dailyClosings.get(id);
  }

  async createDailyClosing(insertClosing: InsertDailyClosing): Promise<DailyClosing> {
    const id = randomUUID();
    const now = new Date();
    const closing: DailyClosing = {
      id,
      storeId: insertClosing.storeId,
      date: insertClosing.date,
      staffNames: insertClosing.staffNames ?? null,
      previousFloat: insertClosing.previousFloat ?? 0,
      salesTotal: insertClosing.salesTotal ?? 0,
      cashSales: insertClosing.cashSales ?? 0,
      cashOut: insertClosing.cashOut ?? 0,
      nextFloat: insertClosing.nextFloat ?? 0,
      actualCashCounted: insertClosing.actualCashCounted ?? 0,
      differenceAmount: insertClosing.differenceAmount ?? 0,
      creditAmount: insertClosing.creditAmount ?? 0,
      ubereatsAmount: insertClosing.ubereatsAmount ?? 0,
      doordashAmount: insertClosing.doordashAmount ?? 0,
      notes: insertClosing.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.dailyClosings.set(id, closing);
    return closing;
  }

  async updateDailyClosing(id: string, updates: Partial<InsertDailyClosing>): Promise<DailyClosing | undefined> {
    const closing = this.dailyClosings.get(id);
    if (!closing) return undefined;
    const updated: DailyClosing = { ...closing, ...updates as any, updatedAt: new Date() };
    this.dailyClosings.set(id, updated);
    return updated;
  }

  async getCashSalesDetails(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<CashSalesDetail[]> {
    let details = Array.from(this.cashSalesDetails.values());
    if (filters?.storeId) details = details.filter(d => d.storeId === filters.storeId);
    if (filters?.startDate) details = details.filter(d => d.date >= filters.startDate!);
    if (filters?.endDate) details = details.filter(d => d.date <= filters.endDate!);
    return details.sort((a, b) => b.date.localeCompare(a.date));
  }

  async getCashSalesDetail(id: string): Promise<CashSalesDetail | undefined> {
    return this.cashSalesDetails.get(id);
  }

  async createCashSalesDetail(insertDetail: InsertCashSalesDetail): Promise<CashSalesDetail> {
    const id = randomUUID();
    const now = new Date();
    const detail: CashSalesDetail = {
      id,
      storeId: insertDetail.storeId,
      date: insertDetail.date,
      envelopeAmount: insertDetail.envelopeAmount ?? 0,
      countedAmount: insertDetail.countedAmount ?? 0,
      note100Count: insertDetail.note100Count ?? 0,
      note50Count: insertDetail.note50Count ?? 0,
      note20Count: insertDetail.note20Count ?? 0,
      note10Count: insertDetail.note10Count ?? 0,
      note5Count: insertDetail.note5Count ?? 0,
      coin2Count: insertDetail.coin2Count ?? 0,
      coin1Count: insertDetail.coin1Count ?? 0,
      coin050Count: insertDetail.coin050Count ?? 0,
      coin020Count: insertDetail.coin020Count ?? 0,
      coin010Count: insertDetail.coin010Count ?? 0,
      coin005Count: insertDetail.coin005Count ?? 0,
      differenceAmount: insertDetail.differenceAmount ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    this.cashSalesDetails.set(id, detail);
    return detail;
  }

  async updateCashSalesDetail(id: string, updates: Partial<InsertCashSalesDetail>): Promise<CashSalesDetail | undefined> {
    const detail = this.cashSalesDetails.get(id);
    if (!detail) return undefined;
    const updated: CashSalesDetail = { ...detail, ...updates as any, updatedAt: new Date() };
    this.cashSalesDetails.set(id, updated);
    return updated;
  }

  async getSuppliers(): Promise<Supplier[]> {
    return Array.from(this.suppliers.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    return this.suppliers.get(id);
  }

  async createSupplier(insertSupplier: InsertSupplier): Promise<Supplier> {
    const id = randomUUID();
    const now = new Date();
    const supplier: Supplier = {
      id,
      name: insertSupplier.name,
      contactName: insertSupplier.contactName ?? null,
      email: insertSupplier.email ?? null,
      phone: insertSupplier.phone ?? null,
      address: insertSupplier.address ?? null,
      notes: insertSupplier.notes ?? null,
      active: insertSupplier.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.suppliers.set(id, supplier);
    return supplier;
  }

  async updateSupplier(id: string, updates: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const supplier = this.suppliers.get(id);
    if (!supplier) return undefined;
    const updated: Supplier = { ...supplier, ...updates, updatedAt: new Date() };
    this.suppliers.set(id, updated);
    return updated;
  }

  async getSupplierInvoices(filters?: { supplierId?: string; storeId?: string; status?: string; startDate?: string; endDate?: string }): Promise<SupplierInvoice[]> {
    let invoices = Array.from(this.supplierInvoices.values());
    if (filters?.supplierId) invoices = invoices.filter(i => i.supplierId === filters.supplierId);
    if (filters?.storeId) invoices = invoices.filter(i => i.storeId === filters.storeId);
    if (filters?.status) invoices = invoices.filter(i => i.status === filters.status);
    if (filters?.startDate) invoices = invoices.filter(i => i.invoiceDate >= filters.startDate!);
    if (filters?.endDate) invoices = invoices.filter(i => i.invoiceDate <= filters.endDate!);
    return invoices.sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  }

  async getSupplierInvoice(id: string): Promise<SupplierInvoice | undefined> {
    return this.supplierInvoices.get(id);
  }

  async createSupplierInvoice(insertInvoice: InsertSupplierInvoice): Promise<SupplierInvoice> {
    const id = randomUUID();
    const now = new Date();
    const invoice: SupplierInvoice = {
      id,
      supplierId: insertInvoice.supplierId,
      storeId: insertInvoice.storeId ?? null,
      invoiceNumber: insertInvoice.invoiceNumber,
      invoiceDate: insertInvoice.invoiceDate,
      dueDate: insertInvoice.dueDate ?? null,
      amount: insertInvoice.amount ?? 0,
      status: insertInvoice.status ?? "UNPAID",
      notes: insertInvoice.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.supplierInvoices.set(id, invoice);
    return invoice;
  }

  async updateSupplierInvoice(id: string, updates: Partial<InsertSupplierInvoice>): Promise<SupplierInvoice | undefined> {
    const invoice = this.supplierInvoices.get(id);
    if (!invoice) return undefined;
    const updated: SupplierInvoice = { ...invoice, ...updates as any, updatedAt: new Date() };
    this.supplierInvoices.set(id, updated);
    return updated;
  }

  async getSupplierPayments(filters?: { supplierId?: string; invoiceId?: string; startDate?: string; endDate?: string }): Promise<SupplierPayment[]> {
    let payments = Array.from(this.supplierPayments.values());
    if (filters?.supplierId) payments = payments.filter(p => p.supplierId === filters.supplierId);
    if (filters?.invoiceId) payments = payments.filter(p => p.invoiceId === filters.invoiceId);
    if (filters?.startDate) payments = payments.filter(p => p.paymentDate >= filters.startDate!);
    if (filters?.endDate) payments = payments.filter(p => p.paymentDate <= filters.endDate!);
    return payments.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate));
  }

  async getSupplierPayment(id: string): Promise<SupplierPayment | undefined> {
    return this.supplierPayments.get(id);
  }

  async createSupplierPayment(insertPayment: InsertSupplierPayment): Promise<SupplierPayment> {
    const id = randomUUID();
    const now = new Date();
    const payment: SupplierPayment = {
      id,
      supplierId: insertPayment.supplierId,
      invoiceId: insertPayment.invoiceId,
      paymentDate: insertPayment.paymentDate,
      amount: insertPayment.amount ?? 0,
      method: insertPayment.method ?? null,
      notes: insertPayment.notes ?? null,
      createdAt: now,
    };
    this.supplierPayments.set(id, payment);
    return payment;
  }

  async deleteSupplierPaymentsByInvoiceId(invoiceId: string): Promise<void> {
    for (const [id, p] of this.supplierPayments.entries()) {
      if (p.invoiceId === invoiceId) this.supplierPayments.delete(id);
    }
  }

  async findSupplierByEmail(email: string): Promise<Supplier | undefined> {
    return Array.from(this.suppliers.values()).find(s =>
      s.contactEmails && s.contactEmails.includes(email)
    );
  }

  async findSupplierByName(name: string): Promise<Supplier | undefined> {
    const lower = name.toLowerCase();
    return Array.from(this.suppliers.values()).find(s =>
      s.name.toLowerCase() === lower
    );
  }

  async sweepReviewInvoicesBySupplierName(supplierName: string, supplierId: string): Promise<number> {
    const lower = supplierName.toLowerCase();
    let count = 0;
    for (const [id, inv] of this.supplierInvoices.entries()) {
      if (inv.status === "REVIEW") {
        const raw = inv.rawExtractedData as any;
        const invName: string = raw?.supplier?.supplierName ?? "";
        if (invName.toLowerCase() === lower) {
          this.supplierInvoices.set(id, { ...inv, supplierId, status: "PENDING" });
          count++;
        }
      }
    }
    return count;
  }

  async getQuarantinedEmails(): Promise<QuarantinedEmail[]> {
    return Array.from(this.quarantinedEmails.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async createQuarantinedEmail(insertEmail: InsertQuarantinedEmail): Promise<QuarantinedEmail> {
    const id = randomUUID();
    const email: QuarantinedEmail = {
      id,
      senderEmail: insertEmail.senderEmail,
      subject: insertEmail.subject,
      hasAttachment: insertEmail.hasAttachment ?? false,
      rawPayload: insertEmail.rawPayload ?? null,
      createdAt: new Date(),
    };
    this.quarantinedEmails.set(id, email);
    return email;
  }

  async getEmailRoutingRules(): Promise<EmailRoutingRule[]> {
    return Array.from(this.emailRoutingRulesMap.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getEmailRoutingRule(email: string): Promise<EmailRoutingRule | undefined> {
    return this.emailRoutingRulesMap.get(email.toLowerCase());
  }

  async upsertEmailRoutingRule(data: InsertEmailRoutingRule): Promise<EmailRoutingRule> {
    const normalizedEmail = data.email.toLowerCase();
    const existing = this.emailRoutingRulesMap.get(normalizedEmail);
    const rule: EmailRoutingRule = {
      email: normalizedEmail,
      action: data.action,
      supplierName: data.supplierName ?? null,
      createdAt: existing?.createdAt ?? new Date(),
    };
    this.emailRoutingRulesMap.set(normalizedEmail, rule);
    return rule;
  }

  async deleteEmailRoutingRule(email: string): Promise<boolean> {
    return this.emailRoutingRulesMap.delete(email.toLowerCase());
  }

  async getTodos(): Promise<Todo[]> {
    return Array.from(this.todosMap.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getTodo(id: string): Promise<Todo | undefined> {
    return this.todosMap.get(id);
  }

  async createTodo(data: InsertTodo): Promise<Todo> {
    const id = randomUUID();
    const todo: Todo = {
      id,
      title: data.title,
      description: data.description ?? null,
      sourceEmail: data.sourceEmail ?? null,
      dueDate: data.dueDate ?? null,
      status: data.status ?? "TODO",
      createdAt: new Date(),
    };
    this.todosMap.set(id, todo);
    return todo;
  }

  async updateTodo(id: string, data: Partial<InsertTodo>): Promise<Todo | undefined> {
    const existing = this.todosMap.get(id);
    if (!existing) return undefined;
    const updated: Todo = { ...existing, ...data };
    this.todosMap.set(id, updated);
    return updated;
  }

  async getNotices(filters?: { storeId?: string; activeOnly?: boolean }): Promise<Notice[]> {
    let list = Array.from(this.noticesMap.values());
    if (filters?.activeOnly) list = list.filter(n => n.isActive);
    if (filters?.storeId) {
      list = list.filter(n => n.targetStoreId === null || n.targetStoreId === filters.storeId);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getNotice(id: string): Promise<Notice | undefined> {
    return this.noticesMap.get(id);
  }

  async createNotice(data: InsertNotice): Promise<Notice> {
    const id = randomUUID();
    const notice: Notice = {
      id,
      title: data.title,
      content: data.content,
      targetStoreId: data.targetStoreId ?? null,
      authorId: data.authorId ?? null,
      isActive: data.isActive ?? true,
      createdAt: new Date(),
    };
    this.noticesMap.set(id, notice);
    return notice;
  }

  async updateNotice(id: string, data: Partial<InsertNotice>): Promise<Notice | undefined> {
    const existing = this.noticesMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.noticesMap.set(id, updated);
    return updated;
  }

  async deleteNotice(id: string): Promise<boolean> {
    return this.noticesMap.delete(id);
  }

  async getFinancialTransactions(limit: number = 30): Promise<FinancialTransaction[]> {
    return Array.from(this.financialTransactions.values())
      .sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime())
      .slice(0, limit);
  }

  async createFinancialTransaction(insertTx: InsertFinancialTransaction): Promise<FinancialTransaction> {
    const id = randomUUID();
    const tx: FinancialTransaction = {
      id,
      transactionType: insertTx.transactionType,
      fromStoreId: insertTx.fromStoreId ?? null,
      toStoreId: insertTx.toStoreId ?? null,
      cashAmount: insertTx.cashAmount ?? 0,
      bankAmount: insertTx.bankAmount ?? 0,
      referenceNote: insertTx.referenceNote ?? null,
      category: insertTx.category ?? null,
      executedAt: new Date(),
      executedBy: insertTx.executedBy ?? null,
      isBankSettled: insertTx.isBankSettled ?? false,
    };
    this.financialTransactions.set(id, tx);
    return tx;
  }

  async deleteFinancialTransaction(id: string): Promise<boolean> {
    return this.financialTransactions.delete(id);
  }

  async settleFinancialTransaction(id: string): Promise<boolean> {
    const tx = this.financialTransactions.get(id);
    if (!tx) return false;
    tx.isBankSettled = true;
    return true;
  }

  async createFinancialTransactionWithDate(insertTx: InsertFinancialTransaction, executedAt: Date): Promise<FinancialTransaction> {
    const id = randomUUID();
    const tx: FinancialTransaction = {
      id,
      transactionType: insertTx.transactionType,
      fromStoreId: insertTx.fromStoreId ?? null,
      toStoreId: insertTx.toStoreId ?? null,
      cashAmount: insertTx.cashAmount ?? 0,
      bankAmount: insertTx.bankAmount ?? 0,
      referenceNote: insertTx.referenceNote ?? null,
      category: insertTx.category ?? null,
      executedAt,
      executedBy: insertTx.executedBy ?? null,
      isBankSettled: insertTx.isBankSettled ?? false,
    };
    this.financialTransactions.set(id, tx);
    return tx;
  }

  async deleteCashSalesDetailsByStoreAndDateRange(storeId: string, startDate: string, endDate: string): Promise<number> {
    let count = 0;
    for (const [id, d] of this.cashSalesDetails) {
      if (d.storeId === storeId && d.date >= startDate && d.date <= endDate) {
        this.cashSalesDetails.delete(id);
        count++;
      }
    }
    return count;
  }

  async getFinancialTransactionsByRef(refNote: string): Promise<FinancialTransaction[]> {
    return Array.from(this.financialTransactions.values()).filter(tx => tx.referenceNote === refNote);
  }

  async upsertFinancialTransactionByRef(refNote: string, data: InsertFinancialTransaction): Promise<FinancialTransaction> {
    const existing = Array.from(this.financialTransactions.values()).find(tx => tx.referenceNote === refNote);
    if (existing) {
      existing.cashAmount = data.cashAmount ?? existing.cashAmount;
      existing.bankAmount = data.bankAmount ?? existing.bankAmount;
      existing.fromStoreId = data.fromStoreId ?? existing.fromStoreId;
      existing.toStoreId = data.toStoreId ?? existing.toStoreId;
      return existing;
    }
    return this.createFinancialTransaction(data);
  }

  async getDailyCloseForms(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<DailyCloseForm[]> {
    return [];
  }

  async upsertDailyCloseForm(storeId: string, date: string, data: InsertDailyCloseForm): Promise<DailyCloseForm> {
    throw new Error("Not implemented in MemStorage");
  }

  async deleteDailyCloseFormByStoreAndDate(storeId: string, date: string): Promise<number> {
    return 0;
  }

  async getRosters(filters?: { storeId?: string; startDate?: string; endDate?: string; employeeId?: string }): Promise<Roster[]> {
    let items = Array.from(this.rostersMap.values());
    if (filters?.storeId) items = items.filter(r => r.storeId === filters.storeId);
    if (filters?.employeeId) items = items.filter(r => r.employeeId === filters.employeeId);
    if (filters?.startDate) items = items.filter(r => r.date >= filters.startDate!);
    if (filters?.endDate) items = items.filter(r => r.date <= filters.endDate!);
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  async getRoster(id: string): Promise<Roster | undefined> {
    return this.rostersMap.get(id);
  }

  async upsertRoster(storeId: string, employeeId: string, date: string, data: Omit<InsertRoster, "storeId" | "employeeId" | "date">): Promise<Roster> {
    const existing = Array.from(this.rostersMap.values()).find(r => r.storeId === storeId && r.employeeId === employeeId && r.date === date);
    if (existing) {
      const updated = { ...existing, ...data, updatedAt: new Date() };
      this.rostersMap.set(existing.id, updated);
      return updated;
    }
    const id = randomUUID();
    const roster: Roster = { id, storeId, employeeId, date, notes: data.notes ?? null, startTime: data.startTime, endTime: data.endTime, createdAt: new Date(), updatedAt: new Date() };
    this.rostersMap.set(id, roster);
    return roster;
  }

  async deleteRoster(id: string): Promise<boolean> {
    return this.rostersMap.delete(id);
  }

  async deleteRostersByStoreAndDateRange(storeId: string, startDate: string, endDate: string): Promise<number> {
    let count = 0;
    for (const [id, r] of this.rostersMap.entries()) {
      if (r.storeId === storeId && r.date >= startDate && r.date <= endDate) {
        this.rostersMap.delete(id);
        count++;
      }
    }
    return count;
  }

  async getRostersByEmployeeAndDateRange(employeeId: string, startDate: string, endDate: string): Promise<Roster[]> {
    return Array.from(this.rostersMap.values()).filter(r => r.employeeId === employeeId && r.date >= startDate && r.date <= endDate);
  }

  private rosterPublicationsMap: Map<string, RosterPublication> = new Map();

  async isRosterWeekPublished(storeId: string, weekStart: string): Promise<boolean> {
    const key = `${storeId}|${weekStart}`;
    return Array.from(this.rosterPublicationsMap.values()).some(p => p.storeId === storeId && p.weekStart === weekStart);
  }

  async toggleRosterWeekPublished(storeId: string, weekStart: string): Promise<boolean> {
    const existing = Array.from(this.rosterPublicationsMap.values()).find(p => p.storeId === storeId && p.weekStart === weekStart);
    if (existing) {
      this.rosterPublicationsMap.delete(existing.id);
      return false;
    }
    const id = randomUUID();
    this.rosterPublicationsMap.set(id, { id, storeId, weekStart, publishedAt: new Date() });
    return true;
  }

  private shiftTimesheetsMap: Map<string, ShiftTimesheet> = new Map();

  async getShiftTimesheet(employeeId: string, date: string): Promise<ShiftTimesheet | undefined> {
    return Array.from(this.shiftTimesheetsMap.values()).find(ts => ts.employeeId === employeeId && ts.date === date);
  }

  async createShiftTimesheet(data: InsertShiftTimesheet): Promise<ShiftTimesheet> {
    const id = randomUUID();
    const now = new Date();
    const ts: ShiftTimesheet = { id, ...data, adjustmentReason: data.adjustmentReason ?? null, status: data.status ?? "PENDING", createdAt: now, updatedAt: now };
    this.shiftTimesheetsMap.set(id, ts);
    return ts;
  }

  async getShiftTimesheets(filters?: { storeId?: string; employeeId?: string; date?: string; startDate?: string; endDate?: string; status?: string; isUnscheduled?: boolean }): Promise<ShiftTimesheet[]> {
    return Array.from(this.shiftTimesheetsMap.values()).filter(ts => {
      if (filters?.storeId && ts.storeId !== filters.storeId) return false;
      if (filters?.employeeId && ts.employeeId !== filters.employeeId) return false;
      if (filters?.date && ts.date !== filters.date) return false;
      if (filters?.startDate && ts.date < filters.startDate) return false;
      if (filters?.endDate && ts.date > filters.endDate) return false;
      if (filters?.status && ts.status !== filters.status) return false;
      if (filters?.isUnscheduled !== undefined && ts.isUnscheduled !== filters.isUnscheduled) return false;
      return true;
    });
  }

  async updateShiftTimesheet(id: string, data: Partial<InsertShiftTimesheet>): Promise<ShiftTimesheet | undefined> {
    const existing = this.shiftTimesheetsMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date() };
    this.shiftTimesheetsMap.set(id, updated);
    return updated;
  }

  async deleteShiftTimesheet(id: string): Promise<boolean> {
    return this.shiftTimesheetsMap.delete(id);
  }

  async getIntercompanySettlements(_filters?: { status?: string; payrollId?: string }): Promise<IntercompanySettlement[]> {
    return [];
  }
  async createIntercompanySettlement(data: InsertIntercompanySettlement): Promise<IntercompanySettlement> {
    const row = { ...data, id: randomUUID(), createdAt: new Date(), settledAt: null } as IntercompanySettlement;
    return row;
  }
  async updateIntercompanySettlement(_id: string, _data: Partial<IntercompanySettlement>): Promise<IntercompanySettlement | undefined> {
    return undefined;
  }

  async getPermissions(): Promise<AdminPermission[]> { return []; }
  async setPermissions(_perms: InsertAdminPermission[]): Promise<void> {}
}

export class DatabaseStorage implements IStorage {
  async getStores(): Promise<Store[]> {
    return db.select().from(stores).orderBy(desc(stores.createdAt));
  }

  async getStore(id: string): Promise<Store | undefined> {
    const [store] = await db.select().from(stores).where(eq(stores.id, id));
    return store;
  }

  async createStore(data: InsertStore): Promise<Store> {
    const [store] = await db.insert(stores).values(data).returning();
    return store;
  }

  async updateStore(id: string, data: Partial<InsertStore>): Promise<Store | undefined> {
    const [store] = await db.update(stores).set({ ...data, updatedAt: new Date() }).where(eq(stores.id, id)).returning();
    return store;
  }

  async getCandidates(): Promise<Candidate[]> {
    return db.select().from(candidates).orderBy(desc(candidates.createdAt));
  }

  async getCandidate(id: string): Promise<Candidate | undefined> {
    const [c] = await db.select().from(candidates).where(eq(candidates.id, id));
    return c;
  }

  async createCandidate(data: InsertCandidate): Promise<Candidate> {
    const [c] = await db.insert(candidates).values(data).returning();
    return c;
  }

  async updateCandidate(id: string, data: Partial<InsertCandidate>): Promise<Candidate | undefined> {
    const [c] = await db.update(candidates).set({ ...data, updatedAt: new Date() }).where(eq(candidates.id, id)).returning();
    return c;
  }

  async getEmployees(filters?: { storeId?: string; status?: string; keyword?: string }): Promise<Employee[]> {
    const conditions = [];
    if (filters?.storeId) conditions.push(eq(employees.storeId, filters.storeId));
    if (filters?.status) conditions.push(eq(employees.status, filters.status));
    if (filters?.keyword) {
      const kw = `%${filters.keyword}%`;
      conditions.push(or(
        ilike(employees.firstName, kw),
        ilike(employees.lastName, kw),
        ilike(employees.nickname, kw),
        ilike(employees.email, kw),
      ));
    }
    const query = db.select().from(employees).orderBy(desc(employees.createdAt));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getEmployee(id: string): Promise<Employee | undefined> {
    const [e] = await db.select().from(employees).where(eq(employees.id, id));
    return e;
  }

  async getEmployeeByPin(pin: string): Promise<Employee | undefined> {
    const [e] = await db.select().from(employees).where(eq(employees.pin, pin)).limit(1);
    return e;
  }

  async createEmployee(data: InsertEmployee): Promise<Employee> {
    const [e] = await db.insert(employees).values(data).returning();
    return e;
  }

  async updateEmployee(id: string, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [e] = await db.update(employees).set({ ...data, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
    return e;
  }

  async getEmployeeStoreAssignments(filters?: { employeeId?: string; storeId?: string }): Promise<EmployeeStoreAssignment[]> {
    const conditions = [];
    if (filters?.employeeId) conditions.push(eq(employeeStoreAssignments.employeeId, filters.employeeId));
    if (filters?.storeId) conditions.push(eq(employeeStoreAssignments.storeId, filters.storeId));
    if (conditions.length > 0) {
      return db.select().from(employeeStoreAssignments).where(and(...conditions));
    }
    return db.select().from(employeeStoreAssignments);
  }

  async createEmployeeStoreAssignment(data: InsertEmployeeStoreAssignment): Promise<EmployeeStoreAssignment> {
    const [a] = await db.insert(employeeStoreAssignments).values(data).returning();
    return a;
  }

  async deleteEmployeeStoreAssignments(employeeId: string): Promise<void> {
    await db.delete(employeeStoreAssignments).where(eq(employeeStoreAssignments.employeeId, employeeId));
  }

  async updateStoreAssignmentFields(id: string, fields: { rate?: string; fixedAmount?: string }): Promise<void> {
    const updates: Record<string, any> = {};
    if (fields.rate !== undefined) updates.rate = fields.rate;
    if (fields.fixedAmount !== undefined) updates.fixedAmount = fields.fixedAmount;
    if (Object.keys(updates).length > 0) {
      await db.update(employeeStoreAssignments).set(updates).where(eq(employeeStoreAssignments.id, id));
    }
  }

  async getEmployeesByStoreAssignment(storeId: string, status?: string): Promise<{ employee: Employee; assignment: EmployeeStoreAssignment }[]> {
    const assignments = await db.select().from(employeeStoreAssignments).where(eq(employeeStoreAssignments.storeId, storeId));
    const results: { employee: Employee; assignment: EmployeeStoreAssignment }[] = [];
    for (const a of assignments) {
      const [emp] = await db.select().from(employees).where(eq(employees.id, a.employeeId));
      if (emp && (!status || emp.status === status)) {
        results.push({ employee: emp, assignment: a });
      }
    }
    return results;
  }

  async createOnboardingToken(data: InsertOnboardingToken): Promise<OnboardingToken> {
    const [t] = await db.insert(employeeOnboardingTokens).values(data).returning();
    return t;
  }

  async getOnboardingToken(token: string): Promise<OnboardingToken | undefined> {
    const [t] = await db.select().from(employeeOnboardingTokens).where(eq(employeeOnboardingTokens.token, token));
    return t;
  }

  async markOnboardingTokenUsed(token: string, employeeId: string): Promise<OnboardingToken | undefined> {
    const [t] = await db.update(employeeOnboardingTokens)
      .set({ employeeId, usedAt: new Date() })
      .where(eq(employeeOnboardingTokens.token, token))
      .returning();
    return t;
  }

  async createEmployeeDocument(data: InsertEmployeeDocument): Promise<EmployeeDocument> {
    const [doc] = await db.insert(employeeDocuments).values(data).returning();
    return doc;
  }

  async getEmployeeDocuments(employeeId: string): Promise<EmployeeDocument[]> {
    return db.select().from(employeeDocuments).where(eq(employeeDocuments.employeeId, employeeId));
  }

  async getRosterPeriods(filters?: { storeId?: string }): Promise<RosterPeriod[]> {
    if (filters?.storeId) {
      return db.select().from(rosterPeriods).where(eq(rosterPeriods.storeId, filters.storeId)).orderBy(desc(rosterPeriods.startDate));
    }
    return db.select().from(rosterPeriods).orderBy(desc(rosterPeriods.startDate));
  }

  async getRosterPeriod(id: string): Promise<RosterPeriod | undefined> {
    const [p] = await db.select().from(rosterPeriods).where(eq(rosterPeriods.id, id));
    return p;
  }

  async createRosterPeriod(data: InsertRosterPeriod): Promise<RosterPeriod> {
    const [p] = await db.insert(rosterPeriods).values(data).returning();
    return p;
  }

  async updateRosterPeriod(id: string, data: Partial<InsertRosterPeriod>): Promise<RosterPeriod | undefined> {
    const [p] = await db.update(rosterPeriods).set({ ...data, updatedAt: new Date() }).where(eq(rosterPeriods.id, id)).returning();
    return p;
  }

  async getShifts(filters?: { storeId?: string; periodId?: string; employeeId?: string; startDate?: string; endDate?: string }): Promise<Shift[]> {
    const conditions = [];
    if (filters?.storeId) conditions.push(eq(shifts.storeId, filters.storeId));
    if (filters?.periodId) conditions.push(eq(shifts.rosterPeriodId, filters.periodId));
    if (filters?.employeeId) conditions.push(eq(shifts.employeeId, filters.employeeId));
    if (filters?.startDate) conditions.push(gte(shifts.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(shifts.date, filters.endDate));
    const query = db.select().from(shifts).orderBy(asc(shifts.date), asc(shifts.startTime));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getShift(id: string): Promise<Shift | undefined> {
    const [s] = await db.select().from(shifts).where(eq(shifts.id, id));
    return s;
  }

  async createShift(data: InsertShift): Promise<Shift> {
    const [s] = await db.insert(shifts).values(data).returning();
    return s;
  }

  async updateShift(id: string, data: Partial<InsertShift>): Promise<Shift | undefined> {
    const [s] = await db.update(shifts).set({ ...data, updatedAt: new Date() }).where(eq(shifts.id, id)).returning();
    return s;
  }

  async deleteShift(id: string): Promise<boolean> {
    const result = await db.delete(shifts).where(eq(shifts.id, id)).returning();
    return result.length > 0;
  }

  async getTimeLogs(filters?: { employeeId?: string; storeId?: string; startDate?: string; endDate?: string }): Promise<TimeLog[]> {
    const conditions = [];
    if (filters?.employeeId) conditions.push(eq(timeLogs.employeeId, filters.employeeId));
    if (filters?.storeId) conditions.push(eq(timeLogs.storeId, filters.storeId));
    if (filters?.startDate) conditions.push(gte(timeLogs.clockIn, new Date(filters.startDate)));
    if (filters?.endDate) {
      const end = new Date(filters.endDate);
      end.setHours(23, 59, 59, 999);
      conditions.push(lte(timeLogs.clockIn, end));
    }
    const query = db.select().from(timeLogs).orderBy(desc(timeLogs.clockIn));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getTimeLog(id: string): Promise<TimeLog | undefined> {
    const [l] = await db.select().from(timeLogs).where(eq(timeLogs.id, id));
    return l;
  }

  async createTimeLog(data: InsertTimeLog): Promise<TimeLog> {
    const [l] = await db.insert(timeLogs).values(data).returning();
    return l;
  }

  async updateTimeLog(id: string, data: Partial<InsertTimeLog>): Promise<TimeLog | undefined> {
    const [l] = await db.update(timeLogs).set({ ...data, updatedAt: new Date() }).where(eq(timeLogs.id, id)).returning();
    return l;
  }

  async getOpenTimeLog(employeeId: string, storeId: string): Promise<TimeLog | undefined> {
    const [l] = await db.select().from(timeLogs).where(
      and(eq(timeLogs.employeeId, employeeId), eq(timeLogs.storeId, storeId), isNull(timeLogs.clockOut))
    );
    return l;
  }

  async getTimesheets(filters?: { status?: string; storeId?: string; periodStart?: string; periodEnd?: string }): Promise<Timesheet[]> {
    const conditions = [];
    if (filters?.status) conditions.push(eq(timesheets.status, filters.status));
    if (filters?.storeId) conditions.push(eq(timesheets.storeId, filters.storeId));
    if (filters?.periodStart) conditions.push(gte(timesheets.periodStart, filters.periodStart));
    if (filters?.periodEnd) conditions.push(lte(timesheets.periodEnd, filters.periodEnd));
    const query = db.select().from(timesheets).orderBy(desc(timesheets.periodStart));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getTimesheet(id: string): Promise<Timesheet | undefined> {
    const [s] = await db.select().from(timesheets).where(eq(timesheets.id, id));
    return s;
  }

  async createTimesheet(data: InsertTimesheet): Promise<Timesheet> {
    const [s] = await db.insert(timesheets).values(data).returning();
    return s;
  }

  async updateTimesheet(id: string, data: Partial<InsertTimesheet>): Promise<Timesheet | undefined> {
    const [s] = await db.update(timesheets).set({ ...data, updatedAt: new Date() }).where(eq(timesheets.id, id)).returning();
    return s;
  }

  async getPayrolls(filters?: { employeeId?: string; periodStart?: string; periodEnd?: string }): Promise<Payroll[]> {
    const conditions = [];
    if (filters?.employeeId) conditions.push(eq(payrolls.employeeId, filters.employeeId));
    if (filters?.periodStart) conditions.push(gte(payrolls.periodStart, filters.periodStart));
    if (filters?.periodEnd) conditions.push(lte(payrolls.periodEnd, filters.periodEnd));
    const query = db.select().from(payrolls).orderBy(desc(payrolls.periodStart));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getPayroll(id: string): Promise<Payroll | undefined> {
    const [p] = await db.select().from(payrolls).where(eq(payrolls.id, id));
    return p;
  }

  async createPayroll(data: InsertPayroll): Promise<Payroll> {
    const [p] = await db.insert(payrolls).values(data).returning();
    return p;
  }

  async updatePayroll(id: string, data: Partial<InsertPayroll>): Promise<Payroll | undefined> {
    const [p] = await db.update(payrolls).set({ ...data, updatedAt: new Date() }).where(eq(payrolls.id, id)).returning();
    return p;
  }

  async getDailyClosings(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<DailyClosing[]> {
    const conditions = [];
    if (filters?.storeId) conditions.push(eq(dailyClosings.storeId, filters.storeId));
    if (filters?.startDate) conditions.push(gte(dailyClosings.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(dailyClosings.date, filters.endDate));
    const query = db.select().from(dailyClosings).orderBy(desc(dailyClosings.date));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getDailyClosing(id: string): Promise<DailyClosing | undefined> {
    const [c] = await db.select().from(dailyClosings).where(eq(dailyClosings.id, id));
    return c;
  }

  async createDailyClosing(data: InsertDailyClosing): Promise<DailyClosing> {
    const [c] = await db.insert(dailyClosings).values(data).returning();
    return c;
  }

  async updateDailyClosing(id: string, data: Partial<InsertDailyClosing>): Promise<DailyClosing | undefined> {
    const [c] = await db.update(dailyClosings).set({ ...data, updatedAt: new Date() }).where(eq(dailyClosings.id, id)).returning();
    return c;
  }

  async getCashSalesDetails(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<CashSalesDetail[]> {
    const conditions = [];
    if (filters?.storeId) conditions.push(eq(cashSalesDetails.storeId, filters.storeId));
    if (filters?.startDate) conditions.push(gte(cashSalesDetails.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(cashSalesDetails.date, filters.endDate));
    const query = db.select().from(cashSalesDetails).orderBy(desc(cashSalesDetails.date));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getCashSalesDetail(id: string): Promise<CashSalesDetail | undefined> {
    const [d] = await db.select().from(cashSalesDetails).where(eq(cashSalesDetails.id, id));
    return d;
  }

  async createCashSalesDetail(data: InsertCashSalesDetail): Promise<CashSalesDetail> {
    const [d] = await db.insert(cashSalesDetails).values(data).returning();
    return d;
  }

  async updateCashSalesDetail(id: string, data: Partial<InsertCashSalesDetail>): Promise<CashSalesDetail | undefined> {
    const [d] = await db.update(cashSalesDetails).set({ ...data, updatedAt: new Date() }).where(eq(cashSalesDetails.id, id)).returning();
    return d;
  }

  async getSuppliers(): Promise<Supplier[]> {
    return db.select().from(suppliers).orderBy(asc(suppliers.name));
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    const [s] = await db.select().from(suppliers).where(eq(suppliers.id, id));
    return s;
  }

  async createSupplier(data: InsertSupplier): Promise<Supplier> {
    const [s] = await db.insert(suppliers).values(data).returning();
    return s;
  }

  async updateSupplier(id: string, data: Partial<InsertSupplier>): Promise<Supplier | undefined> {
    const [s] = await db.update(suppliers).set({ ...data, updatedAt: new Date() }).where(eq(suppliers.id, id)).returning();
    return s;
  }

  async getSupplierInvoices(filters?: { supplierId?: string; storeId?: string; status?: string; startDate?: string; endDate?: string }): Promise<SupplierInvoice[]> {
    const conditions = [];
    if (filters?.supplierId) conditions.push(eq(supplierInvoices.supplierId, filters.supplierId));
    if (filters?.storeId) conditions.push(eq(supplierInvoices.storeId, filters.storeId));
    if (filters?.status) conditions.push(eq(supplierInvoices.status, filters.status));
    if (filters?.startDate) conditions.push(gte(supplierInvoices.invoiceDate, filters.startDate));
    if (filters?.endDate) conditions.push(lte(supplierInvoices.invoiceDate, filters.endDate));
    const query = db.select().from(supplierInvoices).orderBy(desc(supplierInvoices.invoiceDate));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getSupplierInvoice(id: string): Promise<SupplierInvoice | undefined> {
    const [i] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id));
    return i;
  }

  async createSupplierInvoice(data: InsertSupplierInvoice): Promise<SupplierInvoice> {
    const [i] = await db.insert(supplierInvoices).values(data).returning();
    return i;
  }

  async updateSupplierInvoice(id: string, data: Partial<InsertSupplierInvoice>): Promise<SupplierInvoice | undefined> {
    const [i] = await db.update(supplierInvoices).set({ ...data, updatedAt: new Date() }).where(eq(supplierInvoices.id, id)).returning();
    return i;
  }

  async getSupplierPayments(filters?: { supplierId?: string; invoiceId?: string; startDate?: string; endDate?: string }): Promise<SupplierPayment[]> {
    const conditions = [];
    if (filters?.supplierId) conditions.push(eq(supplierPayments.supplierId, filters.supplierId));
    if (filters?.invoiceId) conditions.push(eq(supplierPayments.invoiceId, filters.invoiceId));
    if (filters?.startDate) conditions.push(gte(supplierPayments.paymentDate, filters.startDate));
    if (filters?.endDate) conditions.push(lte(supplierPayments.paymentDate, filters.endDate));
    const query = db.select().from(supplierPayments).orderBy(desc(supplierPayments.paymentDate));
    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }
    return query;
  }

  async getSupplierPayment(id: string): Promise<SupplierPayment | undefined> {
    const [p] = await db.select().from(supplierPayments).where(eq(supplierPayments.id, id));
    return p;
  }

  async createSupplierPayment(data: InsertSupplierPayment): Promise<SupplierPayment> {
    const [p] = await db.insert(supplierPayments).values(data).returning();
    return p;
  }

  async deleteSupplierPaymentsByInvoiceId(invoiceId: string): Promise<void> {
    await db.delete(supplierPayments).where(eq(supplierPayments.invoiceId, invoiceId));
  }

  async findSupplierByEmail(email: string): Promise<Supplier | undefined> {
    const all = await db.select().from(suppliers).where(eq(suppliers.active, true));
    return all.find(s => s.contactEmails && s.contactEmails.includes(email));
  }

  async findSupplierByName(name: string): Promise<Supplier | undefined> {
    const [supplier] = await db.select().from(suppliers)
      .where(and(eq(suppliers.active, true), ilike(suppliers.name, name)));
    return supplier;
  }

  async sweepReviewInvoicesBySupplierName(supplierName: string, supplierId: string): Promise<number> {
    const result = await db.execute(sql`
      UPDATE supplier_invoices
      SET supplier_id = ${supplierId}, status = 'PENDING'
      WHERE status = 'REVIEW'
        AND raw_extracted_data->'supplier'->>'supplierName' ILIKE ${supplierName}
    `);
    return (result as any).rowCount ?? 0;
  }

  async getQuarantinedEmails(): Promise<QuarantinedEmail[]> {
    return db.select().from(quarantinedEmails).orderBy(desc(quarantinedEmails.createdAt));
  }

  async createQuarantinedEmail(data: InsertQuarantinedEmail): Promise<QuarantinedEmail> {
    const [q] = await db.insert(quarantinedEmails).values(data).returning();
    return q;
  }

  async getEmailRoutingRules(): Promise<EmailRoutingRule[]> {
    return db.select().from(emailRoutingRules).orderBy(desc(emailRoutingRules.createdAt));
  }

  async getEmailRoutingRule(email: string): Promise<EmailRoutingRule | undefined> {
    const [rule] = await db.select().from(emailRoutingRules)
      .where(eq(emailRoutingRules.email, email.toLowerCase()));
    return rule;
  }

  async upsertEmailRoutingRule(data: InsertEmailRoutingRule): Promise<EmailRoutingRule> {
    const normalizedData = { ...data, email: data.email.toLowerCase() };
    const [rule] = await db.insert(emailRoutingRules)
      .values(normalizedData)
      .onConflictDoUpdate({
        target: emailRoutingRules.email,
        set: { action: normalizedData.action, supplierName: normalizedData.supplierName ?? null },
      })
      .returning();
    return rule;
  }

  async deleteEmailRoutingRule(email: string): Promise<boolean> {
    const result = await db.delete(emailRoutingRules)
      .where(eq(emailRoutingRules.email, email.toLowerCase()));
    return (result.rowCount ?? 0) > 0;
  }

  async getTodos(): Promise<Todo[]> {
    return db.select().from(todos).orderBy(desc(todos.createdAt));
  }

  async getTodo(id: string): Promise<Todo | undefined> {
    const [todo] = await db.select().from(todos).where(eq(todos.id, id));
    return todo;
  }

  async createTodo(data: InsertTodo): Promise<Todo> {
    const [todo] = await db.insert(todos).values(data).returning();
    return todo;
  }

  async updateTodo(id: string, data: Partial<InsertTodo>): Promise<Todo | undefined> {
    const [todo] = await db.update(todos).set(data).where(eq(todos.id, id)).returning();
    return todo;
  }

  async getNotices(filters?: { storeId?: string; activeOnly?: boolean }): Promise<Notice[]> {
    const conditions = [];
    if (filters?.activeOnly) conditions.push(eq(notices.isActive, true));
    if (filters?.storeId) {
      conditions.push(or(isNull(notices.targetStoreId), eq(notices.targetStoreId, filters.storeId)));
    }
    const query = conditions.length > 0
      ? db.select().from(notices).where(and(...conditions))
      : db.select().from(notices);
    return (await query).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async getNotice(id: string): Promise<Notice | undefined> {
    const [n] = await db.select().from(notices).where(eq(notices.id, id));
    return n;
  }

  async createNotice(data: InsertNotice): Promise<Notice> {
    const [n] = await db.insert(notices).values(data).returning();
    return n;
  }

  async updateNotice(id: string, data: Partial<InsertNotice>): Promise<Notice | undefined> {
    const [n] = await db.update(notices).set(data).where(eq(notices.id, id)).returning();
    return n;
  }

  async deleteNotice(id: string): Promise<boolean> {
    const result = await db.delete(notices).where(eq(notices.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getFinancialTransactions(limit: number = 30): Promise<FinancialTransaction[]> {
    return db.select().from(financialTransactions).orderBy(desc(financialTransactions.executedAt)).limit(limit);
  }

  async createFinancialTransaction(data: InsertFinancialTransaction): Promise<FinancialTransaction> {
    const [tx] = await db.insert(financialTransactions).values(data).returning();
    return tx;
  }

  async deleteFinancialTransaction(id: string): Promise<boolean> {
    const result = await db.delete(financialTransactions).where(eq(financialTransactions.id, id)).returning();
    return result.length > 0;
  }

  async settleFinancialTransaction(id: string): Promise<boolean> {
    const result = await db
      .update(financialTransactions)
      .set({ isBankSettled: true })
      .where(eq(financialTransactions.id, id))
      .returning();
    return result.length > 0;
  }

  async createFinancialTransactionWithDate(data: InsertFinancialTransaction, executedAt: Date): Promise<FinancialTransaction> {
    const [tx] = await db.insert(financialTransactions).values({ ...data, executedAt }).returning();
    return tx;
  }

  async deleteCashSalesDetailsByStoreAndDateRange(storeId: string, startDate: string, endDate: string): Promise<number> {
    const result = await db.delete(cashSalesDetails)
      .where(and(
        eq(cashSalesDetails.storeId, storeId),
        gte(cashSalesDetails.date, startDate),
        lte(cashSalesDetails.date, endDate),
      ))
      .returning();
    return result.length;
  }

  async getFinancialTransactionsByRef(refNote: string): Promise<FinancialTransaction[]> {
    return db.select().from(financialTransactions)
      .where(eq(financialTransactions.referenceNote, refNote));
  }

  async upsertFinancialTransactionByRef(refNote: string, data: InsertFinancialTransaction): Promise<FinancialTransaction> {
    const [existing] = await db.select().from(financialTransactions)
      .where(eq(financialTransactions.referenceNote, refNote))
      .limit(1);

    if (existing) {
      const [updated] = await db.update(financialTransactions)
        .set({
          cashAmount: data.cashAmount ?? existing.cashAmount,
          bankAmount: data.bankAmount ?? existing.bankAmount,
          fromStoreId: data.fromStoreId ?? existing.fromStoreId,
          toStoreId: data.toStoreId ?? existing.toStoreId,
        })
        .where(eq(financialTransactions.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db.insert(financialTransactions).values(data).returning();
    return created;
  }

  async getDailyCloseForms(filters?: { storeId?: string; startDate?: string; endDate?: string }): Promise<DailyCloseForm[]> {
    const conditions = [];
    if (filters?.storeId) conditions.push(eq(dailyCloseForms.storeId, filters.storeId));
    if (filters?.startDate) conditions.push(gte(dailyCloseForms.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(dailyCloseForms.date, filters.endDate));
    const query = db.select().from(dailyCloseForms).orderBy(asc(dailyCloseForms.date));
    if (conditions.length > 0) return query.where(and(...conditions));
    return query;
  }

  async upsertDailyCloseForm(storeId: string, date: string, data: InsertDailyCloseForm): Promise<DailyCloseForm> {
    const [existing] = await db.select().from(dailyCloseForms)
      .where(and(eq(dailyCloseForms.storeId, storeId), eq(dailyCloseForms.date, date)));
    if (existing) {
      const [updated] = await db.update(dailyCloseForms)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(dailyCloseForms.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(dailyCloseForms).values(data).returning();
    return created;
  }

  async deleteDailyCloseFormByStoreAndDate(storeId: string, date: string): Promise<number> {
    const result = await db.delete(dailyCloseForms)
      .where(and(eq(dailyCloseForms.storeId, storeId), eq(dailyCloseForms.date, date)))
      .returning();
    return result.length;
  }

  async getRosters(filters?: { storeId?: string; startDate?: string; endDate?: string; employeeId?: string }): Promise<Roster[]> {
    const conditions = [];
    if (filters?.storeId) conditions.push(eq(rosters.storeId, filters.storeId));
    if (filters?.employeeId) conditions.push(eq(rosters.employeeId, filters.employeeId));
    if (filters?.startDate) conditions.push(gte(rosters.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(rosters.date, filters.endDate));
    return db.select().from(rosters).where(conditions.length ? and(...conditions) : undefined).orderBy(asc(rosters.date));
  }

  async getRoster(id: string): Promise<Roster | undefined> {
    const [r] = await db.select().from(rosters).where(eq(rosters.id, id)).limit(1);
    return r;
  }

  async upsertRoster(storeId: string, employeeId: string, date: string, data: Omit<InsertRoster, "storeId" | "employeeId" | "date">): Promise<Roster> {
    const [existing] = await db.select().from(rosters)
      .where(and(eq(rosters.storeId, storeId), eq(rosters.employeeId, employeeId), eq(rosters.date, date)))
      .limit(1);
    if (existing) {
      const [updated] = await db.update(rosters)
        .set({ startTime: data.startTime, endTime: data.endTime, notes: data.notes ?? null, updatedAt: new Date() })
        .where(eq(rosters.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(rosters).values({ storeId, employeeId, date, ...data }).returning();
    return created;
  }

  async deleteRoster(id: string): Promise<boolean> {
    const result = await db.delete(rosters).where(eq(rosters.id, id)).returning();
    return result.length > 0;
  }

  async deleteRostersByStoreAndDateRange(storeId: string, startDate: string, endDate: string): Promise<number> {
    const result = await db.delete(rosters)
      .where(and(eq(rosters.storeId, storeId), gte(rosters.date, startDate), lte(rosters.date, endDate)))
      .returning();
    return result.length;
  }

  async getRostersByEmployeeAndDateRange(employeeId: string, startDate: string, endDate: string): Promise<Roster[]> {
    return db.select().from(rosters)
      .where(and(eq(rosters.employeeId, employeeId), gte(rosters.date, startDate), lte(rosters.date, endDate)));
  }

  async isRosterWeekPublished(storeId: string, weekStart: string): Promise<boolean> {
    const [row] = await db.select().from(rosterPublications)
      .where(and(eq(rosterPublications.storeId, storeId), eq(rosterPublications.weekStart, weekStart)))
      .limit(1);
    return !!row;
  }

  async toggleRosterWeekPublished(storeId: string, weekStart: string): Promise<boolean> {
    const [existing] = await db.select().from(rosterPublications)
      .where(and(eq(rosterPublications.storeId, storeId), eq(rosterPublications.weekStart, weekStart)))
      .limit(1);
    if (existing) {
      await db.delete(rosterPublications).where(eq(rosterPublications.id, existing.id));
      return false;
    }
    await db.insert(rosterPublications).values({ storeId, weekStart });
    return true;
  }

  async getShiftTimesheet(employeeId: string, date: string): Promise<ShiftTimesheet | undefined> {
    const [ts] = await db.select().from(shiftTimesheets)
      .where(and(eq(shiftTimesheets.employeeId, employeeId), eq(shiftTimesheets.date, date)))
      .limit(1);
    return ts;
  }

  async createShiftTimesheet(data: InsertShiftTimesheet): Promise<ShiftTimesheet> {
    const [ts] = await db.insert(shiftTimesheets).values(data).returning();
    return ts;
  }

  async getShiftTimesheets(filters?: { storeId?: string; employeeId?: string; date?: string; startDate?: string; endDate?: string; status?: string; isUnscheduled?: boolean }): Promise<ShiftTimesheet[]> {
    const conditions = [];
    if (filters?.storeId) conditions.push(eq(shiftTimesheets.storeId, filters.storeId));
    if (filters?.employeeId) conditions.push(eq(shiftTimesheets.employeeId, filters.employeeId));
    if (filters?.date) conditions.push(eq(shiftTimesheets.date, filters.date));
    if (filters?.startDate) conditions.push(gte(shiftTimesheets.date, filters.startDate));
    if (filters?.endDate) conditions.push(lte(shiftTimesheets.date, filters.endDate));
    if (filters?.status) conditions.push(eq(shiftTimesheets.status, filters.status));
    if (filters?.isUnscheduled !== undefined) conditions.push(eq(shiftTimesheets.isUnscheduled, filters.isUnscheduled));
    return db.select().from(shiftTimesheets)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(shiftTimesheets.createdAt));
  }

  async updateShiftTimesheet(id: string, data: Partial<InsertShiftTimesheet>): Promise<ShiftTimesheet | undefined> {
    const [updated] = await db.update(shiftTimesheets)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shiftTimesheets.id, id))
      .returning();
    return updated;
  }

  async deleteShiftTimesheet(id: string): Promise<boolean> {
    const result = await db.delete(shiftTimesheets).where(eq(shiftTimesheets.id, id)).returning({ id: shiftTimesheets.id });
    return result.length > 0;
  }

  // ─── Intercompany Settlements ─────────────────────────────────────────────
  async getIntercompanySettlements(filters?: { status?: string; payrollId?: string }): Promise<IntercompanySettlement[]> {
    const conditions = [];
    if (filters?.status) conditions.push(eq(intercompanySettlements.status, filters.status));
    if (filters?.payrollId) conditions.push(eq(intercompanySettlements.payrollId, filters.payrollId));
    if (conditions.length > 0) {
      return await db.select().from(intercompanySettlements).where(and(...conditions)).orderBy(desc(intercompanySettlements.createdAt));
    }
    return await db.select().from(intercompanySettlements).orderBy(desc(intercompanySettlements.createdAt));
  }

  async createIntercompanySettlement(data: InsertIntercompanySettlement): Promise<IntercompanySettlement> {
    const [row] = await db.insert(intercompanySettlements).values(data).returning();
    return row;
  }

  async updateIntercompanySettlement(id: string, data: Partial<IntercompanySettlement>): Promise<IntercompanySettlement | undefined> {
    const [row] = await db.update(intercompanySettlements).set(data).where(eq(intercompanySettlements.id, id)).returning();
    return row;
  }

  // ─── RBAC Permissions ─────────────────────────────────────────────────────
  async getPermissions(): Promise<AdminPermission[]> {
    return db.select().from(adminPermissions).orderBy(adminPermissions.role, adminPermissions.route);
  }

  async setPermissions(perms: InsertAdminPermission[]): Promise<void> {
    await db.delete(adminPermissions);
    if (perms.length > 0) {
      await db.insert(adminPermissions).values(perms);
    }
  }
}

export function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

export const storage = new DatabaseStorage();
