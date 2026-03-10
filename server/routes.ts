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

  app.get("/api/payrolls/latest-period", async (req: Request, res: Response) => {
    try {
      const { store_id } = req.query as Record<string, string>;
      if (!store_id) {
        return res.status(400).json({ error: "store_id is required" });
      }
      const assignedEmps = await storage.getEmployeesByStoreAssignment(store_id, "ACTIVE");
      if (assignedEmps.length === 0) {
        return res.json({ periodStart: null, periodEnd: null });
      }
      const empIds = new Set(assignedEmps.map(({ employee }) => employee.id));
      const allPayrolls = await storage.getPayrolls({});
      const storePayrolls = allPayrolls.filter(p => empIds.has(p.employeeId));
      if (storePayrolls.length === 0) {
        return res.json({ periodStart: null, periodEnd: null });
      }
      storePayrolls.sort((a, b) => (b.periodEnd > a.periodEnd ? 1 : -1));
      res.json({ periodStart: storePayrolls[0].periodStart, periodEnd: storePayrolls[0].periodEnd });
    } catch (error) {
      console.error("Error fetching latest period:", error);
      res.status(500).json({ error: "Failed to fetch latest period" });
    }
  });

  app.get("/api/payrolls/current", async (req: Request, res: Response) => {
    try {
      const { store_id, period_start, period_end } = req.query as Record<string, string>;
      if (!store_id || !period_start || !period_end) {
        return res.status(400).json({ error: "store_id, period_start, period_end are required" });
      }

      const assignedEmps = await storage.getEmployeesByStoreAssignment(store_id, "ACTIVE");
      const empMap = new Map<string, { employee: any; assignmentRate?: string; assignmentFixed?: string }>();
      for (const { employee, assignment } of assignedEmps) {
        empMap.set(employee.id, {
          employee,
          assignmentRate: assignment.rate || undefined,
          assignmentFixed: assignment.fixedAmount || undefined,
        });
      }

      const existingPayrolls = await storage.getPayrolls({ periodStart: period_start, periodEnd: period_end });
      const empPayrollMap = new Map<string, any>();
      for (const p of existingPayrolls) {
        if (!empMap.has(p.employeeId)) continue;
        const existing = empPayrollMap.get(p.employeeId);
        if (p.storeId === store_id) {
          empPayrollMap.set(p.employeeId, p);
        } else if (!p.storeId && !existing) {
          empPayrollMap.set(p.employeeId, p);
        }
      }

      const rows = Array.from(empMap.values()).map(({ employee, assignmentRate, assignmentFixed }) => ({
        employee: {
          ...employee,
          rate: assignmentRate || employee.rate,
          fixedAmount: assignmentFixed || employee.fixedAmount,
        },
        payroll: empPayrollMap.get(employee.id) || null,
      }));
      res.json(rows);
    } catch (error) {
      console.error("Error fetching current payroll:", error);
      res.status(500).json({ error: "Failed to fetch current payroll data" });
    }
  });

  app.get("/api/payrolls/envelope-slips", async (req: Request, res: Response) => {
    try {
      const { period_start, period_end, store_id } = req.query as Record<string, string>;
      if (!period_start || !period_end) {
        return res.status(400).json({ error: "period_start and period_end are required" });
      }
      const allPayrolls = await storage.getPayrolls({ periodStart: period_start, periodEnd: period_end });
      const allStores = await storage.getStores();
      const storeMap = new Map(allStores.map(s => [s.id, s]));

      const byEmployee = new Map<string, { employee: any; entries: any[] }>();
      for (const p of allPayrolls) {
        if (store_id && p.storeId !== store_id) continue;
        if (!byEmployee.has(p.employeeId)) {
          const emp = await storage.getEmployee(p.employeeId);
          if (!emp) continue;
          byEmployee.set(p.employeeId, { employee: emp, entries: [] });
        }
        byEmployee.get(p.employeeId)!.entries.push({
          ...p,
          storeName: p.storeId ? storeMap.get(p.storeId)?.name || "Unknown" : "N/A",
        });
      }

      const slips = Array.from(byEmployee.values()).map(({ employee, entries }) => {
        const grandTotals = {
          hours: 0, grossAmount: 0, cashAmount: 0, taxAmount: 0,
          superAmount: 0, bankDepositAmount: 0, totalWithAdjustment: 0,
        };
        for (const e of entries) {
          grandTotals.hours += e.hours;
          grandTotals.grossAmount += e.grossAmount;
          grandTotals.cashAmount += e.cashAmount;
          grandTotals.taxAmount += e.taxAmount;
          grandTotals.superAmount += e.superAmount;
          grandTotals.bankDepositAmount += e.bankDepositAmount;
          grandTotals.totalWithAdjustment += e.totalWithAdjustment;
        }
        return {
          employee: {
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
            nickname: employee.nickname,
            bsb: employee.bsb,
            accountNo: employee.accountNo,
            superCompany: employee.superCompany,
            superMembershipNo: employee.superMembershipNo,
          },
          entries,
          grandTotals,
          periodStart: period_start,
          periodEnd: period_end,
        };
      });

      slips.sort((a, b) => a.employee.name.localeCompare(b.employee.name));
      res.json(slips);
    } catch (error) {
      console.error("Error generating envelope slips:", error);
      res.status(500).json({ error: "Failed to generate envelope slips" });
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

  app.get("/api/employee-store-assignments", async (req: Request, res: Response) => {
    try {
      const { employee_id, store_id } = req.query as Record<string, string>;
      const filters: { employeeId?: string; storeId?: string } = {};
      if (employee_id) filters.employeeId = employee_id;
      if (store_id) filters.storeId = store_id;
      const assignments = await storage.getEmployeeStoreAssignments(filters);
      res.json(assignments);
    } catch (error) {
      console.error("Error fetching store assignments:", error);
      res.status(500).json({ error: "Failed to fetch store assignments" });
    }
  });

  app.put("/api/employees/:id/store-assignments", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { storeIds } = req.body as { storeIds: string[] };
      if (!Array.isArray(storeIds)) {
        return res.status(400).json({ error: "storeIds must be an array" });
      }
      const employee = await storage.getEmployee(id);
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }
      await storage.deleteEmployeeStoreAssignments(id);
      const created = [];
      for (const storeId of storeIds) {
        const assignment = await storage.createEmployeeStoreAssignment({
          employeeId: id,
          storeId,
        });
        created.push(assignment);
      }
      res.json(created);
    } catch (error) {
      console.error("Error updating store assignments:", error);
      res.status(500).json({ error: "Failed to update store assignments" });
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

      const col = (name: string, ...aliases: string[]) => {
        const all = [name, ...aliases];
        return headers.findIndex(h => all.some(a => h === a || h.replace(/[\s_]/g, "") === a.replace(/[\s_]/g, "")));
      };

      const nickIdx = col("nick name", "nickname");
      const firstNameIdx = col("first name", "firstname");
      const lastNameIdx = col("last name", "lastname");
      const nameIdx = col("name", "employee", "employee name", "full name");
      const emailIdx = col("email");
      const phoneIdx = col("phone number", "phone");
      const streetIdx = col("street address");
      const street2Idx = col("street address line 2");
      const cityIdx = col("city", "suburb");
      const stateIdx = col("state");
      const zipIdx = col("zip code", "postcode", "post code");
      const dobIdx = col("dob", "date of birth");
      const genderIdx = col("gender");
      const visaIdx = col("visa");
      const maritalIdx = col("marital status");
      const lineIdx = col("line id", "lineid");
      const disableIdx = col("disable", "disabled");
      const typeIdx = col("type of contact", "typeofcontact");
      const rateIdx = col("rate", "hourly rate");
      const contractIdx = col("contractposition", "contract position");
      const fhcIdx = col("fhc");
      const visaExpIdx = col("visa expire date", "visaexpiredate", "visa expiry");
      const tfnIdx = col("tfn", "tax file number");
      const bsbIdx = col("bsb");
      const accountIdx = col("account no.", "account no", "accountno", "account number");
      const superCompIdx = col("superannuation company name", "super company", "supercompany");
      const superMemIdx = col("superannuation membership number", "super membership no", "supermembershipno");
      const salaryIdx = col("salary");
      const annualLeaveIdx = col("annual leave", "annualleave");
      const storeColIdx = col("store", "store_id", "storeid");
      const fixedSalaryIdx = col("fixed salary", "fixedsalary");
      const fixedAmtIdx = col("fixed amount", "fixedamount");
      const salDistIdx = col("salary distribute", "salarydistribute");

      const allStores = await storage.getStores();
      const allEmployees = await storage.getEmployees({});

      const storeNameMap: Record<string, string> = {};
      const storeAliases: Record<string, string> = {
        "eatem sandwiches": "sandwich",
        "butcher shop": "meat",
        "head office": "ho",
        "sushime": "sushi",
        "cafe": "trading",
        "ck": "trading",
      };
      for (const s of allStores) {
        storeNameMap[s.name.toLowerCase()] = s.id;
        storeNameMap[s.code.toLowerCase()] = s.id;
      }

      const resolveStore = (val: string): string | undefined => {
        if (!val) return undefined;
        const lower = val.toLowerCase().trim();
        if (storeNameMap[lower]) return storeNameMap[lower];
        const alias = storeAliases[lower];
        if (alias && storeNameMap[alias]) return storeNameMap[alias];
        for (const s of allStores) {
          if (s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase())) return s.id;
        }
        return undefined;
      };

      const g = (cols: string[], idx: number) => (idx >= 0 ? (cols[idx] || "").trim() : "");

      const employeeMap = new Map<string, { employee: any; storeAssignments: { storeId: string; rate: string; fixedAmount: string; isFixedSalary: boolean; salaryDistribute: string }[] }>();

      let imported = 0;
      let skipped = 0;
      let assignmentsCreated = 0;
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter).map(c => c.trim());
        let firstName = g(cols, firstNameIdx);
        let lastName = g(cols, lastNameIdx);
        if (!firstName && nameIdx >= 0 && g(cols, nameIdx)) {
          const parts = g(cols, nameIdx).split(/\s+/);
          firstName = parts[0] || "";
          lastName = parts.slice(1).join(" ") || "";
        }
        if (!firstName) {
          skipped++;
          continue;
        }

        const fullKey = `${firstName.toLowerCase()}|${lastName.toLowerCase()}`;
        const disabled = g(cols, disableIdx).toUpperCase() === "TRUE";
        const rate = g(cols, rateIdx);
        const fixedAmount = g(cols, fixedAmtIdx);
        const storeVal = g(cols, storeColIdx);
        const storeId = resolveStore(storeVal);
        const isFixedSalary = g(cols, fixedSalaryIdx).toUpperCase() === "TRUE";
        const salaryDistribute = g(cols, salDistIdx);

        if (!employeeMap.has(fullKey)) {
          employeeMap.set(fullKey, {
            employee: {
              nickname: g(cols, nickIdx) || undefined,
              firstName,
              lastName: lastName || "",
              email: g(cols, emailIdx) || undefined,
              phone: g(cols, phoneIdx) || undefined,
              streetAddress: g(cols, streetIdx) || undefined,
              streetAddress2: g(cols, street2Idx) || undefined,
              suburb: g(cols, cityIdx) || undefined,
              state: g(cols, stateIdx) || undefined,
              postCode: g(cols, zipIdx) || undefined,
              dob: g(cols, dobIdx) || undefined,
              gender: g(cols, genderIdx) || undefined,
              maritalStatus: g(cols, maritalIdx) || undefined,
              visaType: g(cols, visaIdx) || undefined,
              visaExpiry: g(cols, visaExpIdx) || undefined,
              lineId: g(cols, lineIdx) || undefined,
              typeOfContact: g(cols, typeIdx) || undefined,
              rate: rate || undefined,
              contractPosition: g(cols, contractIdx) || undefined,
              fhc: g(cols, fhcIdx) || undefined,
              salaryType: g(cols, salaryIdx) || undefined,
              annualLeave: g(cols, annualLeaveIdx) || undefined,
              fixedAmount: fixedAmount || undefined,
              tfn: g(cols, tfnIdx) || undefined,
              bsb: g(cols, bsbIdx) || undefined,
              accountNo: g(cols, accountIdx) || undefined,
              superCompany: g(cols, superCompIdx) || undefined,
              superMembershipNo: g(cols, superMemIdx) || undefined,
              status: disabled ? "INACTIVE" : "ACTIVE",
            },
            storeAssignments: [],
          });
        }

        const entry = employeeMap.get(fullKey)!;
        if (!disabled) entry.employee.status = "ACTIVE";
        if (storeId) {
          const exists = entry.storeAssignments.some(a => a.storeId === storeId);
          if (!exists) {
            entry.storeAssignments.push({
              storeId,
              rate: rate || "",
              fixedAmount: fixedAmount || "",
              isFixedSalary,
              salaryDistribute,
            });
          }
        }
      }

      for (const [, { employee, storeAssignments }] of employeeMap) {
        const existing = allEmployees.find(
          e => e.firstName.toLowerCase() === employee.firstName.toLowerCase() &&
               e.lastName.toLowerCase() === (employee.lastName || "").toLowerCase()
        );

        let empId: string;

        if (existing) {
          const updateData: Record<string, any> = {};
          for (const [key, val] of Object.entries(employee)) {
            if (val !== undefined && val !== "" && key !== "status") {
              updateData[key] = val;
            }
          }
          if (employee.status === "ACTIVE") updateData.status = "ACTIVE";
          await storage.updateEmployee(existing.id, updateData);
          empId = existing.id;
        } else {
          const created = await storage.createEmployee(employee);
          empId = created.id;
        }

        if (storeAssignments.length > 0) {
          const existingAssignments = await storage.getEmployeeStoreAssignments({ employeeId: empId });
          for (const sa of storeAssignments) {
            const existingForStore = existingAssignments.find(a => a.storeId === sa.storeId);
            if (!existingForStore) {
              await storage.createEmployeeStoreAssignment({
                employeeId: empId,
                storeId: sa.storeId,
                rate: sa.rate || null,
                fixedAmount: sa.fixedAmount || null,
                isFixedSalary: sa.isFixedSalary,
                salaryDistribute: sa.salaryDistribute || null,
              });
              assignmentsCreated++;
            }
          }
        }
        imported++;
      }

      res.json({ imported, skipped, assignmentsCreated, errors });
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
