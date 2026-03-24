import express from "express";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage, generateSecureToken } from "./storage";
import { PAYROLL_CYCLE_ANCHOR, getPayrollCycleStart, getPayrollCycleEnd, shiftDate } from "../shared/payrollCycle";
import { extractPdfText, parseInvoiceWithAI } from "./invoiceParser";
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
  insertDailyCloseFormSchema,
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

const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 3 },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, WebP and PDF are allowed."));
    }
  },
});

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.use("/uploads", (_req, res, next) => {
    res.setHeader("Cache-Control", "public, max-age=31536000");
    next();
  }, express.static(uploadDir));

  app.post("/api/upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const protocol = req.protocol;
      const host = req.get("host");
      const url = `${protocol}://${host}/uploads/${req.file.filename}`;
      res.json({ url, filename: req.file.filename, originalName: req.file.originalname, size: req.file.size });
    } catch (error) {
      res.status(500).json({ error: "Upload failed" });
    }
  });

  // VEVO result document upload with text parsing
  app.post("/api/employees/:id/vevo-upload", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const protocol = req.protocol;
      const host = req.get("host");
      const url = `${protocol}://${host}/uploads/${req.file.filename}`;

      // Attempt to extract VEVO data from the file text (works for text-based PDFs and HTML exports)
      let parsedData: Record<string, string | null> = {};
      try {
        let text = "";

        const ext = req.file.originalname.toLowerCase();
        if (ext.endsWith(".pdf")) {
          // Use pdftotext CLI for clean text extraction from PDF
          const { spawnSync } = await import("child_process");
          const result = spawnSync("pdftotext", [req.file.path, "-"], { encoding: "utf-8", timeout: 15000 });
          if (result.status === 0 && result.stdout) {
            text = result.stdout;
          } else {
            // Fallback: read raw bytes
            const raw = fs.readFileSync(req.file.path);
            text = raw.toString("utf-8");
          }
        } else {
          // Image or HTML: read raw
          const raw = fs.readFileSync(req.file.path);
          text = raw.toString("utf-8");
        }

        const parseDate = (raw: string | undefined | null): string | null => {
          if (!raw) return null;
          const s = raw.trim().replace(/\|/g, "").trim();
          if (!s || /^no\s+fixed\s+date$/i.test(s)) return null;
          const months: Record<string, string> = {
            january: "01", february: "02", march: "03", april: "04",
            may: "05", june: "06", july: "07", august: "08",
            september: "09", october: "10", november: "11", december: "12",
            jan: "01", feb: "02", mar: "03", apr: "04",
            jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
          };
          // "30 September 2026" or "30 Sep 2026"
          const wordy = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
          if (wordy) {
            const m = months[wordy[2].toLowerCase()];
            if (m) return `${wordy[3]}-${m}-${wordy[1].padStart(2, "0")}`;
          }
          // DD/MM/YYYY
          const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (slash) return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
          // YYYY-MM-DD already
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
          return null;
        };

        // Match a field: "Label\n\n\nValue" OR "Label: Value" OR "Label Value" formats
        const get = (pattern: RegExp): string | null => {
          const m = text.match(pattern);
          return m ? m[1]?.trim().replace(/\s+/g, " ") || null : null;
        };

        // Detect work entitlements from the full document (handles condition codes)
        const detectWorkEntitlements = (): string | null => {
          // Check Restricted FIRST — "cannot work more than 48 hours" is Restricted, not No Work Rights
          // Condition 8105 = Student visa work limitation (48 hrs/fortnight)
          // Condition 8104 = Working holiday (limited hours)
          if (/8105|8104|48\s+hours?\s+(a|per)\s+fortnight|work\s+limitation|limited\s+hours/i.test(text)) return "Restricted";
          // Absolute no-work restriction (no hours mentioned)
          if (/not\s+permitted\s+to\s+work|no\s+work\s+right|\bcannot\s+work\s+in\s+australia\b/i.test(text)) return "No Work Rights";
          if (/8101|8108|may\s+work|full\s+work|unlimited|no\s+restriction|unrestricted/i.test(text)) return "Full Work Rights";
          // Fallback: look at the "Work entitlements" section label value
          const inline = get(/[Ww]ork\s+[Ee]ntitlements?\s*:\s*([^\n\r|]+)/i)
            ?? get(/[Ww]ork\s+[Cc]onditions?\s*:\s*([^\n\r|]+)/i);
          if (inline) {
            const s = inline.toLowerCase();
            if (/cannot|no\s+work/.test(s)) return "No Work Rights";
            if (/40\s+hour|fortnight|limited|restricted/.test(s)) return "Restricted";
            if (/may\s+work|full|unlimited/.test(s)) return "Full Work Rights";
          }
          return null;
        };

        parsedData = {
          // VEVO PDF format: "Visa expiry date\n\n30 September 2026"
          visaExpiry: parseDate(
            get(/[Vv]isa\s+expiry\s+date\s*\n[\s\n]*([^\n]+)/i)
            ?? get(/[Ee]xpiry\s+[Dd]ate\s*[:\s]\s*([^\n\r|]+)/i)
            ?? get(/[Ee]xpires?\s*[:\s]\s*([^\n\r|]+)/i)
          ),
          // VEVO PDF format: "Visa class / subclass\n\nTU / 500" → extract "500"
          visaSubclass:
            get(/[Vv]isa\s+class\s*\/\s*subclass\s*\n[\s\n]*[A-Z]+\s*\/\s*(\d+)/i)
            ?? get(/[Vv]isa\s+[Ss]ubclass\s*\n[\s\n]*(\d+)/i)
            ?? get(/[Ss]ubclass\s*[:\s]\s*(\d+)/i)
            ?? get(/\/\s*(\d{3})\b/),
          workEntitlements: detectWorkEntitlements(),
          // VEVO PDF uses "Document number" for passport number
          passportNo:
            get(/[Dd]ocument\s+number\s*\n[\s\n]*([A-Z0-9]+)/i)
            ?? get(/[Pp]assport\s+[Nn]o\s*[:\s]\s*([A-Z0-9]+)/i)
            ?? get(/[Pp]assport\s+[Nn]umber\s*[:\s]\s*([A-Z0-9]+)/i),
          nationality:
            get(/[Nn]ationality\s*\n[\s\n]*([^\n]+)/i)
            ?? get(/[Nn]ationality\s*[:\s]\s*([^\n\r|]+)/i)
            ?? get(/[Cc]ountry\s+of\s+[Pp]assport\s*[:\s]\s*([^\n\r|]+)/i),
        };
      } catch {
        // Parsing failed — return empty parsedData, still save the file
      }

      res.json({ url, filename: req.file.filename, originalName: req.file.originalname, size: req.file.size, parsedData });
    } catch (error) {
      console.error("VEVO upload error:", error);
      res.status(500).json({ error: "Upload failed" });
    }
  });

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

  app.post("/api/direct-register", onboardingUpload, async (req: Request, res: Response) => {
    try {
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

      if (!employeeData.firstName || !employeeData.lastName) {
        return res.status(400).json({ error: "First name and last name are required" });
      }

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

      res.status(201).json({ success: true, id: employee.id, name: `${employee.firstName} ${employee.lastName}` });
    } catch (error) {
      console.error("Error completing direct registration:", error);
      res.status(500).json({ error: "Failed to complete registration" });
    }
  });

  app.post("/api/mobile/auth", async (req: Request, res: Response) => {
    try {
      const { pin } = req.body;
      if (!pin || typeof pin !== "string" || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({ error: "Valid 4-digit PIN required" });
      }
      const employees = await storage.getEmployees({ status: "ACTIVE" });
      const match = employees.find((e: any) => e.pin === pin);
      if (!match) {
        return res.status(401).json({ error: "PIN not recognised" });
      }
      const assignments = await storage.getEmployeeStoreAssignments({ employeeId: match.id });
      const storeIds = assignments.map((a: any) => a.storeId);
      res.json({
        id: match.id,
        name: match.nickname || `${match.firstName} ${match.lastName}`,
        role: match.role ?? "EMPLOYEE",
        storeId: match.storeId ?? null,
        storeIds,
      });
    } catch (error) {
      console.error("Error in mobile auth:", error);
      res.status(500).json({ error: "Authentication failed" });
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
      const assignments = await storage.getEmployeeStoreAssignments({ employeeId: id });
      if (assignments.length <= 1) {
        if (req.body.rate !== undefined) {
          for (const a of assignments) {
            await storage.updateStoreAssignmentFields(a.id, { rate: req.body.rate });
          }
        }
        if (req.body.fixedAmount !== undefined) {
          for (const a of assignments) {
            await storage.updateStoreAssignmentFields(a.id, { fixedAmount: req.body.fixedAmount });
          }
        }
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

  // ===== ROSTER BUILDER ROUTES =====
  // Get employees assigned to a store (for roster grid)
  app.get("/api/rosters/employees", async (req: Request, res: Response) => {
    try {
      const { store_id } = req.query as Record<string, string>;
      if (!store_id) return res.status(400).json({ error: "store_id is required" });
      const assignedEmps = await storage.getEmployeesByStoreAssignment(store_id, "ACTIVE");
      res.json(assignedEmps);
    } catch (error) {
      console.error("Error fetching roster employees:", error);
      res.status(500).json({ error: "Failed to fetch roster employees" });
    }
  });

  app.get("/api/rosters", async (req: Request, res: Response) => {
    try {
      const { storeId, startDate, endDate, employeeId } = req.query as Record<string, string>;
      const items = await storage.getRosters({ storeId, startDate, endDate, employeeId });
      res.json(items);
    } catch (error) {
      console.error("Error fetching rosters:", error);
      res.status(500).json({ error: "Failed to fetch rosters" });
    }
  });

  // Copy previous week's roster into current week for a store
  app.post("/api/rosters/copy-week", async (req: Request, res: Response) => {
    try {
      const { storeId, fromStart, fromEnd, toStart, toEnd } = req.body;
      if (!storeId || !fromStart || !fromEnd || !toStart || !toEnd) {
        return res.status(400).json({ error: "storeId, fromStart, fromEnd, toStart, toEnd are required" });
      }
      const sourceRosters = await storage.getRosters({ storeId, startDate: fromStart, endDate: fromEnd });
      if (sourceRosters.length === 0) {
        return res.json({ copied: 0 });
      }
      const dayDiff = Math.round((new Date(toStart).getTime() - new Date(fromStart).getTime()) / (1000 * 60 * 60 * 24));
      const created = [];
      for (const r of sourceRosters) {
        const srcDate = new Date(r.date);
        srcDate.setDate(srcDate.getDate() + dayDiff);
        const newDate = srcDate.toISOString().split("T")[0];
        if (newDate >= toStart && newDate <= toEnd) {
          const roster = await storage.upsertRoster(r.storeId, r.employeeId, newDate, {
            startTime: r.startTime,
            endTime: r.endTime,
            notes: r.notes,
          });
          created.push(roster);
        }
      }
      res.json({ copied: created.length });
    } catch (error) {
      console.error("Error copying week:", error);
      res.status(500).json({ error: "Failed to copy week" });
    }
  });

  // Upsert a single roster entry (with cross-store overlap check)
  app.post("/api/rosters", async (req: Request, res: Response) => {
    try {
      const { storeId, employeeId, date, startTime, endTime, notes } = req.body;
      if (!storeId || !employeeId || !date || !startTime || !endTime) {
        return res.status(400).json({ error: "storeId, employeeId, date, startTime, endTime are required" });
      }

      // Cross-store overlap check
      const existing = await storage.getRostersByEmployeeAndDateRange(employeeId, date, date);
      const toMins = (t: string) => {
        const [h, m] = t.split(":").map(Number);
        return h * 60 + m;
      };
      const newStart = toMins(startTime);
      const newEnd = toMins(endTime);
      for (const r of existing) {
        if (r.storeId !== storeId) {
          const exStart = toMins(r.startTime);
          const exEnd = toMins(r.endTime);
          if (newStart < exEnd && newEnd > exStart) {
            const store = await storage.getStore(r.storeId);
            return res.status(409).json({
              error: `Overlap Error: Employee is already scheduled at ${store?.name ?? r.storeId} from ${r.startTime} to ${r.endTime} on ${date}`,
            });
          }
        }
      }

      const roster = await storage.upsertRoster(storeId, employeeId, date, { startTime, endTime, notes: notes ?? null });
      res.json(roster);
    } catch (error) {
      console.error("Error upserting roster:", error);
      res.status(500).json({ error: "Failed to save roster" });
    }
  });

  app.delete("/api/rosters/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteRoster(id);
      if (!deleted) return res.status(404).json({ error: "Roster not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting roster:", error);
      res.status(500).json({ error: "Failed to delete roster" });
    }
  });

  // GET published status for a store+week
  app.get("/api/rosters/published", async (req: Request, res: Response) => {
    try {
      const { storeId, weekStart } = req.query as { storeId?: string; weekStart?: string };
      if (!storeId || !weekStart) return res.status(400).json({ error: "storeId and weekStart are required" });
      const published = await storage.isRosterWeekPublished(storeId, weekStart);
      res.json({ published });
    } catch (error) {
      console.error("Error checking roster publish status:", error);
      res.status(500).json({ error: "Failed to check publish status" });
    }
  });

  // Toggle publish/unpublish for a store+week
  app.post("/api/rosters/publish", async (req: Request, res: Response) => {
    try {
      const { storeId, weekStart } = req.body;
      if (!storeId || !weekStart) return res.status(400).json({ error: "storeId and weekStart are required" });
      const published = await storage.toggleRosterWeekPublished(storeId, weekStart);
      res.json({ published });
    } catch (error) {
      console.error("Error toggling roster publish status:", error);
      res.status(500).json({ error: "Failed to toggle publish status" });
    }
  });
  // ===== END ROSTER BUILDER ROUTES =====

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

      // Pull in any employee who has an APPROVED timesheet for this store in the period
      // even if they are not officially assigned here (cross-store coverage)
      const approvedTimesheets = await storage.getShiftTimesheets({ storeId: store_id, status: "APPROVED" });
      const periodTimesheets = approvedTimesheets.filter(
        (ts) => ts.date >= period_start && ts.date <= period_end
      );
      const coverEmployeeIds = new Set<string>();
      for (const ts of periodTimesheets) {
        if (!empMap.has(ts.employeeId)) {
          coverEmployeeIds.add(ts.employeeId);
        }
      }
      for (const coverId of coverEmployeeIds) {
        const emp = await storage.getEmployee(coverId);
        if (emp) {
          empMap.set(coverId, { employee: { ...emp, isCover: true } });
        }
      }

      const existingPayrolls = await storage.getPayrolls({ periodStart: period_start, periodEnd: period_end });
      const empPayrollMap = new Map<string, any>();
      for (const p of existingPayrolls) {
        if (p.storeId === store_id) {
          empPayrollMap.set(p.employeeId, p);
          if (!empMap.has(p.employeeId)) {
            const emp = await storage.getEmployee(p.employeeId);
            if (emp) {
              empMap.set(p.employeeId, { employee: emp });
            }
          }
        } else if (!p.storeId && empMap.has(p.employeeId) && !empPayrollMap.has(p.employeeId)) {
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

  app.get("/api/payrolls/bank-deposits", async (req: Request, res: Response) => {
    try {
      const { period_start, period_end } = req.query as Record<string, string>;
      if (!period_start || !period_end) {
        return res.status(400).json({ error: "period_start and period_end are required" });
      }
      const allPayrolls = await storage.getPayrolls({ periodStart: period_start, periodEnd: period_end });
      const allStores = await storage.getStores();
      const storeMap = new Map(allStores.map(s => [s.id, s]));

      const result = [];
      for (const p of allPayrolls) {
        if (!p.bankDepositAmount || p.bankDepositAmount <= 0) continue;
        const emp = await storage.getEmployee(p.employeeId);
        if (!emp) continue;
        result.push({
          payrollId: p.id,
          employeeName: emp.nickname || `${emp.firstName} ${emp.lastName}`,
          bsb: emp.bsb || "",
          accountNo: emp.accountNo || "",
          storeName: p.storeId ? (storeMap.get(p.storeId)?.name || "Unknown") : "N/A",
          storeId: p.storeId || null,
          bankDepositAmount: p.bankDepositAmount,
          isBankTransferDone: (p as any).isBankTransferDone ?? false,
          bankTransferDate: (p as any).bankTransferDate ?? null,
        });
      }
      result.sort((a, b) => a.storeName.localeCompare(b.storeName) || a.employeeName.localeCompare(b.employeeName));
      res.json(result);
    } catch (error) {
      console.error("Error fetching bank deposits:", error);
      res.status(500).json({ error: "Failed to fetch bank deposits" });
    }
  });

  app.post("/api/payrolls/import-archive", upload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const content = fs.readFileSync(req.file.path, "utf-8");
      fs.unlinkSync(req.file.path);

      const lines = content.split("\n").filter(l => l.trim());
      if (lines.length < 2) {
        return res.status(400).json({ error: "File is empty or has no data rows" });
      }

      const allStores = await storage.getStores();
      const allEmployees = await storage.getEmployees({});

      const storeMap: Record<string, string> = {};
      const storeAliases: Record<string, string> = {
        "eatem sandwiches": "sandwich", "butcher shop": "meat",
        "head office": "ho", "sushime": "sushi", "cafe": "trading", "ck": "trading",
      };
      for (const s of allStores) {
        storeMap[s.name.toLowerCase()] = s.id;
        storeMap[s.code.toLowerCase()] = s.id;
      }
      const resolveStore = (val: string): string | undefined => {
        const lower = val.toLowerCase().trim();
        if (storeMap[lower]) return storeMap[lower];
        const alias = storeAliases[lower];
        if (alias && storeMap[alias]) return storeMap[alias];
        for (const s of allStores) {
          if (s.name.toLowerCase().includes(lower) || lower.includes(s.name.toLowerCase())) return s.id;
        }
        return undefined;
      };

      const empByNickname: Record<string, typeof allEmployees[0]> = {};
      const empByFullName: Record<string, typeof allEmployees[0]> = {};
      const empByFirstName: Record<string, typeof allEmployees[0]> = {};
      for (const emp of allEmployees) {
        if (emp.nickname) empByNickname[emp.nickname.toLowerCase()] = emp;
        empByFullName[`${emp.firstName} ${emp.lastName}`.toLowerCase()] = emp;
        empByFirstName[emp.firstName.toLowerCase()] = emp;
      }
      const resolveEmployee = (name: string): typeof allEmployees[0] | undefined => {
        const lower = name.toLowerCase().trim();
        return empByNickname[lower] || empByFullName[lower] || empByFirstName[lower];
      };

      const parseDDMMYYYY = (val: string): string => {
        const parts = val.trim().split("/");
        if (parts.length !== 3) return val;
        const [d, m, y] = parts;
        const year = y.length === 2 ? `20${y}` : y;
        return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
      };

      const parseNum = (val: string): number => {
        if (!val || val.trim() === "" || val.trim() === "-") return 0;
        const cleaned = val.replace(/[$,]/g, "").trim();
        if (cleaned === "" || /[\/a-zA-Z]/.test(cleaned)) return 0;
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
      };

      const existingPayrolls = await storage.getPayrolls({});
      const existingKey = new Set(
        existingPayrolls.map(p =>
          `${p.employeeId}|${p.storeId || ""}|${p.periodStart}|${p.periodEnd}|${p.hours}|${p.rate}|${p.grossAmount}|${p.cashAmount}`
        )
      );

      const results = { imported: 0, skipped: 0, errors: [] as string[] };

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split("\t");
        if (cols.length < 19) { results.skipped++; continue; }

        const storeName = (cols[5] || "").trim();
        const employeeName = (cols[6] || "").trim();
        const dateFrom = (cols[3] || "").trim();
        const dateTo = (cols[4] || "").trim();

        if (!storeName || !employeeName || !dateFrom || !dateTo) {
          results.errors.push(`Row ${i + 1}: Missing required fields`);
          results.skipped++;
          continue;
        }

        const storeId = resolveStore(storeName);
        if (!storeId) {
          results.errors.push(`Row ${i + 1}: Store "${storeName}" not found`);
          results.skipped++;
          continue;
        }

        const employee = resolveEmployee(employeeName);
        if (!employee) {
          results.errors.push(`Row ${i + 1}: Employee "${employeeName}" not found`);
          results.skipped++;
          continue;
        }

        const periodStart = parseDDMMYYYY(dateFrom);
        const periodEnd = parseDDMMYYYY(dateTo);

        const hours = parseNum(cols[7]);
        const rate = parseNum(cols[8]);
        const fixedAmount = parseNum(cols[9]);
        const calculatedAmount = parseNum(cols[10]);
        const adjustment = parseNum(cols[11]);
        const adjustmentReason = (cols[12] || "").trim() || null;
        const totalWithAdjustment = parseNum(cols[13]);
        const cashAmount = parseNum(cols[14]);
        const grossAmount = parseNum(cols[15]);
        const taxAmount = parseNum(cols[16]);
        const bankDepositAmount = parseNum(cols[17]);
        const superAmount = parseNum(cols[18]);
        const memo = (cols[19] || "").trim() || null;

        const key = `${employee.id}|${storeId}|${periodStart}|${periodEnd}|${hours}|${rate}|${grossAmount}|${cashAmount}`;

        if (existingKey.has(key)) {
          results.skipped++;
          continue;
        }

        try {
          await storage.createPayroll({
            employeeId: employee.id,
            storeId,
            periodStart,
            periodEnd,
            hours, rate, fixedAmount, calculatedAmount, adjustment,
            adjustmentReason, totalWithAdjustment,
            cashAmount, grossAmount, taxAmount, bankDepositAmount, superAmount,
            memo,
          });
          existingKey.add(key);
          results.imported++;
        } catch (err: any) {
          results.errors.push(`Row ${i + 1}: ${err.message}`);
        }
      }

      res.json(results);
    } catch (error) {
      console.error("Error importing payroll archive:", error);
      res.status(500).json({ error: "Failed to import payroll archive" });
    }
  });

  app.patch("/api/payrolls/:id/bank-transfer-status", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { isBankTransferDone } = req.body;
      if (typeof isBankTransferDone !== "boolean") {
        return res.status(400).json({ error: "isBankTransferDone (boolean) is required" });
      }
      const bankTransferDate = isBankTransferDone
        ? (req.body.bankTransferDate || new Date().toISOString().slice(0, 10))
        : null;
      const updated = await storage.updatePayroll(id, { isBankTransferDone, bankTransferDate } as any);
      if (!updated) return res.status(404).json({ error: "Payroll not found" });
      res.json(updated);
    } catch (error) {
      console.error("Error updating bank transfer status:", error);
      res.status(500).json({ error: "Failed to update bank transfer status" });
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

      if (rows.length > 0 && rows[0].storeId && rows[0].periodStart && rows[0].periodEnd) {
        const storeId = rows[0].storeId;
        const periodStart = rows[0].periodStart;
        const periodEnd = rows[0].periodEnd;
        const refNote = `CASH_WAGE:${storeId}:${periodStart}~${periodEnd}`;

        const totalCash = Math.round(
          rows.reduce((sum: number, r: any) => sum + (parseFloat(r.cashAmount) || 0), 0) * 100
        ) / 100;

        // Clean up any duplicate orphaned transactions (safety measure)
        const existingTx = await storage.getFinancialTransactionsByRef(refNote);
        if (existingTx.length > 1) {
          for (const tx of existingTx.slice(1)) {
            await storage.deleteFinancialTransaction(tx.id);
          }
        }

        if (totalCash > 0) {
          // UPSERT: update existing or create new — never double-count
          await storage.upsertFinancialTransactionByRef(refNote, {
            transactionType: "CASH_WAGE",
            fromStoreId: storeId,
            toStoreId: null,
            cashAmount: totalCash,
            bankAmount: 0,
            referenceNote: refNote,
            executedBy: null,
            isBankSettled: false,
          });
        } else if (existingTx.length > 0) {
          // Cash total became 0 — remove the ledger entry entirely
          await storage.deleteFinancialTransaction(existingTx[0].id);
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

  app.patch("/api/employee-store-assignments/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { rate, fixedAmount } = req.body;
      const fields: { rate?: string; fixedAmount?: string } = {};
      if (rate !== undefined) fields.rate = rate;
      if (fixedAmount !== undefined) fields.fixedAmount = fixedAmount;
      await storage.updateStoreAssignmentFields(id, fields);
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating store assignment:", error);
      res.status(500).json({ error: "Failed to update store assignment" });
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
      const selfieUrlIdx = col("selfie url", "selfieurl", "selfie", "profile photo", "profile image", "photo url", "photourl");
      const passportUrlIdx = col("passport url", "passporturl", "passport photo", "passport image", "passport");
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
              selfieUrl: g(cols, selfieUrlIdx) || undefined,
              passportUrl: g(cols, passportUrlIdx) || undefined,
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

  // Photo-only import: only updates selfieUrl / passportUrl for existing employees
  app.post("/api/employees/import-photos", csvUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const raw = req.file.buffer.toString("utf-8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const lines = raw.split("\n").filter(l => l.trim());
      if (lines.length < 2) return res.status(400).json({ error: "File has no data rows" });

      // ── delimiter & headers ─────────────────────────────────────────────────
      const firstLine = lines[0];
      const delimiter = firstLine.includes("\t") ? "\t" : ",";
      // Strip surrounding quotes from each header
      const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());

      // Flexible column finder: normalize spaces / underscores / hyphens
      const normStr = (s: string) => s.replace(/[\s_\-]/g, "");
      const findCol = (name: string, ...aliases: string[]) => {
        const all = [name, ...aliases];
        return headers.findIndex(h => all.some(a => h === a || normStr(h) === normStr(a)));
      };

      // ── column detection ────────────────────────────────────────────────────
      const phoneIdx    = findCol("phone number", "phone", "mobile", "mobile number", "contact number", "phonenumber");
      const nickIdx     = findCol("nick name", "nickname", "nick", "preferred name");
      const firstIdx    = findCol("first name", "firstname", "given name");
      const lastIdx     = findCol("last name", "lastname", "surname", "family name");
      const nameIdx     = findCol("name", "full name", "fullname", "employee", "employee name");

      // ── photo column detection – includes the EXACT Glide column names ──────
      const selfieIdx   = findCol(
        "please show your selfie",                         // exact Glide column
        "selfie url", "selfieurl", "selfie",
        "profile photo", "profile image",
        "photo url", "photourl", "photo",
        "image", "avatar", "pic", "picture",
        "profile pic", "profile picture", "headshot"
      );
      const passportIdx = findCol(
        "passport cover page",                             // exact Glide column
        "passport url", "passporturl",
        "passport photo", "passport image", "passport",
        "visa photo", "id photo", "document", "visa image"
      );

      console.log("[import-photos] headers:", headers);
      console.log("[import-photos] col idx:", { phoneIdx, nickIdx, firstIdx, lastIdx, nameIdx, selfieIdx, passportIdx });

      if (selfieIdx < 0 && passportIdx < 0) {
        return res.status(400).json({
          error: "No selfie or passport photo column found in file",
          hint: 'Expected column names: "Please show your selfie" or "Passport Cover page"',
          detectedHeaders: headers,
        });
      }

      // ── helpers ─────────────────────────────────────────────────────────────

      // Get a cell value, stripping surrounding quotes
      const cell = (cols: string[], idx: number): string =>
        idx >= 0 ? (cols[idx] ?? "").trim().replace(/^"|"$/g, "") : "";

      // Normalize phone → last 9 digits only (handles 0406…, +61406…, 406…)
      const normPhone = (p: string): string => p.replace(/\D/g, "").slice(-9);

      // Extract URL from strings like "filename: ds1.png url: https://…"
      // Also handles plain URLs
      const extractUrl = (val: string): string => {
        const m = val.match(/https?:\/\/\S+/i);
        return m ? m[0].replace(/[,;'")\]]+$/, "") : "";
      };

      // ── load all employees once ─────────────────────────────────────────────
      const allEmployees = await storage.getEmployees({});

      // Build phone-lookup map (last-9 → employee) for O(1) lookup
      const phoneMap = new Map<string, typeof allEmployees[0]>();
      for (const e of allEmployees) {
        if (e.phone) {
          const key = normPhone(e.phone);
          if (key.length >= 7) phoneMap.set(key, e);
        }
      }

      // ── process rows ────────────────────────────────────────────────────────
      let updated = 0;
      let skipped = 0;
      const errors:  string[] = [];
      const matched: string[] = [];
      // Track IDs already updated so duplicate CSV rows (multi-store) don't double-count
      const updatedIds = new Set<string>();

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(delimiter);

        const rawSelfie   = cell(cols, selfieIdx);
        const rawPassport = cell(cols, passportIdx);
        const selfieUrl   = extractUrl(rawSelfie);
        const passportUrl = extractUrl(rawPassport);

        // Skip rows with no photo data at all
        if (!selfieUrl && !passportUrl) { skipped++; continue; }

        // ── find matching employee ─────────────────────────────────────────
        const phoneRaw = cell(cols, phoneIdx);
        const phoneKey = normPhone(phoneRaw);

        let existing = phoneKey.length >= 7 ? phoneMap.get(phoneKey) : undefined;

        // Fallback: name matching
        if (!existing) {
          const nick = cell(cols, nickIdx).toLowerCase();
          let first  = cell(cols, firstIdx).toLowerCase();
          let last   = cell(cols, lastIdx).toLowerCase();
          if (!first && nameIdx >= 0) {
            const parts = cell(cols, nameIdx).split(/\s+/);
            first = parts[0]?.toLowerCase() ?? "";
            last  = parts.slice(1).join(" ").toLowerCase();
          }
          existing = allEmployees.find(e => {
            if (nick && e.nickname?.toLowerCase() === nick) return true;
            if (first && e.firstName.toLowerCase() === first && e.lastName.toLowerCase() === last) return true;
            if (first && e.nickname?.toLowerCase() === first) return true;
            return false;
          });
        }

        if (!existing) {
          const label = phoneRaw || cell(cols, nickIdx) || cell(cols, firstIdx);
          console.log(`[import-photos] row ${i + 1}: no match – phone="${phoneRaw}"`);
          errors.push(`Row ${i + 1}: no employee matched (phone: "${phoneRaw}")`);
          skipped++;
          continue;
        }

        // Build patch – ONLY touch photo fields, never names/stores/rates
        const patch: Record<string, string> = {};
        if (selfieUrl)   patch.selfieUrl   = selfieUrl;
        if (passportUrl) patch.passportUrl = passportUrl;

        await storage.updateEmployee(existing.id, patch);
        if (!updatedIds.has(existing.id)) {
          updatedIds.add(existing.id);
          matched.push(`${existing.nickname ?? existing.firstName} (${phoneRaw})`);
          updated++;
        }
      }

      console.log("[import-photos] done – updated:", updated, "skipped:", skipped);
      res.json({ updated, skipped, errors, matched });
    } catch (error) {
      console.error("Error importing employee photos:", error);
      res.status(500).json({ error: "Failed to import photos" });
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

  app.get("/api/daily-close-forms", async (req: Request, res: Response) => {
    try {
      const filters: { storeId?: string; startDate?: string; endDate?: string } = {};
      if (req.query.store_id && typeof req.query.store_id === "string") filters.storeId = req.query.store_id;
      if (req.query.start_date && typeof req.query.start_date === "string") filters.startDate = req.query.start_date;
      if (req.query.end_date && typeof req.query.end_date === "string") filters.endDate = req.query.end_date;
      const forms = await storage.getDailyCloseForms(filters);
      res.json(forms);
    } catch (error) {
      console.error("Error fetching daily close forms:", error);
      res.status(500).json({ error: "Failed to fetch daily close forms" });
    }
  });

  app.post("/api/daily-close-forms", async (req: Request, res: Response) => {
    try {
      const parsed = insertDailyCloseFormSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const form = await storage.upsertDailyCloseForm(parsed.data.storeId, parsed.data.date, parsed.data);
      res.status(201).json(form);
    } catch (error) {
      console.error("Error creating daily close form:", error);
      res.status(500).json({ error: "Failed to create daily close form" });
    }
  });

  app.get("/api/cash-sales/latest-date", async (req: Request, res: Response) => {
    try {
      const storeId = req.query.store_id as string;
      if (!storeId) return res.status(400).json({ error: "store_id required" });
      const details = await storage.getCashSalesDetails({ storeId });
      if (!details.length) return res.json({ latestDate: null });
      const sorted = details.sort((a, b) => (a.date > b.date ? -1 : 1));
      res.json({ latestDate: sorted[0].date });
    } catch (error) {
      console.error("Error fetching latest cash sales date:", error);
      res.status(500).json({ error: "Failed to fetch latest date" });
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

  app.post("/api/cash-sales/bulk", async (req: Request, res: Response) => {
    try {
      const { storeId, startDate, endDate, rows } = req.body;
      if (!storeId || !startDate || !endDate || !Array.isArray(rows)) {
        return res.status(400).json({ error: "storeId, startDate, endDate, and rows are required" });
      }

      await storage.deleteCashSalesDetailsByStoreAndDateRange(storeId, startDate, endDate);

      const savedRows: any[] = [];
      for (const row of rows) {
        const detail = await storage.createCashSalesDetail({
          storeId,
          date: row.date,
          envelopeAmount: row.envelopeAmount ?? 0,
          countedAmount: row.countedAmount ?? 0,
          note100Count: row.note100Count ?? 0,
          note50Count: row.note50Count ?? 0,
          note20Count: row.note20Count ?? 0,
          note10Count: row.note10Count ?? 0,
          note5Count: row.note5Count ?? 0,
          coin2Count: row.coin2Count ?? 0,
          coin1Count: row.coin1Count ?? 0,
          coin050Count: row.coin050Count ?? 0,
          coin020Count: row.coin020Count ?? 0,
          coin010Count: row.coin010Count ?? 0,
          coin005Count: row.coin005Count ?? 0,
          differenceAmount: row.differenceAmount ?? 0,
        });
        savedRows.push(detail);
      }

      const totalCounted = savedRows.reduce((sum, r) => sum + (r.countedAmount || 0), 0);

      const store = await storage.getStore(storeId);
      const storeName = store?.name || storeId;
      const refNote = `Cash Sales: ${storeName} (${startDate} ~ ${endDate})`;
      const existingTx = await storage.getFinancialTransactionsByRef(refNote);
      for (const tx of existingTx) {
        if (tx.toStoreId === storeId && tx.transactionType === "CASH_SALES") {
          await storage.deleteFinancialTransaction(tx.id);
        }
      }

      if (totalCounted > 0) {
        await storage.createFinancialTransaction({
          transactionType: "CASH_SALES",
          fromStoreId: null,
          toStoreId: storeId,
          cashAmount: Math.round(totalCounted * 100) / 100,
          bankAmount: 0,
          referenceNote: refNote,
          executedBy: null,
          isBankSettled: false,
        });
      }

      res.json({ saved: savedRows.length, totalCounted: Math.round(totalCounted * 100) / 100 });
    } catch (error) {
      console.error("Error bulk saving cash sales:", error);
      res.status(500).json({ error: "Failed to bulk save cash sales" });
    }
  });

  // Void/delete a single day's cash sales entry (cascading: cashSalesDetails + dailyCloseForms + ledger update)
  app.delete("/api/cash-sales/void-day", async (req: Request, res: Response) => {
    try {
      const { storeId, date, periodStart, periodEnd } = req.body;
      if (!storeId || !date) {
        return res.status(400).json({ error: "storeId and date are required" });
      }

      // 1. Delete any cash sales detail record for this exact date
      const cashDeleted = await storage.deleteCashSalesDetailsByStoreAndDateRange(storeId, date, date);

      // 2. Delete the daily close form for this date
      const closeDeleted = await storage.deleteDailyCloseFormByStoreAndDate(storeId, date);

      // 3. Recalculate the period ledger transaction
      if (periodStart && periodEnd) {
        const store = await storage.getStore(storeId);
        const storeName = store?.name || storeId;
        const refNote = `Cash Sales: ${storeName} (${periodStart} ~ ${periodEnd})`;

        // Recalculate remaining total from still-existing cash sales records in this period
        const remaining = await storage.getCashSalesDetails({ storeId, startDate: periodStart, endDate: periodEnd });
        const remainingTotal = remaining.reduce((sum, r) => {
          const amt = typeof r.countedAmount === "string" ? parseFloat(r.countedAmount) : (r.countedAmount ?? 0);
          return sum + amt;
        }, 0);

        // Remove old CASH_SALES transaction for this period
        const existingTx = await storage.getFinancialTransactionsByRef(refNote);
        for (const tx of existingTx) {
          if (tx.toStoreId === storeId && tx.transactionType === "CASH_SALES") {
            await storage.deleteFinancialTransaction(tx.id);
          }
        }

        // Recreate transaction only if there is still data in this period
        if (remainingTotal > 0) {
          await storage.createFinancialTransaction({
            transactionType: "CASH_SALES",
            fromStoreId: null,
            toStoreId: storeId,
            cashAmount: Math.round(remainingTotal * 100) / 100,
            bankAmount: 0,
            referenceNote: refNote,
            executedBy: null,
            isBankSettled: false,
          });
        }
      }

      res.json({ cashDeleted, closeDeleted, message: `Entry for ${date} has been voided.` });
    } catch (error) {
      console.error("Error voiding cash sales day:", error);
      res.status(500).json({ error: "Failed to void entry" });
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

  // ── AP: Invoices with enriched supplier data ─────────────────────────────────
  app.get("/api/invoices", async (req: Request, res: Response) => {
    try {
      const filters: { supplierId?: string; storeId?: string; status?: string } = {};
      if (typeof req.query.supplierId === "string") filters.supplierId = req.query.supplierId;
      if (typeof req.query.storeId === "string") filters.storeId = req.query.storeId;
      if (typeof req.query.status === "string" && req.query.status !== "ALL") filters.status = req.query.status;

      const [invoices, allSuppliers] = await Promise.all([
        storage.getSupplierInvoices(filters),
        storage.getSuppliers(),
      ]);

      const supplierMap = new Map(allSuppliers.map(s => [s.id, s]));
      const enriched = invoices.map(inv => ({
        ...inv,
        supplier: supplierMap.get(inv.supplierId) ?? null,
      }));

      // Sort: PENDING first (by dueDate asc), then others
      enriched.sort((a, b) => {
        const dateA = a.dueDate ?? a.invoiceDate ?? "";
        const dateB = b.dueDate ?? b.invoiceDate ?? "";
        return dateA.localeCompare(dateB);
      });

      res.json(enriched);
    } catch (err) {
      console.error("Error fetching invoices:", err);
      res.status(500).json({ error: "Failed to fetch invoices" });
    }
  });

  app.patch("/api/invoices/:id/status", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const VALID = ["PENDING", "PAID", "OVERDUE", "QUARANTINE"];
      if (!status || !VALID.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(", ")}` });
      }
      const updated = await storage.updateSupplierInvoice(id, { status });
      if (!updated) return res.status(404).json({ error: "Invoice not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating invoice status:", err);
      res.status(500).json({ error: "Failed to update invoice status" });
    }
  });

  // ── Manager Dashboard Summary ─────────────────────────────────────────────
  app.get("/api/dashboard/summary", async (req: Request, res: Response) => {
    try {
      const startDate = req.query.startDate as string | undefined;
      const endDate   = req.query.endDate   as string | undefined;
      const storeId   = req.query.storeId   as string | undefined;

      const [closings, allPayrolls, allInvoices] = await Promise.all([
        storage.getDailyClosings({ storeId, startDate, endDate }),
        storage.getPayrolls({}),
        storage.getSupplierInvoices({ storeId, startDate, endDate }),
      ]);

      // Payrolls that overlap the requested date range
      const filteredPayrolls = allPayrolls.filter(p => {
        if (storeId && p.storeId !== storeId) return false;
        if (startDate && p.periodEnd < startDate) return false;
        if (endDate   && p.periodStart > endDate)  return false;
        return true;
      });

      // Exclude quarantined invoices
      const filteredInvoices = allInvoices.filter(inv => inv.status !== "QUARANTINE");

      const salesTotal  = closings.reduce((s, c) => s + (c.salesTotal  ?? 0), 0);
      const laborTotal  = filteredPayrolls.reduce((s, p) => s + (p.grossAmount ?? 0), 0);
      const cogsTotal   = filteredInvoices.reduce((s, i) => s + (i.amount ?? 0), 0);
      const grossProfit = salesTotal - laborTotal - cogsTotal;

      const pct = (v: number) =>
        salesTotal > 0 ? Math.round((v / salesTotal) * 1000) / 10 : 0;

      // Daily trend: merge daily-closings (sales) and invoices (cogs) by date
      const dateMap = new Map<string, { date: string; sales: number; cogs: number }>();
      for (const c of closings) {
        const row = dateMap.get(c.date) ?? { date: c.date, sales: 0, cogs: 0 };
        row.sales += c.salesTotal ?? 0;
        dateMap.set(c.date, row);
      }
      for (const inv of filteredInvoices) {
        const row = dateMap.get(inv.invoiceDate) ?? { date: inv.invoiceDate, sales: 0, cogs: 0 };
        row.cogs += inv.amount ?? 0;
        dateMap.set(inv.invoiceDate, row);
      }
      const dailyTrend = Array.from(dateMap.values()).sort((a, b) =>
        a.date.localeCompare(b.date)
      );

      res.json({
        salesTotal,
        laborTotal,
        cogsTotal,
        grossProfit,
        laborPercent:       pct(laborTotal),
        cogsPercent:        pct(cogsTotal),
        grossProfitPercent: pct(grossProfit),
        dailyTrend,
      });
    } catch (err) {
      console.error("Error fetching dashboard summary:", err);
      res.status(500).json({ error: "Failed to fetch dashboard summary" });
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

      if (toStore.name.toUpperCase() !== "HO" && !toStore.name.toUpperCase().includes("HEAD OFFICE")) {
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

  // ===== EMPLOYEE PORTAL ROUTES =====

  function getMondayStr(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split("T")[0];
  }

  // GET /api/portal/stores — only Sushi + Sandwich roster stores
  app.get("/api/portal/stores", async (_req: Request, res: Response) => {
    try {
      const all = await storage.getStores();
      const rosterStores = all.filter(s => s.active && !s.isExternal && (s.name === "Sushi" || s.name === "Sandwich"));
      res.json(rosterStores);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch stores" });
    }
  });

  // GET /api/portal/employees?storeId=X — active employees with a PIN set
  app.get("/api/portal/employees", async (req: Request, res: Response) => {
    try {
      const { storeId } = req.query;
      if (!storeId) return res.status(400).json({ error: "storeId required" });
      const assignments = await storage.getEmployeesByStoreAssignment(storeId as string, "ACTIVE");
      const withPin = assignments
        .filter(({ employee: e }) => !!e.pin)
        .map(({ employee: e }) => ({ id: e.id, nickname: e.nickname, firstName: e.firstName, lastName: e.lastName }));
      res.json(withPin);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch employees" });
    }
  });

  // POST /api/portal/login — verify PIN (legacy: takes employeeId + pin)
  app.post("/api/portal/login", async (req: Request, res: Response) => {
    try {
      const { employeeId, pin } = req.body;
      if (!employeeId || !pin) return res.status(400).json({ error: "employeeId and pin required" });
      const emp = await storage.getEmployee(employeeId);
      if (!emp) return res.status(404).json({ error: "Employee not found" });
      if (emp.pin !== String(pin)) return res.status(401).json({ error: "Invalid PIN" });
      res.json({ id: emp.id, nickname: emp.nickname, firstName: emp.firstName, storeId: emp.storeId, selfieUrl: emp.selfieUrl ?? null });
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // POST /api/portal/login-pin — 1-step PIN login (just a PIN, no employee selection)
  app.post("/api/portal/login-pin", async (req: Request, res: Response) => {
    try {
      const { pin } = req.body;
      if (!pin || String(pin).length !== 4) return res.status(400).json({ error: "4-digit PIN required" });
      const emp = await storage.getEmployeeByPin(String(pin));
      if (!emp) return res.status(401).json({ error: "Invalid PIN" });
      res.json({ id: emp.id, nickname: emp.nickname, firstName: emp.firstName, storeId: emp.storeId, selfieUrl: emp.selfieUrl ?? null });
    } catch (err) {
      res.status(500).json({ error: "Login failed" });
    }
  });

  // GET /api/portal/today?employeeId=X&date=YYYY-MM-DD
  // Returns all stores' shifts for this employee today (multi-store support)
  app.get("/api/portal/today", async (req: Request, res: Response) => {
    try {
      const { employeeId, date } = req.query;
      if (!employeeId || !date) return res.status(400).json({ error: "employeeId and date required" });
      const dateStr = date as string;
      const weekStart = getMondayStr(dateStr);

      // Get ALL stores to check publication status
      const allStores = await storage.getStores();

      // Get all rosters for this employee on this date (across all stores)
      const allRosters = await storage.getRosters({ startDate: dateStr, endDate: dateStr, employeeId: employeeId as string });

      // For each shift, check if the week is published for that store
      const shiftsWithMeta = await Promise.all(allRosters.map(async (shift) => {
        const published = await storage.isRosterWeekPublished(shift.storeId, weekStart);
        if (!published) return null;
        const store = allStores.find(s => s.id === shift.storeId);
        const allTimesheets = await storage.getShiftTimesheets({ employeeId: employeeId as string, date: dateStr, storeId: shift.storeId, isUnscheduled: false });
        return {
          shift,
          storeName: store?.name ?? "Unknown",
          storeColor: store?.name === "Sushi" ? "#16a34a" : store?.name === "Sandwich" ? "#dc2626" : "#888",
          timesheet: allTimesheets.length > 0 ? allTimesheets[0] : null,
        };
      }));

      // Also fetch unscheduled timesheets logged today for this employee
      const unscheduledTimesheets = await storage.getShiftTimesheets({ employeeId: employeeId as string, date: dateStr, isUnscheduled: true });
      const unscheduledWithMeta = unscheduledTimesheets.map(ts => {
        const store = allStores.find(s => s.id === ts.storeId);
        return {
          timesheet: ts,
          storeName: store?.name ?? "Unknown",
          storeColor: store?.name === "Sushi" ? "#16a34a" : store?.name === "Sandwich" ? "#dc2626" : "#888",
        };
      });

      const result = shiftsWithMeta.filter(Boolean);
      res.json({ date: dateStr, shifts: result, unscheduledTimesheets: unscheduledWithMeta });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch today's shifts" });
    }
  });

  // GET /api/portal/shift?employeeId=X&storeId=Y&date=YYYY-MM-DD (single day, kept for compat)
  app.get("/api/portal/shift", async (req: Request, res: Response) => {
    try {
      const { employeeId, storeId, date } = req.query;
      if (!employeeId || !storeId || !date) return res.status(400).json({ error: "employeeId, storeId, date required" });
      const weekStart = getMondayStr(date as string);
      const published = await storage.isRosterWeekPublished(storeId as string, weekStart);
      if (!published) return res.json({ shift: null, published: false });
      const rosters = await storage.getRosters({ storeId: storeId as string, startDate: date as string, endDate: date as string, employeeId: employeeId as string });
      const shift = rosters.length > 0 ? rosters[0] : null;
      res.json({ shift, published: true });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch shift" });
    }
  });

  // GET /api/portal/week?employeeId=X&weekStart=YYYY-MM-DD[&storeId=Y]
  // Returns all 7 days of shift + timesheet data for the week.
  // storeId is optional — if omitted, fetches shifts across all stores.
  app.get("/api/portal/week", async (req: Request, res: Response) => {
    try {
      const { employeeId, storeId, weekStart } = req.query;
      if (!employeeId || !weekStart) return res.status(400).json({ error: "employeeId and weekStart required" });
      const weekStartStr = weekStart as string;

      // Compute weekEnd (Sunday = weekStart + 6)
      const wsDate = new Date(weekStartStr + "T00:00:00");
      wsDate.setDate(wsDate.getDate() + 6);
      const weekEnd = wsDate.toISOString().split("T")[0];

      // If storeId provided, check that one store; else check all roster stores
      let published = false;
      let shifts: Awaited<ReturnType<typeof storage.getRosters>> = [];

      if (storeId) {
        published = await storage.isRosterWeekPublished(storeId as string, weekStartStr);
        if (published) {
          shifts = await storage.getRosters({ storeId: storeId as string, startDate: weekStartStr, endDate: weekEnd, employeeId: employeeId as string });
        }
      } else {
        // No storeId — get all shifts for employee, filter by published stores
        const allShifts = await storage.getRosters({ startDate: weekStartStr, endDate: weekEnd, employeeId: employeeId as string });
        const storeIds = [...new Set(allShifts.map(s => s.storeId))];
        const pubChecks = await Promise.all(storeIds.map(sid => storage.isRosterWeekPublished(sid, weekStartStr)));
        const publishedStoreIds = new Set(storeIds.filter((_, i) => pubChecks[i]));
        shifts = allShifts.filter(s => publishedStoreIds.has(s.storeId));
        published = publishedStoreIds.size > 0;
      }

      const timesheets = await storage.getShiftTimesheets({ employeeId: employeeId as string });

      // Build day-by-day map
      const days: Array<{ date: string; shift: typeof shifts[0] | null; timesheet: typeof timesheets[0] | null }> = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(weekStartStr + "T00:00:00");
        d.setDate(d.getDate() + i);
        const dateStr = d.toISOString().split("T")[0];
        const shift = shifts.find(s => s.date === dateStr) ?? null;
        const timesheet = timesheets.find(t => t.date === dateStr) ?? null;
        days.push({ date: dateStr, shift, timesheet });
      }

      res.json({ days, published, weekStart: weekStartStr, weekEnd });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch week data" });
    }
  });

  // GET /api/portal/missed-shifts?employeeId=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  // Returns past published roster entries in the date range that have no timesheet.
  app.get("/api/portal/missed-shifts", async (req: Request, res: Response) => {
    try {
      const { employeeId, startDate: startDateRaw, endDate: endDateRaw } = req.query;
      if (!employeeId) return res.status(400).json({ error: "employeeId required" });

      const toYMD = (d: Date) => d.toISOString().split("T")[0];
      const todayD = new Date();
      const yesterday = new Date(todayD);
      yesterday.setDate(yesterday.getDate() - 1);

      const startDate = (startDateRaw as string) || PAYROLL_CYCLE_ANCHOR;
      const endDate   = (endDateRaw as string)   || toYMD(yesterday);

      // 1. Fetch all rosters for employee in date range
      const allRosters = await storage.getRosters({ employeeId: employeeId as string, startDate, endDate });

      // 2. For each unique (storeId, weekStart) pair, check published status
      const weekStartOf = (dateStr: string) => {
        const d = new Date(dateStr + "T00:00:00");
        const day = d.getDay(); // 0=Sun
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        return d.toISOString().split("T")[0];
      };

      const storeWeekKeys = [...new Set(allRosters.map(r => `${r.storeId}|${weekStartOf(r.date)}`))];
      const pubResults = await Promise.all(
        storeWeekKeys.map(key => {
          const [sid, ws] = key.split("|");
          return storage.isRosterWeekPublished(sid, ws).then(pub => ({ key, pub }));
        })
      );
      const publishedSet = new Set(pubResults.filter(r => r.pub).map(r => r.key));

      // 3. Keep only published rosters
      const publishedRosters = allRosters.filter(r =>
        publishedSet.has(`${r.storeId}|${weekStartOf(r.date)}`)
      );

      // 4. Fetch existing timesheets for employee in range
      const existingTs = await storage.getShiftTimesheets({ employeeId: employeeId as string, startDate, endDate });
      const tsDateSet = new Set(existingTs.map(ts => ts.date));

      // 5. Return rosters without a matching timesheet
      const missed = publishedRosters.filter(r => !tsDateSet.has(r.date));
      missed.sort((a, b) => a.date.localeCompare(b.date));

      res.json(missed.map(r => ({
        date: r.date,
        shift: { id: r.id, storeId: r.storeId, startTime: r.startTime, endTime: r.endTime, date: r.date },
        timesheet: null,
      })));
    } catch (err) {
      console.error("Error fetching missed shifts:", err);
      res.status(500).json({ error: "Failed to fetch missed shifts" });
    }
  });

  // GET /api/portal/cycle-timesheets?employeeId=X&cycleStart=YYYY-MM-DD&cycleEnd=YYYY-MM-DD
  // Returns submitted shift timesheets for the given cycle period.
  // Also returns payrollProcessed: true if a payroll record covers this cycle.
  app.get("/api/portal/cycle-timesheets", async (req: Request, res: Response) => {
    try {
      const { employeeId, cycleStart, cycleEnd } = req.query;
      if (!employeeId || !cycleStart || !cycleEnd) {
        return res.status(400).json({ error: "employeeId, cycleStart, cycleEnd required" });
      }

      const [timesheets, payrolls] = await Promise.all([
        storage.getShiftTimesheets({
          employeeId: employeeId as string,
          startDate: cycleStart as string,
          endDate: cycleEnd as string,
        }),
        storage.getPayrolls({
          employeeId: employeeId as string,
          periodStart: cycleStart as string,
          periodEnd: cycleEnd as string,
        }),
      ]);

      // payroll is "processed" if any payroll record exists for this exact cycle
      const payrollProcessed = payrolls.length > 0;

      res.json({ timesheets, payrollProcessed });
    } catch (err) {
      console.error("Error fetching cycle timesheets:", err);
      res.status(500).json({ error: "Failed to fetch cycle timesheets" });
    }
  });

  // GET /api/portal/history?employeeId=X
  // Returns all payroll cycles (from ANCHOR to current cycle end) with timesheet + payroll status.
  app.get("/api/portal/history", async (req: Request, res: Response) => {
    try {
      const { employeeId } = req.query;
      if (!employeeId) return res.status(400).json({ error: "employeeId required" });

      const today = new Date().toISOString().split("T")[0];
      const currentCycleStart = getPayrollCycleStart(today);
      const currentCycleEnd   = getPayrollCycleEnd(currentCycleStart);

      // Build list of all cycles from anchor to current cycle end
      const cycles: { cycleStart: string; cycleEnd: string }[] = [];
      let cs = PAYROLL_CYCLE_ANCHOR;
      while (cs <= currentCycleStart) {
        const ce = getPayrollCycleEnd(cs);
        cycles.push({ cycleStart: cs, cycleEnd: ce });
        cs = shiftDate(ce, 1);
      }

      // Bulk-fetch all data from anchor to current cycle end
      const [allRosters, allTimesheets, allPayrolls] = await Promise.all([
        storage.getRosters({ employeeId: employeeId as string, startDate: PAYROLL_CYCLE_ANCHOR, endDate: currentCycleEnd }),
        storage.getShiftTimesheets({ employeeId: employeeId as string, startDate: PAYROLL_CYCLE_ANCHOR, endDate: currentCycleEnd }),
        storage.getPayrolls({ employeeId: employeeId as string }),
      ]);

      // Get published-week flags for each (storeId, weekStart) combination in rosters
      const weekMonday = (dateStr: string) => {
        const d = new Date(dateStr + "T00:00:00");
        const dow = d.getDay();
        const diff = dow === 0 ? -6 : 1 - dow;
        d.setDate(d.getDate() + diff);
        return d.toISOString().split("T")[0];
      };
      const storeWeekKeys = [...new Set(allRosters.map(r => `${r.storeId}|${weekMonday(r.date)}`))];
      const pubResults = await Promise.all(
        storeWeekKeys.map(async key => {
          const [sid, ws] = key.split("|");
          const pub = await storage.isRosterWeekPublished(sid, ws);
          return { key, pub };
        })
      );
      const publishedSet = new Set(pubResults.filter(r => r.pub).map(r => r.key));

      // Index timesheets by date
      const tsMap = new Map<string, typeof allTimesheets[0]>();
      allTimesheets.forEach(ts => tsMap.set(ts.date, ts));

      // Index published rosters by date
      const rosterMap = new Map<string, typeof allRosters[0]>();
      allRosters
        .filter(r => publishedSet.has(`${r.storeId}|${weekMonday(r.date)}`))
        .forEach(r => rosterMap.set(r.date, r));

      // Index payrolls by period
      const payrollMap = new Map<string, typeof allPayrolls[0]>();
      allPayrolls.forEach(p => payrollMap.set(p.periodStart, p));

      // Build result cycles (newest first)
      const result = [...cycles].reverse().map(({ cycleStart, cycleEnd }) => {
        const payroll = payrollMap.get(cycleStart) ??
          allPayrolls.find(p => p.periodStart <= cycleStart && p.periodEnd >= cycleStart);

        let cycleStatus: "PAID" | "APPROVED" | "PENDING";
        if (payroll && payroll.isBankTransferDone) cycleStatus = "PAID";
        else if (payroll) cycleStatus = "APPROVED";
        else cycleStatus = "PENDING";

        // Build per-day entries
        const entries: Array<{
          date: string;
          shift: { storeId: string; startTime: string; endTime: string } | null;
          timesheet: typeof allTimesheets[0] | null;
        }> = [];

        // Only include days up to yesterday (can't log today or future from history)
        const lastDate = cycleEnd < today ? cycleEnd : shiftDate(today, -1);

        let d = cycleStart;
        while (d <= lastDate) {
          const roster = rosterMap.get(d);
          const ts = tsMap.get(d);
          if (roster || ts) {
            entries.push({
              date: d,
              shift: roster ? { storeId: roster.storeId, startTime: roster.startTime, endTime: roster.endTime } : null,
              timesheet: ts ?? null,
            });
          }
          d = shiftDate(d, 1);
        }

        return { cycleStart, cycleEnd, cycleStatus, payrollId: payroll?.id ?? null, entries };
      }).filter(c => c.entries.length > 0 || c.cycleStatus !== "PENDING");

      res.json(result);
    } catch (err) {
      console.error("Error fetching portal history:", err);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // GET /api/portal/timesheet?employeeId=X&date=YYYY-MM-DD
  app.get("/api/portal/timesheet", async (req: Request, res: Response) => {
    try {
      const { employeeId, date } = req.query;
      if (!employeeId || !date) return res.status(400).json({ error: "employeeId and date required" });
      const ts = await storage.getShiftTimesheet(employeeId as string, date as string);
      res.json({ timesheet: ts ?? null });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch timesheet" });
    }
  });

  // POST /api/portal/timesheet — submit timesheet
  app.post("/api/portal/timesheet", async (req: Request, res: Response) => {
    try {
      const { storeId, employeeId, date, actualStartTime, actualEndTime, adjustmentReason } = req.body;
      if (!storeId || !employeeId || !date || !actualStartTime || !actualEndTime) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      const existing = await storage.getShiftTimesheet(employeeId, date);
      if (existing) return res.status(409).json({ error: "Timesheet already submitted for today" });
      const ts = await storage.createShiftTimesheet({
        storeId,
        employeeId,
        date,
        actualStartTime,
        actualEndTime,
        adjustmentReason: adjustmentReason ?? null,
        status: "PENDING",
      });
      res.status(201).json(ts);
    } catch (err) {
      res.status(500).json({ error: "Failed to submit timesheet" });
    }
  });

  // POST /api/portal/unscheduled-timesheet — log hours when no roster shift exists
  app.post("/api/portal/unscheduled-timesheet", async (req: Request, res: Response) => {
    try {
      const { storeId, employeeId, date, actualStartTime, actualEndTime, adjustmentReason } = req.body;
      if (!storeId || !employeeId || !date || !actualStartTime || !actualEndTime || !adjustmentReason?.trim()) {
        return res.status(400).json({ error: "storeId, employeeId, date, actualStartTime, actualEndTime, and adjustmentReason are all required" });
      }
      const ts = await storage.createShiftTimesheet({
        storeId,
        employeeId,
        date,
        actualStartTime,
        actualEndTime,
        adjustmentReason: adjustmentReason.trim(),
        status: "PENDING",
        isUnscheduled: true,
      });
      res.status(201).json(ts);
    } catch (err) {
      res.status(500).json({ error: "Failed to log unscheduled shift" });
    }
  });

  // ===== END EMPLOYEE PORTAL ROUTES =====

  // ===== TIMESHEET APPROVAL ROUTES =====

  // GET /api/admin/approvals — enriched shift timesheets with employee, store, scheduled shift
  app.get("/api/admin/approvals", async (req: Request, res: Response) => {
    try {
      const statusFilter = (req.query.status as string) || "PENDING";
      const timesheets = await storage.getShiftTimesheets(statusFilter !== "ALL" ? { status: statusFilter } : {});
      const [allEmployees, allStores, allShifts] = await Promise.all([
        storage.getEmployees(),
        storage.getStores(),
        storage.getShifts(),
      ]);
      const enriched = timesheets.map(ts => {
        const employee = allEmployees.find(e => e.id === ts.employeeId);
        const store = allStores.find(s => s.id === ts.storeId);
        const scheduledShift = allShifts.find(s =>
          s.employeeId === ts.employeeId &&
          s.storeId === ts.storeId &&
          s.date === ts.date
        ) ?? null;
        return {
          ...ts,
          employeeName: employee ? `${employee.firstName} ${employee.lastName}` : "Unknown",
          employeeNickname: employee?.nickname ?? null,
          storeName: store?.name ?? "Unknown",
          storeCode: store?.code ?? "",
          scheduledStartTime: scheduledShift?.startTime ?? null,
          scheduledEndTime: scheduledShift?.endTime ?? null,
        };
      });
      res.json(enriched);
    } catch (err) {
      console.error("Error fetching approvals:", err);
      res.status(500).json({ error: "Failed to fetch approvals" });
    }
  });

  // PUT /api/admin/approvals/:id/approve — approve as-is
  app.put("/api/admin/approvals/:id/approve", async (req: Request, res: Response) => {
    try {
      const ts = await storage.updateShiftTimesheet(req.params.id, { status: "APPROVED" });
      if (!ts) return res.status(404).json({ error: "Timesheet not found" });
      res.json(ts);
    } catch (err) {
      res.status(500).json({ error: "Failed to approve timesheet" });
    }
  });

  // PUT /api/admin/approvals/:id/edit-approve — edit times then approve
  app.put("/api/admin/approvals/:id/edit-approve", async (req: Request, res: Response) => {
    try {
      const { actualStartTime, actualEndTime, adjustmentReason } = req.body;
      if (!actualStartTime || !actualEndTime || !adjustmentReason?.trim()) {
        return res.status(400).json({ error: "actualStartTime, actualEndTime, and adjustmentReason are required" });
      }
      const ts = await storage.updateShiftTimesheet(req.params.id, {
        actualStartTime,
        actualEndTime,
        adjustmentReason: adjustmentReason.trim(),
        status: "APPROVED",
      });
      if (!ts) return res.status(404).json({ error: "Timesheet not found" });
      res.json(ts);
    } catch (err) {
      res.status(500).json({ error: "Failed to edit and approve timesheet" });
    }
  });

  // PUT /api/admin/approvals/:id/update-times — update times only (no status change)
  app.put("/api/admin/approvals/:id/update-times", async (req: Request, res: Response) => {
    try {
      const { actualStartTime, actualEndTime } = req.body;
      if (!actualStartTime || !actualEndTime) {
        return res.status(400).json({ error: "actualStartTime and actualEndTime are required" });
      }
      const ts = await storage.updateShiftTimesheet(req.params.id, { actualStartTime, actualEndTime });
      if (!ts) return res.status(404).json({ error: "Timesheet not found" });
      res.json(ts);
    } catch (err) {
      res.status(500).json({ error: "Failed to update timesheet times" });
    }
  });

  // POST /api/admin/approvals/bulk-approve — bulk approve by IDs
  app.post("/api/admin/approvals/bulk-approve", async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids array is required" });
      }
      const results = await Promise.all(ids.map(id => storage.updateShiftTimesheet(id, { status: "APPROVED" })));
      res.json({ approved: results.filter(Boolean).length });
    } catch (err) {
      res.status(500).json({ error: "Failed to bulk approve timesheets" });
    }
  });

  // POST /api/admin/approvals/auto-fill — create PENDING timesheets for roster entries missing timesheets
  app.post("/api/admin/approvals/auto-fill", async (req: Request, res: Response) => {
    try {
      const { storeId, startDate, endDate } = req.body as { storeId?: string; startDate: string; endDate: string };
      if (!startDate || !endDate) return res.status(400).json({ error: "startDate and endDate are required" });

      // 1. Fetch rosters for the date range (optionally filtered by store)
      const rostersInRange = await storage.getRosters({ storeId: storeId || undefined, startDate, endDate });

      // 2. Fetch existing timesheets for the same range
      const existingTs = await storage.getShiftTimesheets({ storeId: storeId || undefined, startDate, endDate });
      const existingSet = new Set(existingTs.map(ts => `${ts.employeeId}|${ts.date}`));

      // 3. Find missing ones and create them
      const missing = rostersInRange.filter(r => !existingSet.has(`${r.employeeId}|${r.date}`));

      const created = await Promise.all(
        missing.map(r =>
          storage.createShiftTimesheet({
            storeId: r.storeId,
            employeeId: r.employeeId,
            date: r.date,
            actualStartTime: r.startTime,
            actualEndTime: r.endTime,
            status: "PENDING",
            isUnscheduled: false,
            adjustmentReason: null,
          })
        )
      );

      res.json({ filled: created.length });
    } catch (err) {
      console.error("Error auto-filling timesheets:", err);
      res.status(500).json({ error: "Failed to auto-fill timesheets" });
    }
  });

  // ===== END TIMESHEET APPROVAL ROUTES =====

  // ── Weekly Payroll Summary ──────────────────────────────────────────────────
  // GET /api/admin/weekly-payroll?weekStart=YYYY-MM-DD[&storeId=]
  // Returns approved shiftTimesheets for the Mon-Sun week, enriched with
  // employee hourly rate and calculated gross pay.
  app.get("/api/admin/weekly-payroll", async (req: Request, res: Response) => {
    try {
      const { weekStart, storeId } = req.query as { weekStart?: string; storeId?: string };

      if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
        return res.status(400).json({ error: "weekStart (YYYY-MM-DD) is required" });
      }

      // Calculate weekEnd = weekStart + 6 days (Sunday, inclusive through 23:59:59)
      const startD = new Date(weekStart + "T00:00:00");
      const endD = new Date(startD);
      endD.setDate(startD.getDate() + 6);
      const weekEnd = endD.toISOString().slice(0, 10);

      // Fetch all approved shiftTimesheets, optionally filtered by store
      const filters: { status: string; storeId?: string } = { status: "APPROVED" };
      if (storeId && storeId !== "ALL") filters.storeId = storeId;
      const allApproved = await storage.getShiftTimesheets(filters);

      // Filter to week range (date strings sort lexicographically as ISO dates)
      const weekTimesheets = allApproved.filter(ts => ts.date >= weekStart && ts.date <= weekEnd);

      const [allEmployees, allStores] = await Promise.all([
        storage.getEmployees(),
        storage.getStores(),
      ]);

      const calcHoursFromTimes = (start: string, end: string): number => {
        const [sh, sm] = start.split(":").map(Number);
        const [eh, em] = end.split(":").map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        return diff < 0 ? (diff + 1440) / 60 : diff / 60;
      };

      const enriched = weekTimesheets.map(ts => {
        const employee = allEmployees.find(e => e.id === ts.employeeId);
        const store = allStores.find(s => s.id === ts.storeId);
        const rate = parseFloat(employee?.rate || "0");
        const hours = Math.round(calcHoursFromTimes(ts.actualStartTime, ts.actualEndTime) * 100) / 100;
        const grossPay = Math.round(hours * rate * 100) / 100;

        return {
          id: ts.id,
          date: ts.date,
          storeId: ts.storeId,
          storeName: store?.name ?? "Unknown",
          storeCode: store?.code ?? "",
          employeeId: ts.employeeId,
          employeeName: employee ? `${employee.firstName} ${employee.lastName}` : "Unknown",
          employeeNickname: employee?.nickname ?? null,
          actualStartTime: ts.actualStartTime,
          actualEndTime: ts.actualEndTime,
          adjustmentReason: ts.adjustmentReason,
          isUnscheduled: ts.isUnscheduled,
          hours,
          rate,
          grossPay,
        };
      });

      // Sort by store then date then employee
      enriched.sort((a, b) => {
        if (a.storeName !== b.storeName) return a.storeName.localeCompare(b.storeName);
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.employeeName.localeCompare(b.employeeName);
      });

      const totalHours = Math.round(enriched.reduce((s, t) => s + t.hours, 0) * 100) / 100;
      const totalGrossPay = Math.round(enriched.reduce((s, t) => s + t.grossPay, 0) * 100) / 100;

      // Per-store subtotals
      const storeMap = new Map<string, { storeId: string; storeName: string; storeCode: string; totalHours: number; totalGrossPay: number; shiftCount: number }>();
      for (const t of enriched) {
        const key = t.storeId;
        if (!storeMap.has(key)) {
          storeMap.set(key, { storeId: t.storeId, storeName: t.storeName, storeCode: t.storeCode, totalHours: 0, totalGrossPay: 0, shiftCount: 0 });
        }
        const s = storeMap.get(key)!;
        s.totalHours = Math.round((s.totalHours + t.hours) * 100) / 100;
        s.totalGrossPay = Math.round((s.totalGrossPay + t.grossPay) * 100) / 100;
        s.shiftCount += 1;
      }

      res.json({
        weekStart,
        weekEnd,
        timesheets: enriched,
        storeSubtotals: Array.from(storeMap.values()),
        summary: {
          totalShifts: enriched.length,
          totalHours,
          totalGrossPay,
        },
      });
    } catch (err) {
      console.error("Error fetching weekly payroll:", err);
      res.status(500).json({ error: "Failed to fetch weekly payroll" });
    }
  });

  // ── AP: Inbound Invoice Email Webhook (Resend) ───────────────────────────────
  // Receives inbound email events from Resend inbound routing.
  // Filters by known supplier contactEmails (whitelist).
  app.post("/api/webhooks/inbound-invoices", async (req: Request, res: Response) => {
    try {
      const payload = req.body;

      // ── 1. Extract sender email (Cloudmailin format) ─────────────────────────
      // Use ONLY headers.from — envelope.from contains Gmail forwarding artifacts
      // (e.g. peter.kang+caf_=...@eatem.com.au) and must NOT be used for matching.
      // headers.from format: `"Display Name" <email@domain.com>` or plain `email@domain.com`
      const rawHeaderFrom: string = payload?.headers?.from ?? "";
      const angleMatch = rawHeaderFrom.match(/<([^>]+)>/);
      const senderEmail = (angleMatch ? angleMatch[1] : rawHeaderFrom)
        .trim()
        .toLowerCase();

      console.log("Cleaned Original Sender:", senderEmail);

      if (!senderEmail) {
        console.warn("[Webhook/inbound-invoices] Could not extract sender email from payload");
        return res.status(200).json({ received: true, action: "ignored", reason: "no_sender" });
      }

      // ── 2. Extract subject and attachments (Cloudmailin format) ──────────────
      const subject: string = payload?.headers?.subject ?? "(no subject)";

      // Cloudmailin attachments: array under payload.attachments
      // Each item has: file_name, content_type, content (base64), size
      const attachments: any[] = Array.isArray(payload?.attachments) ? payload.attachments : [];
      const hasAttachment = attachments.length > 0;

      // ── 3. Whitelist check ───────────────────────────────────────────────────
      const matchedSupplier = await storage.findSupplierByEmail(senderEmail);

      if (!matchedSupplier) {
        // Unknown sender
        if (!hasAttachment) {
          console.log(`[Webhook/inbound-invoices] Unknown sender, no attachment — ignored: ${senderEmail}`);
          return res.status(200).json({ received: true, action: "ignored", reason: "no_attachment" });
        }
        // Unknown sender WITH attachment → quarantine
        console.log(`[Webhook/inbound-invoices] Unknown sender with attachment — quarantining: ${senderEmail}`);
        await storage.createQuarantinedEmail({
          senderEmail,
          subject,
          hasAttachment: true,
          rawPayload: JSON.stringify(payload),
        });
        return res.status(200).json({ received: true, action: "quarantined", sender: senderEmail });
      }

      // ── 4. Known supplier: find the first PDF attachment ─────────────────────
      console.log(`[Webhook/inbound-invoices] Matched supplier: ${matchedSupplier.name} (${senderEmail})`);

      if (!hasAttachment) {
        console.log(`[Webhook/inbound-invoices] No attachments from known supplier — logged only`);
        return res.status(200).json({ received: true, action: "matched_no_attachment", supplier: matchedSupplier.name });
      }

      // Find first PDF attachment
      // Cloudmailin uses: file_name, content_type, content (base64)
      const pdfAttachment = attachments.find((a: any) => {
        const name: string = a.file_name ?? a.filename ?? a.name ?? "";
        const type: string = a.content_type ?? a.contentType ?? a.mimeType ?? a.type ?? "";
        return name.toLowerCase().endsWith(".pdf") || type.toLowerCase().includes("pdf");
      });

      if (!pdfAttachment) {
        console.log(`[Webhook/inbound-invoices] No PDF found in attachments from ${senderEmail}`);
        return res.status(200).json({ received: true, action: "matched_no_pdf", supplier: matchedSupplier.name });
      }

      // ── 5. Decode PDF buffer and extract text ────────────────────────────────
      let pdfBuffer: Buffer;
      const rawContent = pdfAttachment.content ?? pdfAttachment.data ?? pdfAttachment.body ?? "";

      if (typeof rawContent === "string") {
        pdfBuffer = Buffer.from(rawContent, "base64");
      } else if (Buffer.isBuffer(rawContent)) {
        pdfBuffer = rawContent;
      } else {
        console.warn("[Webhook/inbound-invoices] Cannot decode PDF attachment content");
        return res.status(200).json({ received: true, action: "error", reason: "unreadable_pdf" });
      }

      let pdfText: string;
      try {
        pdfText = extractPdfText(pdfBuffer);
        console.log(`[Webhook/inbound-invoices] Extracted ${pdfText.length} chars from PDF`);
        if (!pdfText.trim()) {
          console.warn("[Webhook/inbound-invoices] PDF text extraction returned empty result");
          return res.status(200).json({ received: true, action: "error", reason: "pdf_parse_failed" });
        }
      } catch (pdfErr) {
        console.error("[Webhook/inbound-invoices] PDF extraction failed:", pdfErr);
        return res.status(200).json({ received: true, action: "error", reason: "pdf_parse_failed" });
      }

      // ── 6. AI extraction (returns array for statements) ──────────────────────
      const parsedItems = await parseInvoiceWithAI(pdfText, matchedSupplier.name);

      if (!parsedItems || parsedItems.length === 0) {
        console.warn(`[Webhook/inbound-invoices] AI could not extract invoice data for ${matchedSupplier.name}`);
        return res.status(200).json({ received: true, action: "ai_parse_failed", supplier: matchedSupplier.name });
      }

      console.log(`[Webhook/inbound-invoices] AI extracted ${parsedItems.length} invoice(s) for ${matchedSupplier.name}`);

      // ── 7. Load stores for storeCode → storeId mapping ───────────────────────
      const allStores = await storage.getStores();
      const sushiStore = allStores.find(s => s.name.toLowerCase().includes("sushi"));
      const sandwichStore = allStores.find(s => s.name.toLowerCase().includes("sandwich"));

      function resolveStoreId(code: string): string | null {
        if (code === "SUSHI" && sushiStore) return sushiStore.id;
        if (code === "SANDWICH" && sandwichStore) return sandwichStore.id;
        return null;
      }

      // ── 8. Duplicate check + create one record per invoice ───────────────────
      const existing = await storage.getSupplierInvoices({ supplierId: matchedSupplier.id });
      const existingNumbers = new Set(existing.map(inv => inv.invoiceNumber));

      const created: string[] = [];
      const skipped: string[] = [];

      for (const parsed of parsedItems) {
        if (!parsed.invoiceNumber && !parsed.issueDate && !parsed.totalAmount) continue;

        if (parsed.invoiceNumber && existingNumbers.has(parsed.invoiceNumber)) {
          console.log(`[Webhook/inbound-invoices] Duplicate skipped: ${parsed.invoiceNumber}`);
          skipped.push(parsed.invoiceNumber);
          continue;
        }

        const newInvoice = await storage.createSupplierInvoice({
          supplierId: matchedSupplier.id,
          storeId: resolveStoreId(parsed.storeCode),
          invoiceNumber: parsed.invoiceNumber,
          invoiceDate: parsed.issueDate,
          dueDate: parsed.dueDate ?? undefined,
          amount: parsed.totalAmount,
          status: "PENDING",
          notes: `Auto-imported via email from ${senderEmail}. Subject: ${subject}`,
        });

        console.log(`[Webhook/inbound-invoices] Created invoice ${newInvoice.id} (#${parsed.invoiceNumber}) store=${parsed.storeCode}`);
        created.push(newInvoice.id);
      }

      return res.status(200).json({
        received: true,
        action: "invoices_created",
        created: created.length,
        skipped: skipped.length,
        supplier: matchedSupplier.name,
      });

    } catch (err) {
      console.error("[Webhook/inbound-invoices] Unhandled error:", err);
      // Always return 200 to Resend so it does not retry endlessly
      return res.status(200).json({ received: true, action: "error" });
    }
  });

  // ── Notices ───────────────────────────────────────────────────────────────────
  app.get("/api/notices", async (req: Request, res: Response) => {
    try {
      const storeId   = req.query.storeId   as string | undefined;
      const activeOnly = req.query.activeOnly === "true";
      const list = await storage.getNotices({ storeId, activeOnly });
      res.json(list);
    } catch (err) {
      console.error("Error fetching notices:", err);
      res.status(500).json({ error: "Failed to fetch notices" });
    }
  });

  app.post("/api/notices", async (req: Request, res: Response) => {
    try {
      const { insertNoticeSchema } = await import("@shared/schema");
      const parsed = insertNoticeSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
      const notice = await storage.createNotice(parsed.data);
      res.status(201).json(notice);
    } catch (err) {
      console.error("Error creating notice:", err);
      res.status(500).json({ error: "Failed to create notice" });
    }
  });

  app.put("/api/notices/:id", async (req: Request, res: Response) => {
    try {
      const notice = await storage.updateNotice(req.params.id, req.body);
      if (!notice) return res.status(404).json({ error: "Notice not found" });
      res.json(notice);
    } catch (err) {
      console.error("Error updating notice:", err);
      res.status(500).json({ error: "Failed to update notice" });
    }
  });

  app.delete("/api/notices/:id", async (req: Request, res: Response) => {
    try {
      const ok = await storage.deleteNotice(req.params.id);
      if (!ok) return res.status(404).json({ error: "Notice not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting notice:", err);
      res.status(500).json({ error: "Failed to delete notice" });
    }
  });

  // ── AP: Quarantined emails (admin read) ──────────────────────────────────────
  app.get("/api/webhooks/quarantined-emails", async (_req: Request, res: Response) => {
    try {
      const emails = await storage.getQuarantinedEmails();
      res.json(emails);
    } catch (err) {
      console.error("Error fetching quarantined emails:", err);
      res.status(500).json({ error: "Failed to fetch quarantined emails" });
    }
  });

  return httpServer;
}

// ── Payroll Cycle Auto-Submit ─────────────────────────────────────────────────
// Called on server startup + periodically.
// For all roster entries in CLOSED payroll cycles (before current cycle start)
// that are published but have no timesheet → auto-create PENDING timesheets.
export async function autoSubmitExpiredCycleShifts(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const currentCycleStart = getPayrollCycleStart(today);
  const expiredEnd = shiftDate(currentCycleStart, -1);   // last day of previous cycle

  if (expiredEnd < PAYROLL_CYCLE_ANCHOR) return; // nothing to process yet

  const expiredStart = PAYROLL_CYCLE_ANCHOR;

  // 1. All rosters in expired range
  const rosters = await storage.getRosters({ startDate: expiredStart, endDate: expiredEnd });
  if (rosters.length === 0) return;

  // 2. Check published status per (store, week)
  const weekMonday = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split("T")[0];
  };

  const storeWeekKeys = [...new Set(rosters.map(r => `${r.storeId}|${weekMonday(r.date)}`))];
  const pubResults = await Promise.all(
    storeWeekKeys.map(async key => {
      const [sid, ws] = key.split("|");
      const pub = await storage.isRosterWeekPublished(sid, ws);
      return { key, pub };
    })
  );
  const publishedSet = new Set(pubResults.filter(r => r.pub).map(r => r.key));

  const publishedRosters = rosters.filter(r =>
    publishedSet.has(`${r.storeId}|${weekMonday(r.date)}`)
  );
  if (publishedRosters.length === 0) return;

  // 3. Existing timesheets in expired range
  const existingTs = await storage.getShiftTimesheets({ startDate: expiredStart, endDate: expiredEnd });
  const existingSet = new Set(existingTs.map(ts => `${ts.employeeId}|${ts.date}`));

  // 4. Auto-submit missing ones
  const missing = publishedRosters.filter(r => !existingSet.has(`${r.employeeId}|${r.date}`));
  if (missing.length === 0) return;

  console.log(`[payroll-cycle] Auto-submitting ${missing.length} shift(s) from closed cycle(s)...`);
  await Promise.all(
    missing.map(r =>
      storage.createShiftTimesheet({
        storeId: r.storeId,
        employeeId: r.employeeId,
        date: r.date,
        actualStartTime: r.startTime,
        actualEndTime: r.endTime,
        status: "PENDING",
        isUnscheduled: false,
        adjustmentReason: "Auto-submitted (payroll cycle closed)",
      })
    )
  );
  console.log(`[payroll-cycle] Done — ${missing.length} timesheet(s) auto-submitted.`);
}
