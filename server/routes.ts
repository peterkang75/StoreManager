import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage, generateSecureToken } from "./storage";
import { 
  insertStoreSchema, 
  insertCandidateSchema, 
  insertEmployeeSchema,
  insertRosterPeriodSchema,
  insertShiftSchema,
  insertTimeLogSchema,
  insertTimesheetSchema,
  insertPayrollSchema,
  insertDailyClosingSchema,
  insertCashSalesDetailSchema,
  insertSupplierSchema,
  insertSupplierInvoiceSchema,
  insertSupplierPaymentSchema,
  insertFinancialTransactionSchema,
} from "@shared/schema";
import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const multerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + "-" + file.originalname);
  },
});

const upload = multer({ storage: multerStorage });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.get("/api/stores", async (req: Request, res: Response) => {
    try {
      const stores = await storage.getStores();
      res.json(stores);
    } catch (error) {
      console.error("Error fetching stores:", error);
      res.status(500).json({ error: "Failed to fetch stores" });
    }
  });

  app.post("/api/stores", async (req: Request, res: Response) => {
    try {
      const parsed = insertStoreSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const store = await storage.createStore(parsed.data);
      res.status(201).json(store);
    } catch (error) {
      console.error("Error creating store:", error);
      res.status(500).json({ error: "Failed to create store" });
    }
  });

  app.put("/api/stores/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const store = await storage.updateStore(id, req.body);
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      res.json(store);
    } catch (error) {
      console.error("Error updating store:", error);
      res.status(500).json({ error: "Failed to update store" });
    }
  });

  app.get("/api/candidates", async (req: Request, res: Response) => {
    try {
      const candidates = await storage.getCandidates();
      res.json(candidates);
    } catch (error) {
      console.error("Error fetching candidates:", error);
      res.status(500).json({ error: "Failed to fetch candidates" });
    }
  });

  app.get("/api/candidates/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const candidate = await storage.getCandidate(id);
      if (!candidate) {
        return res.status(404).json({ error: "Candidate not found" });
      }
      res.json(candidate);
    } catch (error) {
      console.error("Error fetching candidate:", error);
      res.status(500).json({ error: "Failed to fetch candidate" });
    }
  });

  app.post("/api/candidates", async (req: Request, res: Response) => {
    try {
      const parsed = insertCandidateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const candidate = await storage.createCandidate(parsed.data);
      res.status(201).json(candidate);
    } catch (error) {
      console.error("Error creating candidate:", error);
      res.status(500).json({ error: "Failed to create candidate" });
    }
  });

  app.put("/api/candidates/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const candidate = await storage.updateCandidate(id, req.body);
      if (!candidate) {
        return res.status(404).json({ error: "Candidate not found" });
      }
      res.json(candidate);
    } catch (error) {
      console.error("Error updating candidate:", error);
      res.status(500).json({ error: "Failed to update candidate" });
    }
  });

  app.post("/api/candidates/:id/hire", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const candidate = await storage.getCandidate(id);
      if (!candidate) {
        return res.status(404).json({ error: "Candidate not found" });
      }

      await storage.updateCandidate(id, { hireDecision: "HIRE" });

      const token = generateSecureToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14);

      await storage.createOnboardingToken({
        candidateId: id,
        token,
        expiresAt,
        employeeId: null,
        usedAt: null,
      });

      const onboardingUrl = `/m/onboarding/${token}`;
      res.json({ onboardingUrl, token });
    } catch (error) {
      console.error("Error hiring candidate:", error);
      res.status(500).json({ error: "Failed to process hire" });
    }
  });

  app.get("/api/onboarding/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const onboardingToken = await storage.getOnboardingToken(token);

      if (!onboardingToken) {
        return res.status(404).json({ error: "Invalid token" });
      }

      if (onboardingToken.usedAt) {
        return res.status(400).json({ error: "Token already used" });
      }

      if (new Date(onboardingToken.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Token expired" });
      }

      const candidate = await storage.getCandidate(onboardingToken.candidateId);
      if (!candidate) {
        return res.status(404).json({ error: "Candidate not found" });
      }

      const stores = await storage.getStores();

      res.json({ candidate, stores });
    } catch (error) {
      console.error("Error fetching onboarding data:", error);
      res.status(500).json({ error: "Failed to fetch onboarding data" });
    }
  });

  const onboardingUpload = upload.fields([
    { name: "selfie", maxCount: 1 },
    { name: "passport", maxCount: 1 },
    { name: "signature", maxCount: 1 },
  ]);

  app.post("/api/onboarding/:token", onboardingUpload, async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const onboardingToken = await storage.getOnboardingToken(token);

      if (!onboardingToken) {
        return res.status(404).json({ error: "Invalid token" });
      }

      if (onboardingToken.usedAt) {
        return res.status(400).json({ error: "Token already used" });
      }

      if (new Date(onboardingToken.expiresAt) < new Date()) {
        return res.status(400).json({ error: "Token expired" });
      }

      const employeeData = {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        nickname: req.body.nickname || null,
        email: req.body.email || null,
        phone: req.body.phone || null,
        streetAddress: req.body.streetAddress || null,
        streetAddress2: req.body.streetAddress2 || null,
        suburb: req.body.suburb || null,
        state: req.body.state || null,
        postCode: req.body.postCode || null,
        dob: req.body.dob || null,
        gender: req.body.gender || null,
        maritalStatus: req.body.maritalStatus || null,
        visaType: req.body.visaType || null,
        visaExpiry: req.body.visaExpiry || null,
        lineId: req.body.lineId || null,
        typeOfContact: req.body.typeOfContact || null,
        rate: req.body.rate || null,
        contractPosition: req.body.contractPosition || null,
        fhc: req.body.fhc || null,
        salaryType: req.body.salaryType || null,
        annualLeave: req.body.annualLeave || null,
        storeId: req.body.storeId || null,
        fixedAmount: req.body.fixedAmount || null,
        tfn: req.body.tfn || null,
        bsb: req.body.bsb || null,
        accountNo: req.body.accountNo || null,
        superCompany: req.body.superCompany || null,
        superMembershipNo: req.body.superMembershipNo || null,
        status: "ACTIVE",
      };

      const employee = await storage.createEmployee(employeeData);

      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      
      if (files?.selfie?.[0]) {
        await storage.createEmployeeDocument({
          employeeId: employee.id,
          docType: "SELFIE",
          filePath: files.selfie[0].path,
        });
      }
      
      if (files?.passport?.[0]) {
        await storage.createEmployeeDocument({
          employeeId: employee.id,
          docType: "PASSPORT_COVER",
          filePath: files.passport[0].path,
        });
      }
      
      if (files?.signature?.[0]) {
        await storage.createEmployeeDocument({
          employeeId: employee.id,
          docType: "SIGNATURE",
          filePath: files.signature[0].path,
        });
      }

      await storage.markOnboardingTokenUsed(token, employee.id);

      res.status(201).json(employee);
    } catch (error) {
      console.error("Error completing onboarding:", error);
      res.status(500).json({ error: "Failed to complete onboarding" });
    }
  });

  app.get("/api/employees", async (req: Request, res: Response) => {
    try {
      const filters: { storeId?: string; status?: string; keyword?: string } = {};
      
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      if (req.query.status && typeof req.query.status === "string") {
        filters.status = req.query.status;
      }
      if (req.query.keyword && typeof req.query.keyword === "string") {
        filters.keyword = req.query.keyword;
      }

      const employees = await storage.getEmployees(filters);
      res.json(employees);
    } catch (error) {
      console.error("Error fetching employees:", error);
      res.status(500).json({ error: "Failed to fetch employees" });
    }
  });

  app.get("/api/employees/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const employee = await storage.getEmployee(id);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }
      res.json(employee);
    } catch (error) {
      console.error("Error fetching employee:", error);
      res.status(500).json({ error: "Failed to fetch employee" });
    }
  });

  app.put("/api/employees/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const employee = await storage.updateEmployee(id, req.body);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }
      res.json(employee);
    } catch (error) {
      console.error("Error updating employee:", error);
      res.status(500).json({ error: "Failed to update employee" });
    }
  });

  app.get("/api/roster-periods", async (req: Request, res: Response) => {
    try {
      const filters: { storeId?: string } = {};
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      const periods = await storage.getRosterPeriods(filters);
      res.json(periods);
    } catch (error) {
      console.error("Error fetching roster periods:", error);
      res.status(500).json({ error: "Failed to fetch roster periods" });
    }
  });

  app.post("/api/roster-periods", async (req: Request, res: Response) => {
    try {
      const parsed = insertRosterPeriodSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const period = await storage.createRosterPeriod(parsed.data);
      res.status(201).json(period);
    } catch (error) {
      console.error("Error creating roster period:", error);
      res.status(500).json({ error: "Failed to create roster period" });
    }
  });

  app.put("/api/roster-periods/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const period = await storage.updateRosterPeriod(id, req.body);
      if (!period) {
        return res.status(404).json({ error: "Roster period not found" });
      }
      res.json(period);
    } catch (error) {
      console.error("Error updating roster period:", error);
      res.status(500).json({ error: "Failed to update roster period" });
    }
  });

  app.get("/api/shifts", async (req: Request, res: Response) => {
    try {
      const filters: { storeId?: string; periodId?: string; employeeId?: string; startDate?: string; endDate?: string } = {};
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      if (req.query.period_id && typeof req.query.period_id === "string") {
        filters.periodId = req.query.period_id;
      }
      if (req.query.employee_id && typeof req.query.employee_id === "string") {
        filters.employeeId = req.query.employee_id;
      }
      if (req.query.start_date && typeof req.query.start_date === "string") {
        filters.startDate = req.query.start_date;
      }
      if (req.query.end_date && typeof req.query.end_date === "string") {
        filters.endDate = req.query.end_date;
      }
      const shifts = await storage.getShifts(filters);
      res.json(shifts);
    } catch (error) {
      console.error("Error fetching shifts:", error);
      res.status(500).json({ error: "Failed to fetch shifts" });
    }
  });

  app.post("/api/shifts", async (req: Request, res: Response) => {
    try {
      const parsed = insertShiftSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const shift = await storage.createShift(parsed.data);
      res.status(201).json(shift);
    } catch (error) {
      console.error("Error creating shift:", error);
      res.status(500).json({ error: "Failed to create shift" });
    }
  });

  app.put("/api/shifts/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const shift = await storage.updateShift(id, req.body);
      if (!shift) {
        return res.status(404).json({ error: "Shift not found" });
      }
      res.json(shift);
    } catch (error) {
      console.error("Error updating shift:", error);
      res.status(500).json({ error: "Failed to update shift" });
    }
  });

  app.delete("/api/shifts/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteShift(id);
      if (!deleted) {
        return res.status(404).json({ error: "Shift not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting shift:", error);
      res.status(500).json({ error: "Failed to delete shift" });
    }
  });

  app.post("/api/time-logs/clock-in", async (req: Request, res: Response) => {
    try {
      const { employee_id, store_id, shift_id } = req.body;
      
      if (!employee_id || !store_id) {
        return res.status(400).json({ error: "employee_id and store_id are required" });
      }

      const existingOpen = await storage.getOpenTimeLog(employee_id, store_id);
      if (existingOpen) {
        return res.status(400).json({ error: "Already clocked in" });
      }

      const log = await storage.createTimeLog({
        employeeId: employee_id,
        storeId: store_id,
        shiftId: shift_id || null,
        clockIn: new Date(),
        clockOut: null,
        source: "MANUAL",
        adjustmentReason: null,
      });
      res.status(201).json(log);
    } catch (error) {
      console.error("Error clocking in:", error);
      res.status(500).json({ error: "Failed to clock in" });
    }
  });

  app.post("/api/time-logs/clock-out", async (req: Request, res: Response) => {
    try {
      const { employee_id, store_id } = req.body;
      
      if (!employee_id || !store_id) {
        return res.status(400).json({ error: "employee_id and store_id are required" });
      }

      const openLog = await storage.getOpenTimeLog(employee_id, store_id);
      if (!openLog) {
        return res.status(400).json({ error: "No active clock-in found" });
      }

      const updated = await storage.updateTimeLog(openLog.id, { clockOut: new Date() });
      res.json(updated);
    } catch (error) {
      console.error("Error clocking out:", error);
      res.status(500).json({ error: "Failed to clock out" });
    }
  });

  app.get("/api/time-logs", async (req: Request, res: Response) => {
    try {
      const filters: { employeeId?: string; storeId?: string; startDate?: string; endDate?: string } = {};
      if (req.query.employee_id && typeof req.query.employee_id === "string") {
        filters.employeeId = req.query.employee_id;
      }
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      if (req.query.start_date && typeof req.query.start_date === "string") {
        filters.startDate = req.query.start_date;
      }
      if (req.query.end_date && typeof req.query.end_date === "string") {
        filters.endDate = req.query.end_date;
      }
      const logs = await storage.getTimeLogs(filters);
      res.json(logs);
    } catch (error) {
      console.error("Error fetching time logs:", error);
      res.status(500).json({ error: "Failed to fetch time logs" });
    }
  });

  app.put("/api/time-logs/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const log = await storage.updateTimeLog(id, req.body);
      if (!log) {
        return res.status(404).json({ error: "Time log not found" });
      }
      res.json(log);
    } catch (error) {
      console.error("Error updating time log:", error);
      res.status(500).json({ error: "Failed to update time log" });
    }
  });

  app.post("/api/timesheets/generate", async (req: Request, res: Response) => {
    try {
      const { period_start, period_end, store_id } = req.body;
      
      if (!period_start || !period_end) {
        return res.status(400).json({ error: "period_start and period_end are required" });
      }

      const logs = await storage.getTimeLogs({
        storeId: store_id,
        startDate: period_start,
        endDate: period_end,
      });

      const employeeHours: Map<string, { hours: number; storeId: string | null }> = new Map();

      for (const log of logs) {
        if (log.clockIn && log.clockOut) {
          const hours = (new Date(log.clockOut).getTime() - new Date(log.clockIn).getTime()) / (1000 * 60 * 60);
          const existing = employeeHours.get(log.employeeId);
          if (existing) {
            existing.hours += hours;
          } else {
            employeeHours.set(log.employeeId, { hours, storeId: log.storeId });
          }
        }
      }

      const timesheets = [];
      for (const [employeeId, data] of employeeHours) {
        const sheet = await storage.createTimesheet({
          employeeId,
          storeId: data.storeId,
          periodStart: period_start,
          periodEnd: period_end,
          totalHours: Math.round(data.hours * 100) / 100,
          status: "PENDING",
          managerId: null,
          approvedAt: null,
          notes: null,
        });
        timesheets.push(sheet);
      }

      res.status(201).json(timesheets);
    } catch (error) {
      console.error("Error generating timesheets:", error);
      res.status(500).json({ error: "Failed to generate timesheets" });
    }
  });

  app.get("/api/timesheets", async (req: Request, res: Response) => {
    try {
      const filters: { status?: string; storeId?: string; periodStart?: string; periodEnd?: string } = {};
      if (req.query.status && typeof req.query.status === "string") {
        filters.status = req.query.status;
      }
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      if (req.query.period_start && typeof req.query.period_start === "string") {
        filters.periodStart = req.query.period_start;
      }
      if (req.query.period_end && typeof req.query.period_end === "string") {
        filters.periodEnd = req.query.period_end;
      }
      const sheets = await storage.getTimesheets(filters);
      res.json(sheets);
    } catch (error) {
      console.error("Error fetching timesheets:", error);
      res.status(500).json({ error: "Failed to fetch timesheets" });
    }
  });

  app.get("/api/timesheets/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const sheet = await storage.getTimesheet(id);
      if (!sheet) {
        return res.status(404).json({ error: "Timesheet not found" });
      }
      res.json(sheet);
    } catch (error) {
      console.error("Error fetching timesheet:", error);
      res.status(500).json({ error: "Failed to fetch timesheet" });
    }
  });

  app.put("/api/timesheets/:id/approve", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { manager_id } = req.body;
      const sheet = await storage.updateTimesheet(id, {
        status: "APPROVED",
        managerId: manager_id || null,
        approvedAt: new Date(),
      });
      if (!sheet) {
        return res.status(404).json({ error: "Timesheet not found" });
      }
      res.json(sheet);
    } catch (error) {
      console.error("Error approving timesheet:", error);
      res.status(500).json({ error: "Failed to approve timesheet" });
    }
  });

  app.put("/api/timesheets/:id/reject", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const sheet = await storage.updateTimesheet(id, {
        status: "REJECTED",
        notes: notes || null,
      });
      if (!sheet) {
        return res.status(404).json({ error: "Timesheet not found" });
      }
      res.json(sheet);
    } catch (error) {
      console.error("Error rejecting timesheet:", error);
      res.status(500).json({ error: "Failed to reject timesheet" });
    }
  });

  app.post("/api/payrolls/generate", async (req: Request, res: Response) => {
    try {
      const { period_start, period_end } = req.body;
      
      if (!period_start || !period_end) {
        return res.status(400).json({ error: "period_start and period_end are required" });
      }

      const timesheets = await storage.getTimesheets({
        status: "APPROVED",
        periodStart: period_start,
        periodEnd: period_end,
      });

      const payrolls = [];
      for (const sheet of timesheets) {
        const employee = await storage.getEmployee(sheet.employeeId);
        if (!employee) continue;

        const rate = parseFloat(employee.rate || "0");
        const fixedAmount = parseFloat(employee.fixedAmount || "0");
        const hours = sheet.totalHours;
        const calculatedAmount = hours * rate + fixedAmount;

        const payroll = await storage.createPayroll({
          employeeId: sheet.employeeId,
          periodStart: period_start,
          periodEnd: period_end,
          hours,
          rate,
          fixedAmount,
          calculatedAmount,
          adjustment: 0,
          adjustmentReason: null,
          totalWithAdjustment: calculatedAmount,
          cashAmount: 0,
          bankDepositAmount: calculatedAmount,
          taxAmount: 0,
          superAmount: 0,
          memo: null,
        });
        payrolls.push(payroll);
      }

      res.status(201).json(payrolls);
    } catch (error) {
      console.error("Error generating payrolls:", error);
      res.status(500).json({ error: "Failed to generate payrolls" });
    }
  });

  app.get("/api/payrolls", async (req: Request, res: Response) => {
    try {
      const filters: { employeeId?: string; periodStart?: string; periodEnd?: string } = {};
      if (req.query.employee_id && typeof req.query.employee_id === "string") {
        filters.employeeId = req.query.employee_id;
      }
      if (req.query.period_start && typeof req.query.period_start === "string") {
        filters.periodStart = req.query.period_start;
      }
      if (req.query.period_end && typeof req.query.period_end === "string") {
        filters.periodEnd = req.query.period_end;
      }
      const payrolls = await storage.getPayrolls(filters);
      res.json(payrolls);
    } catch (error) {
      console.error("Error fetching payrolls:", error);
      res.status(500).json({ error: "Failed to fetch payrolls" });
    }
  });

  app.get("/api/payrolls/current", async (req: Request, res: Response) => {
    try {
      const { store_id, period_start, period_end } = req.query as Record<string, string>;
      if (!store_id || !period_start || !period_end) {
        return res.status(400).json({ error: "store_id, period_start, period_end are required" });
      }
      const emps = await storage.getEmployees({ storeId: store_id, status: "ACTIVE" });
      const existingPayrolls = await storage.getPayrolls({ periodStart: period_start, periodEnd: period_end });
      const empPayrollMap = new Map<string, any>();
      for (const p of existingPayrolls) {
        if (emps.find(e => e.id === p.employeeId)) {
          empPayrollMap.set(p.employeeId, p);
        }
      }
      const rows = emps.map(emp => ({
        employee: emp,
        payroll: empPayrollMap.get(emp.id) || null,
      }));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching current payroll:", error);
      res.status(500).json({ error: "Failed to fetch current payroll data" });
    }
  });

  app.get("/api/payrolls/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const payroll = await storage.getPayroll(id);
      if (!payroll) {
        return res.status(404).json({ error: "Payroll not found" });
      }
      res.json(payroll);
    } catch (error) {
      console.error("Error fetching payroll:", error);
      res.status(500).json({ error: "Failed to fetch payroll" });
    }
  });

  app.put("/api/payrolls/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const payroll = await storage.updatePayroll(id, req.body);
      if (!payroll) {
        return res.status(404).json({ error: "Payroll not found" });
      }
      res.json(payroll);
    } catch (error) {
      console.error("Error updating payroll:", error);
      res.status(500).json({ error: "Failed to update payroll" });
    }
  });

  app.post("/api/payrolls/bulk", async (req: Request, res: Response) => {
    try {
      const { rows } = req.body;
      if (!Array.isArray(rows)) {
        return res.status(400).json({ error: "rows array is required" });
      }
      const results = [];
      for (const row of rows) {
        if (row.id) {
          const { id, ...updateData } = row;
          const updated = await storage.updatePayroll(id, updateData);
          if (updated) results.push(updated);
        } else {
          const parsed = insertPayrollSchema.safeParse(row);
          if (!parsed.success) {
            console.error("Payroll validation error:", parsed.error.message);
            continue;
          }
          const created = await storage.createPayroll(parsed.data);
          results.push(created);
        }
      }
      res.json(results);
    } catch (error) {
      console.error("Error bulk saving payrolls:", error);
      res.status(500).json({ error: "Failed to bulk save payrolls" });
    }
  });

  app.put("/api/stores/:id/payroll-note", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { globalPayrollNote } = req.body;
      const store = await storage.updateStore(id, { globalPayrollNote: globalPayrollNote ?? null });
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }
      res.json(store);
    } catch (error) {
      console.error("Error updating payroll note:", error);
      res.status(500).json({ error: "Failed to update payroll note" });
    }
  });

  const csvUpload = multer({ storage: multer.memoryStorage() });
  app.post("/api/employees/import", csvUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const content = req.file.buffer.toString("utf-8");
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        return res.status(400).json({ error: "File must have a header row and at least one data row" });
      }
      const delimiter = lines[0].includes("\t") ? "\t" : ",";
      const headers = lines[0].split(delimiter).map(h => h.trim().toLowerCase());
      const nameIdx = headers.findIndex(h => h === "name" || h === "employee" || h === "employee name");
      const firstNameIdx = headers.findIndex(h => h === "firstname" || h === "first_name" || h === "first name");
      const lastNameIdx = headers.findIndex(h => h === "lastname" || h === "last_name" || h === "last name");
      const rateIdx = headers.findIndex(h => h === "rate" || h === "hourly_rate" || h === "hourly rate");
      const fixedIdx = headers.findIndex(h => h === "fixed" || h === "fixed_amount" || h === "fixedamount" || h === "fixed amount");
      const storeIdx = headers.findIndex(h => h === "store" || h === "store_id" || h === "storeid");

      const allStores = await storage.getStores();
      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter).map(c => c.trim());
        let firstName = "";
        let lastName = "";
        if (nameIdx >= 0 && cols[nameIdx]) {
          const parts = cols[nameIdx].split(/\s+/);
          firstName = parts[0] || "";
          lastName = parts.slice(1).join(" ") || "";
        } else if (firstNameIdx >= 0 && cols[firstNameIdx]) {
          firstName = cols[firstNameIdx];
          lastName = lastNameIdx >= 0 ? (cols[lastNameIdx] || "") : "";
        }
        if (!firstName) {
          errors.push(`Row ${i + 1}: Missing employee name`);
          skipped++;
          continue;
        }
        const rate = rateIdx >= 0 ? cols[rateIdx] || "" : "";
        const fixedAmount = fixedIdx >= 0 ? cols[fixedIdx] || "" : "";
        let storeId: string | undefined;
        if (storeIdx >= 0 && cols[storeIdx]) {
          const storeVal = cols[storeIdx];
          const found = allStores.find(s => s.name.toLowerCase() === storeVal.toLowerCase() || s.code === storeVal || s.id === storeVal);
          storeId = found?.id;
        }

        const existing = (await storage.getEmployees({})).find(
          e => e.firstName.toLowerCase() === firstName.toLowerCase() && e.lastName.toLowerCase() === (lastName || "").toLowerCase()
        );
        if (existing) {
          await storage.updateEmployee(existing.id, {
            rate: rate || existing.rate || undefined,
            fixedAmount: fixedAmount || existing.fixedAmount || undefined,
            storeId: storeId || existing.storeId || undefined,
          });
        } else {
          await storage.createEmployee({
            firstName,
            lastName: lastName || "",
            rate: rate || undefined,
            fixedAmount: fixedAmount || undefined,
            storeId: storeId || undefined,
          });
        }
        imported++;
      }
      res.json({ imported, skipped, errors });
    } catch (error) {
      console.error("Error importing employees:", error);
      res.status(500).json({ error: "Failed to import employees" });
    }
  });

  app.get("/api/daily-closings", async (req: Request, res: Response) => {
    try {
      const filters: { storeId?: string; startDate?: string; endDate?: string } = {};
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      if (req.query.start_date && typeof req.query.start_date === "string") {
        filters.startDate = req.query.start_date;
      }
      if (req.query.end_date && typeof req.query.end_date === "string") {
        filters.endDate = req.query.end_date;
      }
      const closings = await storage.getDailyClosings(filters);
      res.json(closings);
    } catch (error) {
      console.error("Error fetching daily closings:", error);
      res.status(500).json({ error: "Failed to fetch daily closings" });
    }
  });

  app.post("/api/daily-closings", async (req: Request, res: Response) => {
    try {
      const parsed = insertDailyClosingSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const closing = await storage.createDailyClosing(parsed.data);
      res.status(201).json(closing);
    } catch (error) {
      console.error("Error creating daily closing:", error);
      res.status(500).json({ error: "Failed to create daily closing" });
    }
  });

  app.put("/api/daily-closings/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const closing = await storage.updateDailyClosing(id, req.body);
      if (!closing) {
        return res.status(404).json({ error: "Daily closing not found" });
      }
      res.json(closing);
    } catch (error) {
      console.error("Error updating daily closing:", error);
      res.status(500).json({ error: "Failed to update daily closing" });
    }
  });

  app.get("/api/cash-sales", async (req: Request, res: Response) => {
    try {
      const filters: { storeId?: string; startDate?: string; endDate?: string } = {};
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      if (req.query.start_date && typeof req.query.start_date === "string") {
        filters.startDate = req.query.start_date;
      }
      if (req.query.end_date && typeof req.query.end_date === "string") {
        filters.endDate = req.query.end_date;
      }
      const details = await storage.getCashSalesDetails(filters);
      res.json(details);
    } catch (error) {
      console.error("Error fetching cash sales:", error);
      res.status(500).json({ error: "Failed to fetch cash sales" });
    }
  });

  app.post("/api/cash-sales", async (req: Request, res: Response) => {
    try {
      const parsed = insertCashSalesDetailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const detail = await storage.createCashSalesDetail(parsed.data);
      res.status(201).json(detail);
    } catch (error) {
      console.error("Error creating cash sales:", error);
      res.status(500).json({ error: "Failed to create cash sales" });
    }
  });

  app.put("/api/cash-sales/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const detail = await storage.updateCashSalesDetail(id, req.body);
      if (!detail) {
        return res.status(404).json({ error: "Cash sales not found" });
      }
      res.json(detail);
    } catch (error) {
      console.error("Error updating cash sales:", error);
      res.status(500).json({ error: "Failed to update cash sales" });
    }
  });

  app.get("/api/suppliers", async (req: Request, res: Response) => {
    try {
      const suppliers = await storage.getSuppliers();
      res.json(suppliers);
    } catch (error) {
      console.error("Error fetching suppliers:", error);
      res.status(500).json({ error: "Failed to fetch suppliers" });
    }
  });

  app.post("/api/suppliers", async (req: Request, res: Response) => {
    try {
      const parsed = insertSupplierSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const supplier = await storage.createSupplier(parsed.data);
      res.status(201).json(supplier);
    } catch (error) {
      console.error("Error creating supplier:", error);
      res.status(500).json({ error: "Failed to create supplier" });
    }
  });

  app.put("/api/suppliers/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const supplier = await storage.updateSupplier(id, req.body);
      if (!supplier) {
        return res.status(404).json({ error: "Supplier not found" });
      }
      res.json(supplier);
    } catch (error) {
      console.error("Error updating supplier:", error);
      res.status(500).json({ error: "Failed to update supplier" });
    }
  });

  app.get("/api/supplier-invoices", async (req: Request, res: Response) => {
    try {
      const filters: { supplierId?: string; storeId?: string; status?: string; startDate?: string; endDate?: string } = {};
      if (req.query.supplier_id && typeof req.query.supplier_id === "string") {
        filters.supplierId = req.query.supplier_id;
      }
      if (req.query.store_id && typeof req.query.store_id === "string") {
        filters.storeId = req.query.store_id;
      }
      if (req.query.status && typeof req.query.status === "string") {
        filters.status = req.query.status;
      }
      if (req.query.start_date && typeof req.query.start_date === "string") {
        filters.startDate = req.query.start_date;
      }
      if (req.query.end_date && typeof req.query.end_date === "string") {
        filters.endDate = req.query.end_date;
      }
      const invoices = await storage.getSupplierInvoices(filters);
      res.json(invoices);
    } catch (error) {
      console.error("Error fetching supplier invoices:", error);
      res.status(500).json({ error: "Failed to fetch supplier invoices" });
    }
  });

  app.post("/api/supplier-invoices", async (req: Request, res: Response) => {
    try {
      const parsed = insertSupplierInvoiceSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const invoice = await storage.createSupplierInvoice(parsed.data);
      res.status(201).json(invoice);
    } catch (error) {
      console.error("Error creating supplier invoice:", error);
      res.status(500).json({ error: "Failed to create supplier invoice" });
    }
  });

  app.put("/api/supplier-invoices/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const invoice = await storage.updateSupplierInvoice(id, req.body);
      if (!invoice) {
        return res.status(404).json({ error: "Supplier invoice not found" });
      }
      res.json(invoice);
    } catch (error) {
      console.error("Error updating supplier invoice:", error);
      res.status(500).json({ error: "Failed to update supplier invoice" });
    }
  });

  app.get("/api/supplier-payments", async (req: Request, res: Response) => {
    try {
      const filters: { supplierId?: string; invoiceId?: string; startDate?: string; endDate?: string } = {};
      if (req.query.supplier_id && typeof req.query.supplier_id === "string") {
        filters.supplierId = req.query.supplier_id;
      }
      if (req.query.invoice_id && typeof req.query.invoice_id === "string") {
        filters.invoiceId = req.query.invoice_id;
      }
      if (req.query.start_date && typeof req.query.start_date === "string") {
        filters.startDate = req.query.start_date;
      }
      if (req.query.end_date && typeof req.query.end_date === "string") {
        filters.endDate = req.query.end_date;
      }
      const payments = await storage.getSupplierPayments(filters);
      res.json(payments);
    } catch (error) {
      console.error("Error fetching supplier payments:", error);
      res.status(500).json({ error: "Failed to fetch supplier payments" });
    }
  });

  app.post("/api/supplier-payments", async (req: Request, res: Response) => {
    try {
      const parsed = insertSupplierPaymentSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const payment = await storage.createSupplierPayment(parsed.data);

      const payments = await storage.getSupplierPayments({ invoiceId: parsed.data.invoiceId });
      const totalPaid = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      
      const invoice = await storage.getSupplierInvoice(parsed.data.invoiceId);
      if (invoice) {
        const newStatus = totalPaid >= invoice.amount ? "PAID" : "PARTIAL";
        await storage.updateSupplierInvoice(invoice.id, { status: newStatus });
      }

      res.status(201).json(payment);
    } catch (error) {
      console.error("Error creating supplier payment:", error);
      res.status(500).json({ error: "Failed to create supplier payment" });
    }
  });

  app.get("/api/finance/transactions", async (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 30;
      const transactions = await storage.getFinancialTransactions(limit);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching financial transactions:", error);
      res.status(500).json({ error: "Failed to fetch financial transactions" });
    }
  });

  app.post("/api/finance/convert", async (req: Request, res: Response) => {
    try {
      const { fromStoreId, toStoreId, amount, referenceNote } = req.body;

      if (!fromStoreId || !toStoreId || amount === undefined || amount === null) {
        return res.status(400).json({ error: "fromStoreId, toStoreId, and amount are required" });
      }

      if (fromStoreId === toStoreId) {
        return res.status(400).json({ error: "From and To store must be different" });
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "Amount must be a positive number" });
      }

      const fromStore = await storage.getStore(fromStoreId);
      const toStore = await storage.getStore(toStoreId);
      if (!fromStore || !toStore) {
        return res.status(404).json({ error: "One or both stores not found" });
      }

      const tx = await storage.createFinancialTransaction({
        transactionType: "CONVERT",
        fromStoreId,
        toStoreId,
        cashAmount: parsedAmount,
        bankAmount: parsedAmount,
        referenceNote: referenceNote || null,
        executedBy: null,
      });

      res.status(201).json(tx);
    } catch (error) {
      console.error("Error creating convert transaction:", error);
      res.status(500).json({ error: "Failed to create convert transaction" });
    }
  });

  app.post("/api/finance/remittance", async (req: Request, res: Response) => {
    try {
      const { fromStoreId, toStoreId, amount, referenceNote } = req.body;

      if (!fromStoreId || !toStoreId || amount === undefined || amount === null) {
        return res.status(400).json({ error: "fromStoreId, toStoreId, and amount are required" });
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "Amount must be a positive number" });
      }

      const fromStore = await storage.getStore(fromStoreId);
      const toStore = await storage.getStore(toStoreId);
      if (!fromStore || !toStore) {
        return res.status(404).json({ error: "One or both stores not found" });
      }

      if (toStore.code.toUpperCase() !== "HO" && !toStore.name.toUpperCase().includes("HEAD OFFICE")) {
        return res.status(400).json({ error: "Remittance destination must be the Head Office (HO) store" });
      }

      if (fromStoreId === toStoreId) {
        return res.status(400).json({ error: "From and To store must be different" });
      }

      const tx = await storage.createFinancialTransaction({
        transactionType: "REMITTANCE",
        fromStoreId,
        toStoreId,
        cashAmount: parsedAmount,
        bankAmount: 0,
        referenceNote: referenceNote || null,
        executedBy: null,
      });

      res.status(201).json(tx);
    } catch (error) {
      console.error("Error creating remittance:", error);
      res.status(500).json({ error: "Failed to create remittance" });
    }
  });

  app.post("/api/finance/manual", async (req: Request, res: Response) => {
    try {
      const { transactionType, storeId, amount, referenceNote } = req.body;

      if (!transactionType || !storeId || amount === undefined || amount === null) {
        return res.status(400).json({ error: "transactionType, storeId, and amount are required" });
      }

      if (transactionType !== "MANUAL_INCOME" && transactionType !== "MANUAL_EXPENSE") {
        return res.status(400).json({ error: "transactionType must be MANUAL_INCOME or MANUAL_EXPENSE" });
      }

      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "Amount must be a positive number" });
      }

      const store = await storage.getStore(storeId);
      if (!store) {
        return res.status(404).json({ error: "Store not found" });
      }

      const tx = await storage.createFinancialTransaction({
        transactionType,
        fromStoreId: transactionType === "MANUAL_EXPENSE" ? storeId : null,
        toStoreId: transactionType === "MANUAL_INCOME" ? storeId : null,
        cashAmount: parsedAmount,
        bankAmount: 0,
        referenceNote: referenceNote || null,
        executedBy: null,
      });

      res.status(201).json(tx);
    } catch (error) {
      console.error("Error creating manual transaction:", error);
      res.status(500).json({ error: "Failed to create manual transaction" });
    }
  });

  app.get("/api/finance/balances", async (req: Request, res: Response) => {
    try {
      const allTx = await storage.getFinancialTransactions(10000);
      const allStores = await storage.getStores();
      const balMap = new Map<string, number>();
      allStores.forEach(s => balMap.set(s.id, 0));

      for (const tx of allTx) {
        if (tx.fromStoreId && balMap.has(tx.fromStoreId)) {
          balMap.set(tx.fromStoreId, balMap.get(tx.fromStoreId)! - tx.cashAmount);
        }
        if (tx.toStoreId && balMap.has(tx.toStoreId)) {
          balMap.set(tx.toStoreId, balMap.get(tx.toStoreId)! + tx.cashAmount);
        }
      }

      const result: Record<string, number> = {};
      allStores.forEach(s => {
        result[s.name] = Math.round((balMap.get(s.id) || 0) * 100) / 100;
      });
      res.json(result);
    } catch (error) {
      console.error("Error calculating balances:", error);
      res.status(500).json({ error: "Failed to calculate balances" });
    }
  });

  app.put("/api/finance/transactions/:id/settle", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const settled = await storage.settleFinancialTransaction(id);
      if (!settled) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error settling transaction:", error);
      res.status(500).json({ error: "Failed to settle transaction" });
    }
  });

  app.post("/api/finance/import-legacy-converts", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileContent = fs.readFileSync(req.file.path, "utf-8");
      const lines = fileContent.split("\n").map(l => l.trim()).filter(l => l.length > 0);

      if (lines.length < 2) {
        return res.status(400).json({ error: "File is empty or has no data rows" });
      }

      const allStores = await storage.getStores();
      const storeByName = new Map<string, string>();
      allStores.forEach(s => storeByName.set(s.name.toLowerCase(), s.id));

      const results = { imported: 0, skipped: 0, errors: [] as string[] };

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 6) {
          results.skipped++;
          continue;
        }

        const description = cols[1]?.trim() || "";
        if (!description.startsWith("CVT. From ")) {
          results.skipped++;
          continue;
        }

        const fromStoreName = description.replace("CVT. From ", "").trim();
        const toStoreName = (cols[2]?.trim()) || "";
        const amount = Math.abs(parseFloat(cols[3]?.trim() || "0"));
        const executedDateStr = (cols[5]?.trim()) || "";

        const fromStoreId = storeByName.get(fromStoreName.toLowerCase());
        const toStoreId = storeByName.get(toStoreName.toLowerCase());

        if (!fromStoreId) {
          results.errors.push(`Row ${i + 1}: From store "${fromStoreName}" not found`);
          continue;
        }
        if (!toStoreId) {
          results.errors.push(`Row ${i + 1}: To store "${toStoreName}" not found`);
          continue;
        }
        if (amount <= 0) {
          results.errors.push(`Row ${i + 1}: Invalid amount`);
          continue;
        }

        let executedAt = new Date();
        if (executedDateStr) {
          const parts = executedDateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
          if (parts) {
            const year = 2000 + parseInt(parts[3]);
            const day = parseInt(parts[1]);
            const month = String(parseInt(parts[2])).padStart(2, "0");
            const dayStr = String(day).padStart(2, "0");
            const hour = parts[4];
            const min = parts[5];
            const sec = parts[6];
            executedAt = new Date(`${year}-${month}-${dayStr}T${hour}:${min}:${sec}+11:00`);
          }
        }

        const isToHO = toStoreName.toLowerCase() === "ho";
        await storage.createFinancialTransactionWithDate({
          transactionType: isToHO ? "REMITTANCE" : "CONVERT",
          fromStoreId,
          toStoreId,
          cashAmount: amount,
          bankAmount: isToHO ? 0 : amount,
          referenceNote: null,
          executedBy: "legacy-import",
          isBankSettled: isToHO ? true : false,
        }, executedAt);
        results.imported++;
      }

      fs.unlinkSync(req.file.path);
      res.json(results);
    } catch (error) {
      console.error("Error importing legacy converts:", error);
      res.status(500).json({ error: "Failed to import legacy data" });
    }
  });

  app.delete("/api/finance/transactions/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteFinancialTransaction(id);
      if (!deleted) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting financial transaction:", error);
      res.status(500).json({ error: "Failed to delete transaction" });
    }
  });

  return httpServer;
}
