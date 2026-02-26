import { 
  type Store, type InsertStore,
  type Candidate, type InsertCandidate,
  type Employee, type InsertEmployee,
  type OnboardingToken, type InsertOnboardingToken,
  type EmployeeDocument, type InsertEmployeeDocument,
  type RosterPeriod, type InsertRosterPeriod,
  type Shift, type InsertShift,
  type TimeLog, type InsertTimeLog,
  type Timesheet, type InsertTimesheet,
  type Payroll, type InsertPayroll,
  type DailyClosing, type InsertDailyClosing,
  type CashSalesDetail, type InsertCashSalesDetail,
  type Supplier, type InsertSupplier,
  type SupplierInvoice, type InsertSupplierInvoice,
  type SupplierPayment, type InsertSupplierPayment,
  type FinancialTransaction, type InsertFinancialTransaction,
  stores, candidates, employees, employeeOnboardingTokens, employeeDocuments,
  rosterPeriods, shifts, timeLogs, timesheets, payrolls,
  dailyClosings, cashSalesDetails, suppliers, supplierInvoices, supplierPayments,
  financialTransactions,
} from "@shared/schema";
import { randomUUID, randomBytes } from "crypto";
import { db } from "./db";
import { eq, desc, and, gte, lte, or, ilike, isNull, asc } from "drizzle-orm";

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
  createEmployee(employee: InsertEmployee): Promise<Employee>;
  updateEmployee(id: string, employee: Partial<InsertEmployee>): Promise<Employee | undefined>;

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

  getFinancialTransactions(limit?: number): Promise<FinancialTransaction[]>;
  createFinancialTransaction(tx: InsertFinancialTransaction): Promise<FinancialTransaction>;
  deleteFinancialTransaction(id: string): Promise<boolean>;
  settleFinancialTransaction(id: string): Promise<boolean>;
  createFinancialTransactionWithDate(tx: InsertFinancialTransaction, executedAt: Date): Promise<FinancialTransaction>;
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
  private financialTransactions: Map<string, FinancialTransaction>;

  constructor() {
    this.stores = new Map();
    this.candidates = new Map();
    this.employees = new Map();
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
    this.financialTransactions = new Map();
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
      executedAt: new Date(),
      executedBy: insertTx.executedBy ?? null,
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
      executedAt,
      executedBy: insertTx.executedBy ?? null,
      isBankSettled: insertTx.isBankSettled ?? false,
    };
    this.financialTransactions.set(id, tx);
    return tx;
  }
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

  async createEmployee(data: InsertEmployee): Promise<Employee> {
    const [e] = await db.insert(employees).values(data).returning();
    return e;
  }

  async updateEmployee(id: string, data: Partial<InsertEmployee>): Promise<Employee | undefined> {
    const [e] = await db.update(employees).set({ ...data, updatedAt: new Date() }).where(eq(employees.id, id)).returning();
    return e;
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
}

export function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

export const storage = new DatabaseStorage();
