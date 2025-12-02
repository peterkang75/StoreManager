import { 
  type Store, type InsertStore,
  type Candidate, type InsertCandidate,
  type Employee, type InsertEmployee,
  type OnboardingToken, type InsertOnboardingToken,
  type EmployeeDocument, type InsertEmployeeDocument,
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
}

export class MemStorage implements IStorage {
  private stores: Map<string, Store>;
  private candidates: Map<string, Candidate>;
  private employees: Map<string, Employee>;
  private onboardingTokens: Map<string, OnboardingToken>;
  private employeeDocuments: Map<string, EmployeeDocument>;

  constructor() {
    this.stores = new Map();
    this.candidates = new Map();
    this.employees = new Map();
    this.onboardingTokens = new Map();
    this.employeeDocuments = new Map();
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
}

export function generateSecureToken(): string {
  return randomBytes(32).toString('hex');
}

export const storage = new MemStorage();
