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
} from "@shared/schema";
import { randomUUID, randomBytes } from "crypto";

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
      ubereatsAmount: insertClosing.ubereatsAmount ?? 0,
      doordashAmount: insertClosing.doordashAmount ?? 0,
      menulogAmount: insertClosing.menulogAmount ?? 0,
      posSalesAmount: insertClosing.posSalesAmount ?? 0,
      floatAmount: insertClosing.floatAmount ?? 0,
      creditAmount: insertClosing.creditAmount ?? 0,
      differenceAmount: insertClosing.differenceAmount ?? 0,
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
}

export function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

export const storage = new MemStorage();
