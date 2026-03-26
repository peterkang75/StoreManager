import express from "express";
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage, generateSecureToken } from "./storage";
import { PAYROLL_CYCLE_ANCHOR, getPayrollCycleStart, getPayrollCycleEnd, shiftDate } from "../shared/payrollCycle";
import { extractPdfText, parseInvoiceWithAI, parseUploadedFile, parseInvoiceFromUnknownSender, triageEmail, summarizeTaskFromEmail, classifyDocumentForAP } from "./invoiceParser";
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
      const empMap = new Map<string, { employee: any; assignmentRate?: string; assignmentFixed?: string; assignmentIsFixedSalary?: boolean }>();
      for (const { employee, assignment } of assignedEmps) {
        empMap.set(employee.id, {
          employee,
          assignmentRate: assignment.rate || undefined,
          assignmentFixed: assignment.fixedAmount || undefined,
          assignmentIsFixedSalary: assignment.isFixedSalary ?? false,
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

      // Build a map of totalEmployeeFixed: the maximum fixedAmount found across ALL store
      // assignments for each employee. This is needed so secondary stores (where
      // assignmentFixed = 0) can still detect the employee as a fixed-salary worker.
      const allAssignments = await storage.getEmployeeStoreAssignments();
      const empTotalFixedMap = new Map<string, number>();
      for (const a of allAssignments) {
        if (!empMap.has(a.employeeId)) continue;
        const fixed = parseFloat(a.fixedAmount || "0");
        if (fixed > 0) {
          empTotalFixedMap.set(a.employeeId, Math.max(empTotalFixedMap.get(a.employeeId) ?? 0, fixed));
        }
      }
      // Also include the global employee.fixedAmount as a fallback
      for (const [empId, { employee }] of empMap) {
        const globalFixed = parseFloat(employee.fixedAmount || "0");
        if (globalFixed > 0) {
          empTotalFixedMap.set(empId, Math.max(empTotalFixedMap.get(empId) ?? 0, globalFixed));
        }
      }

      // Build a map of which store is the PRIMARY payer for each fixed-salary employee.
      // Pass 1: explicit — the assignment that has fixedAmount > 0 is primary.
      // Pass 2: fallback — if no assignment has fixedAmount set but the employee's
      //         global fixedAmount > 0, treat the FIRST assignment as primary.
      //         This handles legacy data where fixedAmount was only on the employee record.
      const empPrimaryStoreIdMap = new Map<string, string>();
      for (const a of allAssignments) {
        if (!empMap.has(a.employeeId)) continue;
        const fixed = parseFloat(a.fixedAmount || "0");
        if (fixed > 0 && !empPrimaryStoreIdMap.has(a.employeeId)) {
          empPrimaryStoreIdMap.set(a.employeeId, a.storeId);
        }
      }
      for (const [empId, { employee }] of empMap) {
        if (empPrimaryStoreIdMap.has(empId)) continue;
        const globalFixed = parseFloat(employee.fixedAmount || "0");
        if (globalFixed > 0) {
          // No per-assignment fixed set — fall back to first assignment for this employee
          const firstAssignment = allAssignments.find(a => a.employeeId === empId);
          if (firstAssignment) {
            empPrimaryStoreIdMap.set(empId, firstAssignment.storeId);
          }
        }
      }

      const rows = Array.from(empMap.values()).map(({ employee, assignmentRate, assignmentFixed }) => {
        const currentStoreFixed = parseFloat(String(assignmentFixed ?? "0") || "0");
        const currentStoreRate  = parseFloat(String(assignmentRate  ?? "0") || "0");
        const totalFixed = empTotalFixedMap.get(employee.id) ?? 0;
        // isPrimaryStore: true if THIS store's assignment has fixedAmount > 0,
        // OR as a fallback, if no assignment has fixedAmount but this store is the
        // designated primary (first assignment) for the employee.
        const isPrimaryStore = currentStoreFixed > 0
          || (totalFixed > 0 && currentStoreFixed === 0
              && empPrimaryStoreIdMap.get(employee.id) === store_id);
        return {
          employee: {
            ...employee,
            rate: assignmentRate || employee.rate,
            fixedAmount: assignmentFixed || employee.fixedAmount,
            // isPrimaryStore: true  = this store has fixedAmount on its assignment (primary payer)
            // isPrimaryStore: false = secondary store
            isPrimaryStore,
            // totalEmployeeFixed: max fixedAmount across all assignments (for intercompany calc)
            totalEmployeeFixed: totalFixed,
            // currentStoreRate: the assignment-specific rate for THIS store.
            // > 0 means "Dual Role" — paid directly hourly here, NOT intercompany.
            currentStoreRate,
          },
          payroll: empPayrollMap.get(employee.id) || null,
        };
      });
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

      const result: any[] = [];

      // List A: Direct employee bank deposits
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
          isIntercompany: false,
          destinationStoreName: null,
        });
      }

      // List B: Intercompany settlements where fromStore has a payroll in this period
      const periodPayrollIds = new Set(allPayrolls.map(p => p.id));
      let allSettlements = await storage.getIntercompanySettlements();
      let periodSettlements = allSettlements.filter(
        s => periodPayrollIds.has(s.payrollId) && s.status !== "CANCELLED"
      );

      // ── Auto-generate settlements if they are missing for this period ─────
      // This handles payrolls that were saved before the settlement generation fix.
      const fixedPayrollsInPeriod = allPayrolls.filter(
        p => p.fixedAmount && parseFloat(String(p.fixedAmount)) > 0
      );
      if (periodSettlements.length === 0 && fixedPayrollsInPeriod.length > 0) {
        for (const savedPayroll of fixedPayrollsInPeriod) {
          const { employeeId, storeId: payingStoreId } = savedPayroll;
          const fixedAmt = parseFloat(String(savedPayroll.fixedAmount));

          const allSheets = await storage.getShiftTimesheets({
            employeeId,
            startDate: period_start,
            endDate: period_end,
            status: "APPROVED",
          });

          const hoursByStore: Record<string, number> = {};
          for (const sheet of allSheets) {
            const [sh, sm] = (sheet.actualStartTime || "0:0").split(":").map(Number);
            const [eh, em] = (sheet.actualEndTime || "0:0").split(":").map(Number);
            const diffMins = eh * 60 + em - (sh * 60 + sm);
            const hrs = (diffMins < 0 ? diffMins + 1440 : diffMins) / 60;
            hoursByStore[sheet.storeId] = Math.round(((hoursByStore[sheet.storeId] || 0) + hrs) * 100) / 100;
          }

          const totalHours = Object.values(hoursByStore).reduce((a, b) => a + b, 0);
          if (totalHours <= 0) continue;

          const allAssignments = await storage.getEmployeeStoreAssignments({ employeeId });
          const dualRoleStoreIds = new Set(
            allAssignments
              .filter((a) => {
                const aRate  = parseFloat(String(a.rate  ?? "0") || "0");
                const aFixed = parseFloat(String(a.fixedAmount ?? "0") || "0");
                return aRate > 0 && aFixed === 0 && a.storeId !== payingStoreId;
              })
              .map((a) => a.storeId)
          );

          for (const [storeId, hours] of Object.entries(hoursByStore)) {
            if (storeId === payingStoreId) continue;
            if (hours <= 0) continue;
            if (dualRoleStoreIds.has(storeId)) continue;
            const portion = hours / totalHours;
            const amountDue = Math.round(fixedAmt * portion * 100) / 100;
            await storage.createIntercompanySettlement({
              payrollId: savedPayroll.id,
              employeeId,
              fromStoreId: storeId,
              toStoreId: payingStoreId,
              totalAmountDue: amountDue,
              paidInCash: 0,
              paidInBank: 0,
              status: "PENDING",
            });
          }
        }
        // Reload after auto-generation
        allSettlements = await storage.getIntercompanySettlements();
        periodSettlements = allSettlements.filter(
          s => periodPayrollIds.has(s.payrollId) && s.status !== "CANCELLED"
        );
      }

      for (const s of periodSettlements) {
        if (s.totalAmountDue <= 0) continue;
        const emp = await storage.getEmployee(s.employeeId);
        const fromStore = storeMap.get(s.fromStoreId);
        const toStore = storeMap.get(s.toStoreId);
        result.push({
          payrollId: `ics_${s.id}`,
          employeeName: emp ? (emp.nickname || `${emp.firstName} ${emp.lastName}`) : "Unknown",
          bsb: "",
          accountNo: "",
          storeName: fromStore?.name ?? "Unknown",
          storeId: s.fromStoreId,
          bankDepositAmount: s.totalAmountDue,
          isBankTransferDone: s.status === "SETTLED",
          bankTransferDate: s.settledAt ? new Date(s.settledAt).toISOString().split("T")[0] : null,
          isIntercompany: true,
          destinationStoreName: toStore?.name ?? "Unknown",
        });
      }

      result.sort((a, b) => a.storeName.localeCompare(b.storeName) || a.employeeName.localeCompare(b.employeeName));
      res.json(result);
    } catch (error) {
      console.error("Error fetching bank deposits:", error);
      res.status(500).json({ error: "Failed to fetch bank deposits" });
    }
  });

  // Toggle intercompany settlement bank-transfer done status
  app.patch("/api/settlements/:id/bank-transfer-status", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { isBankTransferDone } = req.body as { isBankTransferDone: boolean };
      const allSettlements = await storage.getIntercompanySettlements();
      const settlement = allSettlements.find(s => s.id === id);
      if (!settlement) return res.status(404).json({ error: "Settlement not found" });
      const updated = await storage.updateIntercompanySettlement(id,
        isBankTransferDone
          ? { status: "SETTLED", settledAt: new Date(), paidInBank: settlement.totalAmountDue }
          : { status: "PENDING", settledAt: null, paidInBank: 0 }
      );
      if (!updated) return res.status(404).json({ error: "Settlement not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating settlement bank-transfer status:", err);
      res.status(500).json({ error: "Failed to update settlement status" });
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

      // ── Intercompany guard: zero out direct-pay fields for true intercompany rows.
      // A row is TRUE intercompany only when ALL three conditions hold:
      //   1. The employee has a fixed salary at some other store (primaryStores.size > 0)
      //   2. The store being saved is NOT that primary store
      //   3. The employee has NO direct hourly rate at this store (not a Dual Role employee)
      // Dual Role employees (rate > 0 at this store) must be saved normally.
      const uniqueEmpIds = [...new Set(rows.map((r: any) => r.employeeId).filter(Boolean))];
      // Per employee: track primary stores (fixedAmount > 0) and direct-rate stores (rate > 0)
      const assignmentsByEmp = new Map<string, { primaryStores: Set<string>; directRateStores: Set<string> }>();
      for (const empId of uniqueEmpIds) {
        const assignments = await storage.getEmployeeStoreAssignments({ employeeId: empId });
        const primaryStores = new Set(
          assignments
            .filter(a => parseFloat(String(a.fixedAmount ?? "0") || "0") > 0)
            .map(a => a.storeId)
        );
        const directRateStores = new Set(
          assignments
            .filter(a => parseFloat(String(a.rate ?? "0") || "0") > 0)
            .map(a => a.storeId)
        );
        assignmentsByEmp.set(empId, { primaryStores, directRateStores });
      }
      // Helper: returns true ONLY for true intercompany rows (not Dual Role)
      const isIntercompanyRow = (row: any): boolean => {
        const info = assignmentsByEmp.get(row.employeeId);
        if (!info || info.primaryStores.size === 0) return false; // no fixed salary → not intercompany
        if (info.primaryStores.has(row.storeId)) return false;    // this IS the primary store → not intercompany
        if (info.directRateStores.has(row.storeId)) return false; // Dual Role: has hourly rate here → save normally
        return true; // fixed salary elsewhere, no direct rate here → true intercompany
      };
      // Zero-out enforcer for intercompany rows
      const enforceIntercompanyZero = (row: any) => ({
        ...row,
        calculatedAmount: 0,
        grossAmount: 0,
        cashAmount: 0,
        bankDepositAmount: 0,
        taxAmount: 0,
        superAmount: 0,
        totalWithAdjustment: row.totalWithAdjustment, // keep the intercompany transfer amount
      });

      const results = [];
      for (const rawRow of rows) {
        const row = isIntercompanyRow(rawRow) ? enforceIntercompanyZero(rawRow) : rawRow;
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

      // ── Intercompany Settlement Generation ───────────────────────────────
      // For any payroll row that has a fixedAmount > 0, check if this employee
      // also logged hours at OTHER stores in this period. If so, create/update
      // settlements so the secondary store reimburses the primary (paying) store.
      const primaryStoreId = rows.length > 0 ? rows[0].storeId : null;
      const periodStart = rows.length > 0 ? rows[0].periodStart : null;
      const periodEnd = rows.length > 0 ? rows[0].periodEnd : null;

      if (primaryStoreId && periodStart && periodEnd) {
        for (const savedPayroll of results) {
          if (!savedPayroll.fixedAmount || parseFloat(String(savedPayroll.fixedAmount)) <= 0) continue;

          const employeeId = savedPayroll.employeeId;
          const payingStoreId = savedPayroll.storeId;
          const fixedAmt = parseFloat(String(savedPayroll.fixedAmount));

          // Get ALL approved shiftTimesheets for this employee in this period (across all stores)
          const allSheets = await storage.getShiftTimesheets({
            employeeId,
            startDate: periodStart,
            endDate: periodEnd,
            status: "APPROVED",
          });

          // Group hours by storeId — compute from actualStartTime/actualEndTime
          // (ShiftTimesheet schema has no pre-computed totalHours field)
          const hoursByStore: Record<string, number> = {};
          for (const sheet of allSheets) {
            const [sh, sm] = (sheet.actualStartTime || "0:0").split(":").map(Number);
            const [eh, em] = (sheet.actualEndTime || "0:0").split(":").map(Number);
            const diffMins = eh * 60 + em - (sh * 60 + sm);
            const hrs = (diffMins < 0 ? diffMins + 1440 : diffMins) / 60;
            hoursByStore[sheet.storeId] = Math.round(((hoursByStore[sheet.storeId] || 0) + hrs) * 100) / 100;
          }

          const totalHours = Object.values(hoursByStore).reduce((a, b) => a + b, 0);
          if (totalHours <= 0) continue;

          // Remove existing settlements for this payroll (regenerate fresh)
          const existing = await storage.getIntercompanySettlements({ payrollId: savedPayroll.id });
          for (const old of existing) {
            await storage.updateIntercompanySettlement(old.id, { status: "CANCELLED" });
          }

          // Load all store assignments for this employee once (for dual-role detection)
          const allAssignments = await storage.getEmployeeStoreAssignments({ employeeId });
          // Build a set of storeIds where the employee has a direct hourly rate (Dual Role).
          // Dual Role = secondary store assignment that has rate > 0 but no fixedAmount.
          // These stores pay the employee directly; they do NOT owe an intercompany settlement.
          const dualRoleStoreIds = new Set(
            allAssignments
              .filter((a) => {
                const aRate  = parseFloat(String(a.rate  ?? "0") || "0");
                const aFixed = parseFloat(String(a.fixedAmount ?? "0") || "0");
                return aRate > 0 && aFixed === 0 && a.storeId !== payingStoreId;
              })
              .map((a) => a.storeId)
          );

          // Create a settlement for each OTHER store that benefited from the employee,
          // EXCEPT stores where the employee is paid directly by hourly rate (Dual Role).
          for (const [storeId, hours] of Object.entries(hoursByStore)) {
            if (storeId === payingStoreId) continue;
            if (hours <= 0) continue;
            // Dual Role override: this store pays the employee directly — no intercompany owed
            if (dualRoleStoreIds.has(storeId)) continue;
            const portion = hours / totalHours;
            const amountDue = Math.round(fixedAmt * portion * 100) / 100;
            await storage.createIntercompanySettlement({
              payrollId: savedPayroll.id,
              employeeId,
              fromStoreId: storeId,        // store that benefited (owes)
              toStoreId: payingStoreId,     // store that paid the salary
              totalAmountDue: amountDue,
              paidInCash: 0,
              paidInBank: 0,
              status: "PENDING",
            });
          }
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

  app.delete("/api/suppliers/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteSupplier(id);
      if (!deleted) {
        return res.status(404).json({ error: "Supplier not found" });
      }
      res.json({ deleted: true });
    } catch (error) {
      console.error("Error deleting supplier:", error);
      res.status(500).json({ error: "Failed to delete supplier" });
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

      // ── Backend safety net: block manual PAID marking of Auto-Pay invoices ──
      // Auto-Pay (Direct Debit) invoices are settled automatically via the webhook.
      // Manually marking them as PAID risks creating a false double-payment record.
      // The frontend already prevents selection, but this guard catches any bypass.
      // Exception: PENDING / OVERDUE / QUARANTINE transitions are still allowed
      // (needed for bounced direct debit workflows).
      if (status === "PAID") {
        const invoice = await storage.getSupplierInvoice(id);
        if (invoice?.supplierId) {
          const supplier = await storage.getSupplier(invoice.supplierId);
          if (supplier?.isAutoPay === true) {
            console.warn(`[Safety] Blocked manual PAID on auto-pay invoice ${id} (supplier: ${supplier.name})`);
            return res.status(409).json({
              error: "This invoice belongs to a Direct Debit supplier and cannot be manually marked as paid.",
              code: "AUTO_PAY_PROTECTED",
            });
          }
        }
      }

      const updated = await storage.updateSupplierInvoice(id, { status });
      if (!updated) return res.status(404).json({ error: "Invoice not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error updating invoice status:", err);
      res.status(500).json({ error: "Failed to update invoice status" });
    }
  });

  // ── Invoice: AI parse upload ──────────────────────────────────────────────
  const invoiceUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.mimetype);
      cb(null, ok);
    },
  });

  app.post("/api/invoices/parse-upload", invoiceUpload.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const results = await parseUploadedFile(req.file.buffer, req.file.mimetype);
      if (!results || results.length === 0) return res.status(422).json({ error: "Could not extract invoice data from file" });

      // Try to fuzzy-match supplier name to an existing supplier (use first item's supplier name)
      const allSuppliers = await storage.getSuppliers();
      const nameLower = (results[0].supplierName ?? "").toLowerCase();
      const matched = nameLower
        ? allSuppliers.find(s =>
            s.name.toLowerCase().includes(nameLower) ||
            nameLower.includes(s.name.toLowerCase())
          )
        : undefined;

      const isStatement = results.length > 1;
      res.json({
        items: results,
        matchedSupplierId: matched?.id ?? null,
        isStatement,
      });
    } catch (err) {
      console.error("[parse-upload] error:", err);
      res.status(500).json({ error: "Failed to parse invoice" });
    }
  });

  // ── Invoice: create (AP dashboard) ───────────────────────────────────────
  app.post("/api/invoices", async (req: Request, res: Response) => {
    try {
      // Check auto-pay status of the supplier before setting invoice status
      let invoiceStatus = "PENDING";
      let supplierForAutoPay: Supplier | undefined;
      if (req.body.supplierId) {
        supplierForAutoPay = await storage.getSupplier(req.body.supplierId);
        if (supplierForAutoPay?.isAutoPay) invoiceStatus = "PAID";
      }

      const parsed = insertSupplierInvoiceSchema.safeParse({ ...req.body, status: invoiceStatus });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
      const invoice = await storage.createSupplierInvoice(parsed.data);

      // Auto-pay: create payment record immediately
      if (supplierForAutoPay?.isAutoPay && invoice.supplierId) {
        const today = new Date().toISOString().split("T")[0];
        await storage.createSupplierPayment({
          supplierId: invoice.supplierId,
          invoiceId: invoice.id,
          paymentDate: invoice.invoiceDate ?? today,
          amount: invoice.amount ?? 0,
          method: "AUTO_DEBIT",
          notes: "Automatic direct debit — manual entry",
        });
      }

      res.status(201).json(invoice);
    } catch (err: any) {
      // Unique constraint violation → 409 so the frontend can distinguish from real errors
      const isUniqueViolation =
        err?.code === "23505" ||                          // PostgreSQL unique_violation
        err?.message?.includes("unique") ||
        err?.message?.includes("duplicate") ||
        err?.message?.includes("already exists");
      if (isUniqueViolation) {
        const invoiceNumber = req.body?.invoiceNumber ?? "unknown";
        console.warn(`[POST /api/invoices] duplicate invoice: ${invoiceNumber}`);
        return res.status(409).json({ error: "DUPLICATE_INVOICE", invoiceNumber });
      }
      console.error("[POST /api/invoices] error:", err);
      res.status(500).json({ error: "Failed to create invoice" });
    }
  });

  // ── Invoice: revert PAID → PENDING (escape hatch for bounced auto-debits) ──
  app.post("/api/invoices/:id/revert", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getSupplierInvoice(id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });
      if (invoice.status !== "PAID") {
        return res.status(400).json({ error: "Only PAID invoices can be reverted" });
      }
      // Delete ALL payment records for this invoice
      await storage.deleteSupplierPaymentsByInvoiceId(id);
      // Revert invoice back to PENDING
      const updated = await storage.updateSupplierInvoice(id, { status: "PENDING" });
      res.json(updated);
    } catch (err) {
      console.error("[POST /api/invoices/:id/revert] error:", err);
      res.status(500).json({ error: "Failed to revert invoice" });
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

  // Serve stored PDF (base64 from rawExtractedData.pdfBase64)
  app.get("/api/supplier-invoices/:id/pdf", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const invoice = await storage.getSupplierInvoice(id);
      if (!invoice) return res.status(404).json({ error: "Invoice not found" });

      const raw = invoice.rawExtractedData as any;
      const b64 = raw?.pdfBase64 as string | undefined;
      if (!b64) return res.status(404).json({ error: "No PDF stored for this invoice" });

      const buf = Buffer.from(b64, "base64");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="invoice-${invoice.invoiceNumber ?? id}.pdf"`);
      res.setHeader("Content-Length", buf.length);
      return res.send(buf);
    } catch (err) {
      console.error("Error serving invoice PDF:", err);
      return res.status(500).json({ error: "Failed to serve PDF" });
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

  app.get("/api/supplier-invoices/deleted", async (req: Request, res: Response) => {
    try {
      const deleted = await storage.getSupplierInvoices({ status: "DELETED" });
      const allSuppliers = await storage.getSuppliers();
      const supplierMap = new Map(allSuppliers.map(s => [s.id, s]));
      const enriched = deleted.map(inv => ({ ...inv, supplier: supplierMap.get(inv.supplierId ?? "") ?? null }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching deleted invoices:", error);
      res.status(500).json({ error: "Failed to fetch deleted invoices" });
    }
  });

  app.patch("/api/supplier-invoices/:id/soft-delete", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const current = await storage.getSupplierInvoice(id);
      if (!current) return res.status(404).json({ error: "Supplier invoice not found" });
      const updated = await storage.updateSupplierInvoice(id, {
        status: "DELETED",
        previousStatus: current.status,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error soft-deleting invoice:", error);
      res.status(500).json({ error: "Failed to delete invoice" });
    }
  });

  app.patch("/api/supplier-invoices/:id/restore", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const current = await storage.getSupplierInvoice(id);
      if (!current) return res.status(404).json({ error: "Supplier invoice not found" });
      const restoreStatus = current.previousStatus ?? "PENDING";
      const updated = await storage.updateSupplierInvoice(id, {
        status: restoreStatus,
        previousStatus: null,
      });
      res.json(updated);
    } catch (error) {
      console.error("Error restoring invoice:", error);
      res.status(500).json({ error: "Failed to restore invoice" });
    }
  });

  // PATCH /api/supplier-invoices/:id/reassign
  // Reassigns an invoice to a different supplier. Used to fix misclassified invoices.
  app.patch("/api/supplier-invoices/:id/reassign", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { supplierId } = req.body as { supplierId: string };
      if (!supplierId) return res.status(400).json({ error: "supplierId is required" });

      const inv = await storage.getSupplierInvoice(id);
      if (!inv) return res.status(404).json({ error: "Invoice not found" });

      const supplier = await storage.getSupplier(supplierId);
      if (!supplier) return res.status(404).json({ error: "Supplier not found" });

      const updated = await storage.updateSupplierInvoice(id, { supplierId });
      console.log(`[Reassign] Invoice ${id} (${inv.invoiceNumber}) → supplier "${supplier.name}" (${supplierId})`);
      res.json(updated);
    } catch (error) {
      console.error("Error reassigning invoice:", error);
      res.status(500).json({ error: "Failed to reassign invoice" });
    }
  });

  // POST /api/supplier-invoices/:id/reparse-pdf
  // Re-runs parseInvoiceFromUnknownSender on the stored pdfBase64 for a REVIEW invoice.
  // Used when the AI previously missed some invoice rows (e.g. future-dated rows).
  app.post("/api/supplier-invoices/:id/reparse-pdf", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const inv = await storage.getSupplierInvoice(id);
      if (!inv) return res.status(404).json({ error: "Invoice not found" });
      if (inv.status !== "REVIEW") return res.status(400).json({ error: "Invoice is not in REVIEW status" });

      const raw = inv.rawExtractedData as any;
      const pdfBase64: string | undefined = raw?.pdfBase64;
      if (!pdfBase64) return res.status(400).json({ error: "No PDF stored for this invoice" });

      const buf = Buffer.from(pdfBase64, "base64");
      const pdfText = await extractPdfText(buf);
      if (!pdfText.trim()) return res.status(400).json({ error: "Could not extract text from stored PDF" });

      const reparsed = await parseInvoiceFromUnknownSender(pdfText);
      if (!reparsed?.invoices?.length) {
        return res.status(422).json({ error: "Re-parse did not return any invoices" });
      }

      // Merge back: keep existing supplier/senderEmail/subject/pdfBase64, update invoices
      const updated = await storage.updateSupplierInvoice(id, {
        rawExtractedData: {
          ...raw,
          supplier: reparsed.supplier,
          invoices: reparsed.invoices,
        },
      });

      console.log(`[reparse-pdf] Invoice ${id}: re-extracted ${reparsed.invoices.length} invoice items`);
      res.json({ invoiceCount: reparsed.invoices.length, supplier: reparsed.supplier, updated });
    } catch (error) {
      console.error("Error re-parsing invoice PDF:", error);
      res.status(500).json({ error: "Failed to re-parse invoice PDF" });
    }
  });

  app.delete("/api/supplier-invoices/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteSupplierInvoice(id);
      if (!deleted) {
        return res.status(404).json({ error: "Supplier invoice not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting supplier invoice:", error);
      res.status(500).json({ error: "Failed to delete supplier invoice" });
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
      const { transactionType, storeId, amount, referenceNote, category } = req.body;

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
        category: category || null,
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
      // REJECTED is an internal tombstone — never surface it in the approvals list
      const rawTimesheets = await storage.getShiftTimesheets(statusFilter !== "ALL" ? { status: statusFilter } : {});
      const timesheets = rawTimesheets.filter((ts: any) => ts.status !== "REJECTED");
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

  // DELETE /api/admin/approvals/:id — permanently remove a shift timesheet record
  // PATCH /api/admin/approvals/:id/reject — soft-delete: mark as REJECTED (tombstone)
  app.patch("/api/admin/approvals/:id/reject", async (req: Request, res: Response) => {
    try {
      const ts = await storage.updateShiftTimesheet(req.params.id, { status: "REJECTED" });
      if (!ts) return res.status(404).json({ error: "Timesheet not found" });
      res.json(ts);
    } catch (err) {
      console.error("Error rejecting timesheet:", err);
      res.status(500).json({ error: "Failed to reject timesheet" });
    }
  });

  app.delete("/api/admin/approvals/:id", async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteShiftTimesheet(req.params.id);
      if (!success) return res.status(404).json({ error: "Timesheet not found" });
      res.json({ success: true });
    } catch (err) {
      console.error("Error deleting timesheet:", err);
      res.status(500).json({ error: "Failed to delete timesheet" });
    }
  });

  // POST /api/admin/approvals/add-shift — manager manually adds a missing approved shift
  app.post("/api/admin/approvals/add-shift", async (req: Request, res: Response) => {
    try {
      const { storeId, employeeId, date, actualStartTime, actualEndTime } = req.body;
      if (!storeId || !employeeId || !date || !actualStartTime || !actualEndTime) {
        return res.status(400).json({ error: "storeId, employeeId, date, actualStartTime, and actualEndTime are required" });
      }
      const ts = await storage.createShiftTimesheet({
        storeId,
        employeeId,
        date,
        actualStartTime,
        actualEndTime,
        status: "APPROVED",
        isUnscheduled: true,
        adjustmentReason: "Added by manager",
      });
      res.status(201).json(ts);
    } catch (err) {
      console.error("Error adding missing shift:", err);
      res.status(500).json({ error: "Failed to add shift" });
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

  // POST /api/admin/approvals/bulk-revert — revert APPROVED timesheets back to PENDING
  app.post("/api/admin/approvals/bulk-revert", async (req: Request, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "ids array is required" });
      }
      const results = await Promise.all(ids.map(id => storage.updateShiftTimesheet(id, { status: "PENDING" })));
      res.json({ reverted: results.filter(Boolean).length });
    } catch (err) {
      res.status(500).json({ error: "Failed to revert timesheets" });
    }
  });

  // POST /api/admin/approvals/auto-fill — create PENDING timesheets for roster entries missing timesheets
  app.post("/api/admin/approvals/auto-fill", async (req: Request, res: Response) => {
    try {
      const { storeId, startDate, endDate } = req.body as { storeId?: string; startDate: string; endDate: string };
      if (!startDate || !endDate) return res.status(400).json({ error: "startDate and endDate are required" });

      // 1. Fetch rosters for the date range (optionally filtered by store)
      const rostersInRange = await storage.getRosters({ storeId: storeId || undefined, startDate, endDate });

      // 2. Fetch ALL existing timesheets for the same range (no status filter — includes REJECTED
      //    tombstones so we never resurrect a shift the manager already dismissed).
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

  // ── AP: Inbound Invoice Email Webhook (Cloudmailin) ─────────────────────────
  // Receives inbound email events from Cloudmailin.
  // Route: POST /api/webhooks/inbound-invoices
  // Always responds 200 so Cloudmailin does not retry endlessly.
  // ══════════════════════════════════════════════════════════════════════════════
  // INBOUND EMAIL WEBHOOK — Human-Trained Rules Engine (deterministic routing)
  // Replaces the old GPT-4o triage step with manager-defined routing rules.
  //
  // Rule actions:
  //   ROUTE_TO_AP   — This sender sends invoices → AP pipeline
  //   ROUTE_TO_TODO — This sender sends tasks    → Smart Inbox / todos
  //   FYI_ARCHIVE   — Informational only         → silently acknowledge
  //   SPAM_DROP     — Junk / unsubscribe         → silently drop
  //   (none)        — Unknown sender             → save to Universal Inbox for human triage
  //
  // Legacy rules (backward-compatible):
  //   ALLOW  → treated as ROUTE_TO_AP
  //   IGNORE → treated as SPAM_DROP
  //
  // ┌─────────────────────────────────────────────────────────────────────────┐
  // │              CORE INVARIANT RULES — DO NOT VIOLATE                     │
  // │  Rule 1 (AP):   An invoice CANNOT be PENDING without a supplierId.     │
  // │                 No supplierId → status MUST be REVIEW. Always.         │
  // │  Rule 2 (Task): A TASK email MUST NEVER enter the AP pipeline.         │
  // │                 It belongs ONLY in the todos table / Smart Inbox.      │
  // └─────────────────────────────────────────────────────────────────────────┘

  // ── Webhook deduplication ────────────────────────────────────────────────
  // Email providers retry on slow responses. We deduplicate by Message-ID
  // (or fallback: sha hash of sender+subject). Entries expire after 10 minutes.
  const _webhookProcessed = new Map<string, number>(); // key → timestamp
  const WEBHOOK_DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

  app.post("/api/webhooks/inbound-invoices", async (req: Request, res: Response) => {
    try {
      // ── Body parsing ─────────────────────────────────────────────────────────
      let payload = req.body;
      if (!payload || Object.keys(payload).length === 0) {
        try {
          const raw = (req as any).rawBody;
          if (raw) payload = JSON.parse(raw.toString("utf-8"));
        } catch (_) {}
      }

      console.log("[Webhook] Received POST — Content-Type:", req.headers["content-type"]);

      // ── Deduplication: prevent processing the same email twice ───────────────
      // Email providers retry on slow responses (AI processing can take 3–8s).
      // We use Message-ID (globally unique per RFC 2822) as the dedup key.
      // Fallback: hash of sender+subject for providers that strip Message-ID.
      {
        const msgId: string = (
          payload?.headers?.["message-id"] ??
          payload?.headers?.["Message-ID"] ??
          payload?.headers?.message_id ??
          payload?.message_id ??
          ""
        ).toString().trim();

        const rawFrom = (payload?.headers?.from ?? payload?.from ?? "").toString().trim();
        const rawSubj = (payload?.headers?.subject ?? payload?.subject ?? "").toString().trim();
        // Generate a stable dedup key
        const dedupKey = msgId
          ? `msgid:${msgId}`
          : `fallback:${rawFrom}|${rawSubj}`;

        // Purge expired entries (older than 10 minutes)
        const now = Date.now();
        for (const [k, ts] of _webhookProcessed.entries()) {
          if (now - ts > WEBHOOK_DEDUP_TTL_MS) _webhookProcessed.delete(k);
        }

        if (_webhookProcessed.has(dedupKey)) {
          console.log(`[Webhook] DUPLICATE detected (${dedupKey}) — returning 200 immediately`);
          return res.status(200).json({ received: true, action: "duplicate_skipped", dedupKey });
        }
        _webhookProcessed.set(dedupKey, now);
        console.log(`[Webhook] Dedup key registered: ${dedupKey}`);
      }

      // ── Extract sender (use headers.from only — envelope.from has Gmail artifacts) ──
      const rawHeaderFrom: string = payload?.headers?.from ?? "";
      const angleMatch = rawHeaderFrom.match(/<([^>]+)>/);
      let senderEmail = (angleMatch ? angleMatch[1] : rawHeaderFrom).trim().toLowerCase();
      console.log("[Webhook] Sender:", senderEmail);

      if (!senderEmail) {
        return res.status(200).json({ received: true, action: "ignored", reason: "no_sender" });
      }

      // ── Extract subject, body, attachments ────────────────────────────────────
      let subject: string = payload?.headers?.subject ?? "(no subject)";
      const emailBody: string = payload?.plain ?? payload?.html?.replace(/<[^>]*>/g, " ") ?? "";
      const attachments: any[] = Array.isArray(payload?.attachments) ? payload.attachments : [];
      const hasAttachment = attachments.length > 0;

      // ── Smart Forward Detector ────────────────────────────────────────────────
      // When an internal forwarder (e.g. CEO) forwards a supplier email, the
      // senderEmail becomes the forwarder's address, breaking routing.
      // We extract the original sender from the forwarded block and override.
      // Any @eatem.com.au address is an internal forwarder — expands beyond the CEO alone.
      // Also includes explicit non-eatem forwarder addresses (e.g. personal Gmail).
      const EXTRA_FORWARDER_EMAILS = ["peterkang75@gmail.com"];
      const isInternalForwarder = (email: string) =>
        email.endsWith("@eatem.com.au") || EXTRA_FORWARDER_EMAILS.includes(email);

      let forwarderEmail: string | null = null; // track who forwarded (for notes)

      if (isInternalForwarder(senderEmail)) {
        // ── Pattern A: Standard forwarded block separator (Gmail EN/KO, Outlook) ──
        // Matches:  "---------- Forwarded message ---------" or
        //           "---------- 전달된 메일 ---------" or
        //           "-----Original Message-----"
        // Then finds the first From/보낸사람/발신 field within ~300 chars
        const blockPattern =
          /(?:[-=]{4,}[^<\n]{0,60}(?:forward|전달된|original\s*message|forwarded)[^<\n]{0,60}[-=]{4,}|begin forwarded message)[^\n]*\n[\s\S]{0,300}?(?:from|보낸사람|발신자?\s*:?)[\s:]*(?:[^<\n]*?<)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?/i;

        const blockMatch = emailBody.match(blockPattern);
        if (blockMatch?.[1] && !isInternalForwarder(blockMatch[1].toLowerCase())) {
          forwarderEmail = senderEmail;
          senderEmail = blockMatch[1].toLowerCase();
          console.log(`[Webhook] Forward detected (block): ${forwarderEmail} → ${senderEmail}`);
        } else if (blockMatch?.[1] && isInternalForwarder(blockMatch[1].toLowerCase())) {
          console.log(`[Webhook] Forward block found but extracted sender is also internal (${blockMatch[1]}) — keeping original forwarder for Triage`);
        }

        // ── Pattern B: Subject starts with "Fwd:" — simpler body scan ──
        // Look for first "From: Name <email>" or "보낸사람: Name <email>" in body
        if (!forwarderEmail && /^fwd:/i.test(subject)) {
          const simplePattern =
            /(?:from|보낸사람|발신자?\s*:?)[\s:]*(?:[^\n<]{0,60}<)?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>/i;
          const simpleMatch = emailBody.match(simplePattern);
          if (simpleMatch?.[1] && !isInternalForwarder(simpleMatch[1].toLowerCase())) {
            forwarderEmail = senderEmail;
            senderEmail = simpleMatch[1].toLowerCase();
            console.log(`[Webhook] Forward detected (fwd-subject): ${forwarderEmail} → ${senderEmail}`);
          }
        }

        // ── Extract original subject from the forwarded block ──
        if (forwarderEmail) {
          const subjPattern =
            /(?:subject|제목|주제)[\s:]+(.+?)(?:\r?\n|$)/i;
          const subjMatch = emailBody.match(subjPattern);
          if (subjMatch?.[1]) {
            const extracted = subjMatch[1].trim();
            // Only use if it looks like a real subject (not just whitespace/artifacts)
            if (extracted.length > 1) {
              subject = extracted;
              console.log(`[Webhook] Forward: original subject extracted: "${subject}"`);
            }
          }
          // If no subject in body, strip "Fwd:" prefix from outer subject
          if (!subjMatch && /^fwd:/i.test(subject)) {
            subject = subject.replace(/^(?:fwd:\s*)+/i, "").trim();
          }
        }
      }

      // ── Helper: extract PDF text from a specific attachment object ───────────
      async function extractPdfFromAttachment(att: any): Promise<{ text: string; pdfBase64: string } | null> {
        const rawContent = att.content ?? att.data ?? att.body ?? "";
        let buf: Buffer;
        let pdfBase64: string;
        if (typeof rawContent === "string") {
          buf = Buffer.from(rawContent, "base64");
          pdfBase64 = rawContent;
        } else if (Buffer.isBuffer(rawContent)) {
          buf = rawContent;
          pdfBase64 = rawContent.toString("base64");
        } else return null;
        try {
          const text = await extractPdfText(buf);
          return text.trim() ? { text, pdfBase64 } : null;
        } catch { return null; }
      }

      // ── Helper: resolve storeCode → storeId ──────────────────────────────────
      const allStores = await storage.getStores();
      const sushiStore = allStores.find(s => s.name.toLowerCase().includes("sushi"));
      const sandwichStore = allStores.find(s => s.name.toLowerCase().includes("sandwich"));
      function resolveStoreId(code: string): string | null {
        if (code === "SUSHI" && sushiStore) return sushiStore.id;
        if (code === "SANDWICH" && sandwichStore) return sandwichStore.id;
        return null;
      }

      // ── Helper: fuzzy-match deliveryLocation text against stores table ────────
      // Falls back to this when storeCode = "UNKNOWN" — searches store name and address.
      function resolveStoreFromDelivery(deliveryLocation: string | null | undefined): string | null {
        if (!deliveryLocation) return null;
        const dl = deliveryLocation.toLowerCase();
        for (const store of allStores) {
          const name = (store.name ?? "").toLowerCase();
          // Match store name keywords inside the delivery text
          if (name && dl.includes(name)) return store.id;
          // Try matching a keyword from the store name (first meaningful word)
          const keyword = name.split(/\s+/).find((w: string) => w.length >= 4);
          if (keyword && dl.includes(keyword)) return store.id;
          // Match store address suburb/street if stored on store record
          const addr = ((store as any).address ?? "").toLowerCase();
          if (addr) {
            const suburb = addr.split(",").pop()?.trim() ?? "";
            if (suburb.length >= 3 && dl.includes(suburb)) return store.id;
          }
        }
        return null;
      }

      // ── Safety: if senderEmail is still an internal forwarder after all detection,
      // we can't determine the true supplier — send straight to Triage ────────────
      if (isInternalForwarder(senderEmail)) {
        console.log(`[Webhook] senderEmail is still internal (${senderEmail}) after forward detection — routing to Triage`);
        const senderNameFallback = rawHeaderFrom.includes("<")
          ? rawHeaderFrom.split("<")[0].trim().replace(/^"/, "").replace(/"$/, "")
          : null;
        await storage.createUniversalInboxItem({
          senderEmail,
          senderName: senderNameFallback || null,
          subject,
          body: emailBody.slice(0, 8000),
          hasAttachment,
          rawPayload: { ...payload, _suggestedAction: "ROUTE_TO_AP" },
          status: "NEEDS_ROUTING",
        });
        return res.status(200).json({ received: true, action: "saved_to_triage_inbox_internal_sender", sender: senderEmail });
      }

      // ── Lookup routing rule + check if direct supplier ────────────────────────
      const [routingRule, emailMatchedSupplier] = await Promise.all([
        storage.getEmailRoutingRule(senderEmail),
        storage.findSupplierByEmail(senderEmail),
      ]);
      // effectiveSupplier may be overridden after PDF cross-check (see below)
      let matchedSupplier = emailMatchedSupplier;
      let action = routingRule?.action ?? null;

      // Backward-compat: map legacy ALLOW/IGNORE → new actions
      if (action === "ALLOW") action = "ROUTE_TO_AP";
      if (action === "IGNORE") action = "SPAM_DROP";

      console.log(`[Webhook] Sender=${senderEmail} action=${action ?? "UNKNOWN"} directSupplier=${!!matchedSupplier} subject="${subject}"`);

      // ── SPAM_DROP / FYI_ARCHIVE — acknowledge silently (no human review needed) ──
      if (action === "SPAM_DROP") {
        return res.status(200).json({ received: true, action: "spam_dropped", sender: senderEmail });
      }
      if (action === "FYI_ARCHIVE") {
        return res.status(200).json({ received: true, action: "fyi_archived", sender: senderEmail });
      }

      // ── TRIAGE GATE ────────────────────────────────────────────────────────────
      // Auto-process ONLY when the sender is a confirmed direct supplier in the DB
      // (highest-confidence match: email address registered to a real supplier).
      // ALL other senders — even those with ROUTE_TO_AP / ROUTE_TO_TODO rules —
      // go to Triage Inbox first so the manager can review before processing.
      // Exceptions: SPAM_DROP and FYI_ARCHIVE (handled above, no human review needed).
      if (!matchedSupplier) {
        const senderName = rawHeaderFrom.includes("<")
          ? rawHeaderFrom.split("<")[0].trim().replace(/^"/, "").replace(/"$/, "")
          : null;
        console.log(`[Webhook] Not a direct supplier — routing to Triage Inbox: ${senderEmail} (suggestedAction=${action ?? "none"})`);
        await storage.createUniversalInboxItem({
          senderEmail,
          senderName: senderName || null,
          subject,
          body: emailBody.slice(0, 8000),
          hasAttachment,
          rawPayload: { ...payload, _suggestedAction: action },
          status: "NEEDS_ROUTING",
        });
        return res.status(200).json({ received: true, action: "saved_to_triage_inbox", sender: senderEmail, suggestedAction: action });
      }

      // ══════════════════════════════════════════════════════════════════════════
      // DIRECT SUPPLIER — auto-process AP pipeline
      // Reaching here means matchedSupplier is truthy (triage gate passed).
      // supplierId is confirmed → PENDING is allowed. No PDF → REVIEW.
      // ══════════════════════════════════════════════════════════════════════════
      console.log(`[Webhook] Direct supplier: "${matchedSupplier.name}" — running Micro-Filter`);

      // ── Micro-Filter Step 1: Collect ALL valid invoice attachments ─────────
      // A single email may include multiple PDFs — one per store. We process each
      // attachment independently so each spawns its own invoice row.
      const validInvoiceAttachments = attachments.filter((a: any) => {
        const name = (a.file_name ?? a.filename ?? a.name ?? "").toLowerCase();
        const type = (a.content_type ?? a.contentType ?? a.mimeType ?? a.type ?? "").toLowerCase();
        return name.endsWith(".pdf") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".png")
          || type.includes("pdf") || type.includes("jpeg") || type.includes("png");
      });

      if (validInvoiceAttachments.length === 0) {
        console.log(`[Webhook] Micro-Filter: No valid attachments → FYI_ARCHIVE (${matchedSupplier.name})`);
        return res.status(200).json({ received: true, action: "fyi_archived_no_attachment", supplier: matchedSupplier.name, reason: "No PDF/image attachments — likely an order confirmation or text update" });
      }

      console.log(`[Webhook] Processing ${validInvoiceAttachments.length} attachment(s) for "${matchedSupplier.name}"`);

      // ── Supplier name normalizer (for cross-check) ─────────────────────────
      const normalize = (n: string) =>
        n.toLowerCase()
          .replace(/\bpty\.?\s*ltd\.?\b/gi, "")
          .replace(/\binc\.?\b/gi, "")
          .replace(/[^a-z0-9\s]/g, "")
          .replace(/\s+/g, " ")
          .trim();
      const significantWords = (n: string) => n.split(" ").filter((w: string) => w.length >= 4);

      // Pre-fetch existing invoice numbers for this supplier (dedup across attachments)
      const existingForSupplier = await storage.getSupplierInvoices({ supplierId: matchedSupplier.id });
      const existingNumbers = new Set(existingForSupplier.map(inv => inv.invoiceNumber));
      const isAutoPay = matchedSupplier.isAutoPay ?? false;
      const today = new Date().toISOString().split("T")[0];

      const created: string[] = [];
      const skipped: string[] = [];
      let reviewCount = 0;
      let confirmationCount = 0;

      // ── Loop: process each attachment independently ─────────────────────────
      for (let attIdx = 0; attIdx < validInvoiceAttachments.length; attIdx++) {
        const att = validInvoiceAttachments[attIdx];
        const attName = att.file_name ?? att.filename ?? att.name ?? `attachment-${attIdx + 1}`;
        console.log(`[Webhook] Attachment ${attIdx + 1}/${validInvoiceAttachments.length}: "${attName}"`);

        // ── Step 2: Extract PDF text ─────────────────────────────────────────
        const pdfResult = await extractPdfFromAttachment(att);
        const classifyText = pdfResult?.text.trim() ? pdfResult.text : (validInvoiceAttachments.length === 1 ? emailBody : "");

        // ── Step 3: Classify (INVOICE vs CONFIRMATION) ───────────────────────
        const docType = await classifyDocumentForAP(classifyText || "no text available");
        if (docType === "CONFIRMATION") {
          console.log(`[Webhook] Attachment "${attName}" classified as CONFIRMATION — skipping`);
          confirmationCount++;
          continue;
        }

        // ── Step 4: Handle unreadable PDF ───────────────────────────────────
        if (!pdfResult) {
          const placeholder = await storage.createSupplierInvoice({
            supplierId: matchedSupplier.id, storeId: null,
            invoiceNumber: `EMAIL-${Date.now()}-${attIdx}`,
            invoiceDate: today,
            dueDate: undefined, amount: 0, status: "REVIEW",
            notes: `Attachment "${attName}" found but could not be read. Please enter manually.\nFrom: ${senderEmail}\nSubject: ${subject}`,
          });
          created.push(placeholder.id);
          console.log(`[Webhook] Attachment "${attName}" unreadable — created REVIEW placeholder`);
          continue;
        }

        // ── Step 5: Parse with AI ────────────────────────────────────────────
        const parsedItems = await parseInvoiceWithAI(pdfResult.text, matchedSupplier.name);
        if (!parsedItems || parsedItems.length === 0) {
          console.log(`[Webhook] Attachment "${attName}" — AI parse returned nothing`);
          continue;
        }

        // ── Step 6: PDF Supplier Cross-Check ────────────────────────────────
        // PDF content is ground truth. If supplier name doesn't match, the
        // email may have been forwarded from a different supplier.
        const pdfSupplierName = parsedItems[0]?.extractedSupplierName ?? null;
        let currentSupplier = matchedSupplier;

        if (pdfSupplierName) {
          const normPdf = normalize(pdfSupplierName);
          const normMatched = normalize(currentSupplier.name);
          const pdfWords = significantWords(normPdf);
          const matchedWords = significantWords(normMatched);
          const hasOverlap =
            pdfWords.some(w => normMatched.includes(w)) ||
            matchedWords.some(w => normPdf.includes(w));

          if (!hasOverlap) {
            console.log(`[Webhook] Attachment "${attName}": SUPPLIER MISMATCH — Email→"${currentSupplier.name}" | PDF→"${pdfSupplierName}"`);
            const pdfSupplier = await storage.findSupplierByName(pdfSupplierName);
            if (pdfSupplier) {
              console.log(`[Webhook] Cross-check: redirecting to known supplier "${pdfSupplier.name}"`);
              currentSupplier = pdfSupplier;
            } else {
              // Unknown supplier — route all items from this attachment to REVIEW
              for (const parsed of parsedItems) {
                const storeId = resolveStoreId(parsed.storeCode) ?? resolveStoreFromDelivery(parsed.deliveryLocation);
                const inv = await storage.createSupplierInvoice({
                  supplierId: null, storeId,
                  invoiceNumber: parsed.invoiceNumber || `EMAIL-${Date.now()}-${attIdx}`,
                  invoiceDate: parsed.issueDate || today,
                  dueDate: parsed.dueDate ?? undefined,
                  amount: parsed.totalAmount,
                  status: "REVIEW",
                  rawExtractedData: {
                    senderEmail, subject, pdfBase64: pdfResult.pdfBase64,
                    body: emailBody?.slice(0, 8000) || null,
                    supplier: { supplierName: pdfSupplierName, abn: parsedItems[0]?.abn ?? null },
                    invoices: parsedItems.map(p => ({
                      invoiceNumber: p.invoiceNumber, issueDate: p.issueDate,
                      dueDate: p.dueDate, totalAmount: p.totalAmount, storeCode: p.storeCode,
                    })),
                  },
                  notes: `Supplier mismatch: email from "${currentSupplier.name}" but PDF identifies "${pdfSupplierName}"${parsedItems[0]?.abn ? ` (ABN: ${parsedItems[0].abn})` : ""}.\nAttachment: ${attName}\nFrom: ${senderEmail}\nSubject: ${subject}`,
                });
                reviewCount++;
                created.push(inv.id);
              }
              continue; // Done with this attachment
            }
          }
        }

        // ── Step 7: Create invoices for this attachment ──────────────────────
        for (const parsed of parsedItems) {
          if (!parsed.invoiceNumber && !parsed.issueDate && !parsed.totalAmount) continue;
          if (parsed.invoiceNumber && existingNumbers.has(parsed.invoiceNumber)) {
            console.log(`[Webhook] Attachment "${attName}": duplicate invoice ${parsed.invoiceNumber} — skipping`);
            skipped.push(parsed.invoiceNumber);
            continue;
          }

          // Store resolution: storeCode first, then deliveryLocation fuzzy match
          const storeId = resolveStoreId(parsed.storeCode) ?? resolveStoreFromDelivery(parsed.deliveryLocation);
          if (storeId) {
            const storeName = allStores.find(s => s.id === storeId)?.name ?? storeId;
            console.log(`[Webhook] Attachment "${attName}": invoice ${parsed.invoiceNumber} → store "${storeName}" (storeCode=${parsed.storeCode}, delivery="${parsed.deliveryLocation ?? "n/a"}")`);
          } else {
            console.log(`[Webhook] Attachment "${attName}": invoice ${parsed.invoiceNumber} → store UNKNOWN (storeCode=${parsed.storeCode}, delivery="${parsed.deliveryLocation ?? "n/a"}")`);
          }

          // If amount is $0, AI extraction failed — force REVIEW so manager can fill in manually.
          // A real $0 invoice is extremely rare; guarding on amount alone is safest.
          const amountMissing = !parsed.totalAmount || parsed.totalAmount === 0;
          const numberMissing = !parsed.invoiceNumber;
          const needsReview = amountMissing; // Amount is required — $0 always goes to REVIEW

          const invStatus = needsReview ? "REVIEW" : (isAutoPay ? "PAID" : "PENDING");
          const newInv = await storage.createSupplierInvoice({
            supplierId: currentSupplier.id,
            storeId,
            invoiceNumber: parsed.invoiceNumber,
            invoiceDate: parsed.issueDate,
            dueDate: parsed.dueDate ?? undefined,
            amount: parsed.totalAmount,
            status: invStatus,
            rawExtractedData: { pdfBase64: pdfResult.pdfBase64, senderEmail, subject, deliveryLocation: parsed.deliveryLocation ?? null },
            notes: needsReview
              ? `AI could not extract the invoice amount${numberMissing ? " or invoice number" : ""} — please review and fill in manually.\nFrom: ${senderEmail}\nSubject: ${subject}\nAttachment: ${attName}`
              : isAutoPay
                ? `Auto-paid (Direct Debit) via email from ${senderEmail}. Subject: ${subject}. Attachment: ${attName}`
                : `Auto-imported via email from ${senderEmail}. Subject: ${subject}. Attachment: ${attName}`,
          });

          if (isAutoPay && !needsReview) {
            await storage.createSupplierPayment({
              supplierId: currentSupplier.id, invoiceId: newInv.id,
              paymentDate: parsed.issueDate ?? today, amount: parsed.totalAmount ?? 0,
              method: "AUTO_DEBIT", notes: `Automatic direct debit — ${senderEmail}`,
            });
          }
          created.push(newInv.id);
          if (parsed.invoiceNumber) existingNumbers.add(parsed.invoiceNumber);
        }
      }
      // ── End attachment loop ─────────────────────────────────────────────────

      return res.status(200).json({
        received: true,
        action: "invoices_created",
        attachmentsProcessed: validInvoiceAttachments.length,
        created: created.length,
        skipped: skipped.length,
        reviewCount,
        confirmationCount,
        supplier: matchedSupplier.name,
      });

    } catch (err) {
      console.error("[Webhook/inbound-invoices] Unhandled error:", err);
      if (!res.headersSent) return res.status(200).send("OK");
      return;
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

  // ── Email Routing Rules ──────────────────────────────────────────────────────
  app.get("/api/email-routing-rules", async (_req: Request, res: Response) => {
    try {
      const rules = await storage.getEmailRoutingRules();
      res.json(rules);
    } catch (err) {
      console.error("Error fetching email routing rules:", err);
      res.status(500).json({ error: "Failed to fetch email routing rules" });
    }
  });

  app.put("/api/email-routing-rules/:email", async (req: Request, res: Response) => {
    try {
      const email = decodeURIComponent(req.params.email).toLowerCase();
      const { action, supplierName } = req.body;
      const validActions = ["ROUTE_TO_AP", "ROUTE_TO_TODO", "FYI_ARCHIVE", "SPAM_DROP", "ALLOW", "IGNORE"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: "action must be one of: ROUTE_TO_AP, ROUTE_TO_TODO, FYI_ARCHIVE, SPAM_DROP" });
      }
      const rule = await storage.upsertEmailRoutingRule({ email, action, supplierName });
      res.json(rule);
    } catch (err) {
      console.error("Error upserting email routing rule:", err);
      res.status(500).json({ error: "Failed to save email routing rule" });
    }
  });

  app.delete("/api/email-routing-rules/:email", async (req: Request, res: Response) => {
    try {
      const email = decodeURIComponent(req.params.email).toLowerCase();
      const deleted = await storage.deleteEmailRoutingRule(email);
      if (!deleted) return res.status(404).json({ error: "Rule not found" });
      res.json({ deleted: true });
    } catch (err) {
      console.error("Error deleting email routing rule:", err);
      res.status(500).json({ error: "Failed to delete email routing rule" });
    }
  });

  // ── Universal Inbox ──────────────────────────────────────────────────────────
  app.get("/api/universal-inbox", async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const items = await storage.getUniversalInboxItems(status);
      // Enrich each item with suggestedAction extracted from stored rawPayload metadata
      const enriched = items.map(item => ({
        ...item,
        suggestedAction: (item.rawPayload as any)?._suggestedAction ?? null,
      }));
      res.json(enriched);
    } catch (err) {
      console.error("Error fetching universal inbox:", err);
      res.status(500).json({ error: "Failed to fetch universal inbox" });
    }
  });

  // Route a universal inbox item: save routing rule + re-process email
  app.post("/api/universal-inbox/:id/route", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { action } = req.body;
      const validActions = ["ROUTE_TO_AP", "ROUTE_TO_TODO", "FYI_ARCHIVE", "SPAM_DROP"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ error: "action must be one of: ROUTE_TO_AP, ROUTE_TO_TODO, FYI_ARCHIVE, SPAM_DROP" });
      }

      const item = await storage.getUniversalInboxItem(id);
      if (!item) return res.status(404).json({ error: "Item not found" });

      // 1. Save the routing rule for this sender so future emails are routed automatically
      await storage.upsertEmailRoutingRule({
        email: item.senderEmail,
        action,
        supplierName: item.senderName ?? undefined,
      });

      // 2. Process the email based on the chosen action
      let processResult: any = { action };

      // 3. Mark item as processed or dropped immediately (before heavy AI work)
      const newStatus = (action === "SPAM_DROP" || action === "FYI_ARCHIVE") ? "DROPPED" : "PROCESSED";
      await storage.updateUniversalInboxItem(id, { status: newStatus });

      if (action === "ROUTE_TO_TODO") {
        // TODO: fire summarization in background so response is immediate
        const subject = item.subject;
        const emailBody = item.body;
        // Respond now, summarize in background
        res.json({ success: true, ...processResult, status: "processing" });
        setImmediate(async () => {
          try {
            const taskData = await summarizeTaskFromEmail(subject, emailBody);
            if (taskData?.title) {
              await storage.createTodo({
                title: taskData.title,
                description: taskData.description || null,
                sourceEmail: item.senderEmail,
                senderEmail: item.senderEmail,
                originalSubject: subject,
                originalBody: emailBody.slice(0, 8000),
                dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
                status: "TODO",
              });
              console.log(`[TriageRoute] TODO created in background: "${taskData.title}"`);
            }
          } catch (err) {
            console.error("[TriageRoute] Background TODO creation failed:", err);
          }
        });
        return; // already sent response
      } else if (action === "ROUTE_TO_AP") {
        const rawPayload = item.rawPayload as any;
        const subject = item.subject;
        const senderEmail = item.senderEmail;
        const attachments: any[] = Array.isArray(rawPayload?.attachments) ? rawPayload.attachments : [];

        // Find PDF attachment and extract base64
        const pdfAttachment = attachments.find((a: any) => {
          const name: string = a.file_name ?? a.filename ?? a.name ?? "";
          const type: string = a.content_type ?? a.contentType ?? a.mimeType ?? a.type ?? "";
          return name.toLowerCase().endsWith(".pdf") || type.toLowerCase().includes("pdf");
        });
        let triagePdfBase64: string | undefined;
        if (pdfAttachment) {
          const rawContent = pdfAttachment.content ?? pdfAttachment.data ?? pdfAttachment.body ?? "";
          triagePdfBase64 = typeof rawContent === "string" ? rawContent : Buffer.isBuffer(rawContent) ? rawContent.toString("base64") : undefined;
        }

        // Create a REVIEW placeholder immediately so the AP Inbox shows the
        // item right away, before the slow AI parse completes.
        const reviewInv = await storage.createSupplierInvoice({
          supplierId: undefined,
          storeId: null,
          invoiceNumber: `TRIAGE-${Date.now()}`,
          invoiceDate: new Date().toISOString().split("T")[0],
          dueDate: undefined,
          amount: 0,
          status: "REVIEW",
          notes: `Routed from Triage Inbox. Parsing in progress…\nFrom: ${senderEmail}\nSubject: ${subject}`,
          rawExtractedData: { senderEmail, subject, supplier: { supplierName: item.senderName ?? "" }, body: item.body?.slice(0, 8000), pdfBase64: triagePdfBase64 },
        });
        processResult.invoiceId = reviewInv.id;
        processResult.reviewCreated = true;

        // Respond to the client immediately — AP Review Inbox will show the
        // placeholder instantly. Background job upgrades it if AI can parse.
        res.json({ success: true, ...processResult, status: "processing" });

        // ── Background AI parsing ──────────────────────────────────────────
        setImmediate(async () => {
          try {
            // Helper to upgrade or create final invoice(s) after AI parse
            const upgradeToFinal = async (reason: string, rawExtractedData: any, finalStatus: "REVIEW" | "PENDING", extraFields?: Partial<Parameters<typeof storage.createSupplierInvoice>[0]>) => {
              // Always preserve the pdfBase64 and email body so the viewer works
              const mergedRaw: any = { ...rawExtractedData };
              if (triagePdfBase64) mergedRaw.pdfBase64 = triagePdfBase64;
              if (item.body && !mergedRaw.body) mergedRaw.body = item.body.slice(0, 8000);
              // Update the placeholder we already created
              await storage.updateSupplierInvoice(reviewInv.id, {
                status: finalStatus,
                notes: `${reason}\nFrom: ${senderEmail}\nSubject: ${subject}`,
                rawExtractedData: mergedRaw,
                ...extraFields,
              });
              console.log(`[TriageRoute/bg] Placeholder ${reviewInv.id} upgraded → ${finalStatus}`);
            };

            if (pdfAttachment) {
              const rawContent = pdfAttachment.content ?? pdfAttachment.data ?? pdfAttachment.body ?? "";
              const buf: Buffer = typeof rawContent === "string" ? Buffer.from(rawContent, "base64") : rawContent;
              const pdfText = await extractPdfText(buf);

              if (pdfText.trim()) {
                const matchedSupplier = await storage.findSupplierByEmail(senderEmail);

                if (matchedSupplier) {
                  // Known supplier — try to parse PENDING invoices
                  const parsedItems = await parseInvoiceWithAI(pdfText, matchedSupplier.name);
                  if (parsedItems?.length) {
                    const existing = await storage.getSupplierInvoices({ supplierId: matchedSupplier.id });
                    const existingNumbers = new Set(existing.map(inv => inv.invoiceNumber));
                    const allStores = await storage.getStores();
                    const sushiStore = allStores.find(s => s.name.toLowerCase().includes("sushi"));
                    const sandwichStore = allStores.find(s => s.name.toLowerCase().includes("sandwich"));

                    let firstCreated = false;
                    for (const parsed of parsedItems) {
                      if (!parsed.invoiceNumber && !parsed.totalAmount) continue;
                      if (parsed.invoiceNumber && existingNumbers.has(parsed.invoiceNumber)) continue;
                      const storeId = parsed.storeCode === "SUSHI" ? sushiStore?.id ?? null : parsed.storeCode === "SANDWICH" ? sandwichStore?.id ?? null : null;
                      if (!firstCreated) {
                        // Upgrade the placeholder for the first invoice
                        await upgradeToFinal(
                          `Routed from Triage Inbox.`,
                          { senderEmail, subject, supplier: { supplierName: matchedSupplier.name } },
                          "PENDING",
                          { supplierId: matchedSupplier.id, storeId, invoiceNumber: parsed.invoiceNumber, invoiceDate: parsed.issueDate, dueDate: parsed.dueDate ?? undefined, amount: parsed.totalAmount },
                        );
                        firstCreated = true;
                      } else {
                        // Additional invoices in the same email
                        await storage.createSupplierInvoice({
                          supplierId: matchedSupplier.id, storeId,
                          invoiceNumber: parsed.invoiceNumber,
                          invoiceDate: parsed.issueDate,
                          dueDate: parsed.dueDate ?? undefined,
                          amount: parsed.totalAmount,
                          status: "PENDING",
                          notes: `Routed from Triage Inbox.\nFrom: ${senderEmail}\nSubject: ${subject}`,
                        });
                      }
                    }
                    if (!firstCreated) {
                      // AI returned items but all were duplicates
                      await upgradeToFinal(
                        `Duplicate invoices — already in system.`,
                        { senderEmail, subject, supplier: { supplierName: matchedSupplier.name } },
                        "REVIEW",
                      );
                    }
                  } else {
                    await upgradeToFinal(
                      `PDF parsed but no invoice data extracted.`,
                      { senderEmail, subject, supplier: { supplierName: matchedSupplier.name } },
                      "REVIEW",
                    );
                  }
                } else {
                  // Unknown sender — full parse
                  const unknownParsed = await parseInvoiceFromUnknownSender(pdfText);
                  if (unknownParsed?.invoices?.length) {
                    const nameMatch = unknownParsed.supplier.supplierName
                      ? await storage.findSupplierByName(unknownParsed.supplier.supplierName)
                      : undefined;
                    if (nameMatch) {
                      await upgradeToFinal(
                        `Routed from Triage Inbox.`,
                        { senderEmail, subject, supplier: unknownParsed.supplier },
                        "PENDING",
                        {
                          supplierId: nameMatch.id,
                          storeId: null,
                          invoiceNumber: unknownParsed.invoices[0]?.invoiceNumber || `TRIAGE-${Date.now()}`,
                          invoiceDate: unknownParsed.invoices[0]?.issueDate,
                          amount: unknownParsed.invoices[0]?.totalAmount,
                        },
                      );
                    } else {
                      await upgradeToFinal(
                        `Unknown supplier. Please review and add.`,
                        { senderEmail, subject, supplier: unknownParsed.supplier, invoices: unknownParsed.invoices },
                        "REVIEW",
                      );
                    }
                  } else {
                    // PDF found but no invoice items — use supplier info if AI got it,
                    // otherwise fall back to parsing the email body
                    let supplierInfo = unknownParsed?.supplier?.supplierName && unknownParsed.supplier.supplierName !== "Unknown Supplier"
                      ? unknownParsed.supplier
                      : null;
                    if (!supplierInfo && item.body?.trim()) {
                      const bodyParsed = await parseInvoiceFromUnknownSender(item.body.slice(0, 8000)).catch(() => null);
                      if (bodyParsed?.supplier?.supplierName && bodyParsed.supplier.supplierName !== "Unknown Supplier") {
                        supplierInfo = bodyParsed.supplier;
                      }
                    }
                    await upgradeToFinal(
                      `PDF found but could not extract invoice data. Please review and add details.`,
                      { senderEmail, subject, supplier: supplierInfo ?? { supplierName: item.senderName ?? "" } },
                      "REVIEW",
                    );
                  }
                }
              } else {
                // Scanned/image PDF — try email body as fallback for supplier info
                let scannedSupplier: any = null;
                if (item.body?.trim()) {
                  const bodyParsed = await parseInvoiceFromUnknownSender(item.body.slice(0, 8000)).catch(() => null);
                  if (bodyParsed?.supplier?.supplierName && bodyParsed.supplier.supplierName !== "Unknown Supplier") {
                    scannedSupplier = bodyParsed.supplier;
                  }
                }
                if (scannedSupplier) {
                  await upgradeToFinal(
                    `PDF is a scanned image (unreadable). Supplier info extracted from email body. Please verify and add invoice details.`,
                    { senderEmail, subject, supplier: scannedSupplier },
                    "REVIEW",
                  );
                } else {
                  await upgradeToFinal(
                    `PDF attachment found but could not be read (scanned image). Please add invoice details manually.`,
                    { senderEmail, subject, supplier: { supplierName: item.senderName ?? "" } },
                    "REVIEW",
                  );
                }
              }
            } else {
              // No PDF — try parsing email body for supplier info
              let bodySupplier: any = null;
              let bodyInvoices: any[] = [];
              if (item.body?.trim()) {
                const bodyParsed = await parseInvoiceFromUnknownSender(item.body.slice(0, 8000)).catch(() => null);
                if (bodyParsed?.supplier?.supplierName && bodyParsed.supplier.supplierName !== "Unknown Supplier") {
                  bodySupplier = bodyParsed.supplier;
                  bodyInvoices = bodyParsed.invoices ?? [];
                }
              }
              if (bodySupplier) {
                await upgradeToFinal(
                  `No PDF attachment. Supplier info extracted from email body. Please verify and add invoice details.`,
                  { senderEmail, subject, supplier: bodySupplier, invoices: bodyInvoices, body: item.body?.slice(0, 8000) },
                  "REVIEW",
                );
              } else {
                await upgradeToFinal(
                  `No PDF attachment. Please review and enter invoice details manually.`,
                  { senderEmail, subject, supplier: { supplierName: item.senderName ?? "" }, body: item.body?.slice(0, 8000) },
                  "REVIEW",
                );
              }
            }
          } catch (bgErr) {
            console.error("[TriageRoute/bg] Background AP processing failed:", bgErr);
            // Leave the REVIEW placeholder as-is so the manager can handle it
          }
        });
        return; // already sent response
      }

      res.json({ success: true, ...processResult });
    } catch (err) {
      console.error("Error routing universal inbox item:", err);
      res.status(500).json({ error: "Failed to route item" });
    }
  });

  app.delete("/api/universal-inbox/:id", async (req: Request, res: Response) => {
    try {
      const deleted = await storage.deleteUniversalInboxItem(req.params.id);
      if (!deleted) return res.status(404).json({ error: "Item not found" });
      res.json({ deleted: true });
    } catch (err) {
      console.error("Error deleting universal inbox item:", err);
      res.status(500).json({ error: "Failed to delete item" });
    }
  });

  // ── Todos (AI Executive Assistant) ───────────────────────────────────────────
  app.get("/api/todos", async (_req: Request, res: Response) => {
    try {
      const items = await storage.getTodos();
      res.json(items);
    } catch (err) {
      console.error("Error fetching todos:", err);
      res.status(500).json({ error: "Failed to fetch todos" });
    }
  });

  app.post("/api/todos", async (req: Request, res: Response) => {
    try {
      const { title, description, sourceEmail, senderEmail, originalSubject, originalBody, dueDate, status } = req.body;
      if (!title) return res.status(400).json({ error: "title is required" });
      const todo = await storage.createTodo({
        title,
        description: description ?? null,
        sourceEmail: sourceEmail ?? null,
        senderEmail: senderEmail ?? null,
        originalSubject: originalSubject ?? null,
        originalBody: originalBody ?? null,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: status ?? "TODO",
      });
      res.status(201).json(todo);
    } catch (err) {
      console.error("Error creating todo:", err);
      res.status(500).json({ error: "Failed to create todo" });
    }
  });

  app.patch("/api/todos/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { status, title, description, dueDate } = req.body;
      const update: Record<string, any> = {};
      if (status !== undefined) update.status = status;
      if (title !== undefined) update.title = title;
      if (description !== undefined) update.description = description;
      if (dueDate !== undefined) update.dueDate = dueDate ? new Date(dueDate) : null;
      const todo = await storage.updateTodo(id, update);
      if (!todo) return res.status(404).json({ error: "Todo not found" });
      res.json(todo);
    } catch (err) {
      console.error("Error updating todo:", err);
      res.status(500).json({ error: "Failed to update todo" });
    }
  });

  app.delete("/api/todos/:id", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteTodo(id);
      if (!deleted) return res.status(404).json({ error: "Todo not found" });
      res.status(204).send();
    } catch (err) {
      console.error("Error deleting todo:", err);
      res.status(500).json({ error: "Failed to delete todo" });
    }
  });

  // ── Todo Reply Endpoints ────────────────────────────────────────────────────
  app.get("/api/todos/:id/korean-summary", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const todo = await storage.getTodo(id);
      if (!todo) return res.status(404).json({ error: "Todo not found" });

      const openaiClient = new (await import("openai")).default({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a Korean business assistant. Translate the given task title and description into natural, professional Korean.
Return ONLY a JSON object: {"koreanTitle": "...", "koreanDescription": "..."}
If description is empty, return an empty string for koreanDescription.
Do NOT add any explanation outside the JSON.`,
          },
          {
            role: "user",
            content: `Title: ${todo.title}\nDescription: ${todo.description ?? ""}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });

      const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      res.json({
        koreanTitle: parsed.koreanTitle ?? todo.title,
        koreanDescription: parsed.koreanDescription ?? todo.description ?? "",
      });
    } catch (err) {
      console.error("Error getting Korean summary:", err);
      res.status(500).json({ error: "Failed to translate" });
    }
  });

  app.post("/api/todos/:id/draft-reply", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { koreanDraft } = req.body;
      if (!koreanDraft) return res.status(400).json({ error: "koreanDraft is required" });

      const todo = await storage.getTodo(id);
      if (!todo) return res.status(404).json({ error: "Todo not found" });

      const openaiClient = new (await import("openai")).default({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are an executive assistant. Translate the following Korean instruction into a concise, professional business English email reply.

Rules:
- Be direct and brief — no filler phrases like "I hope this message finds you well"
- Use short sentences and natural paragraph breaks (blank line between paragraphs)
- Output ONLY the email body — no subject line, no greeting, no sign-off
- Aim for 2–4 short paragraphs maximum`,
          },
          {
            role: "user",
            content: koreanDraft,
          },
        ],
        temperature: 0.3,
        max_tokens: 800,
      });

      const englishReply = completion.choices[0]?.message?.content?.trim() ?? "";
      res.json({ englishReply });
    } catch (err) {
      console.error("Error drafting reply:", err);
      res.status(500).json({ error: "Failed to draft reply" });
    }
  });

  app.post("/api/todos/:id/send-reply", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { finalEnglishReply } = req.body;
      if (!finalEnglishReply) return res.status(400).json({ error: "finalEnglishReply is required" });

      const todo = await storage.getTodo(id);
      if (!todo) return res.status(404).json({ error: "Todo not found" });

      const toEmail = todo.senderEmail || todo.sourceEmail;
      if (!toEmail) return res.status(400).json({ error: "No sender email to reply to" });
      const replySubject = todo.originalSubject || todo.title;

      const { sendEmailReply } = await import("./mailer.js");
      await sendEmailReply({
        to: toEmail,
        originalSubject: replySubject,
        body: finalEnglishReply,
      });

      await storage.updateTodo(id, { status: "DONE" });
      res.json({ success: true });
    } catch (err) {
      console.error("Error sending reply:", err);
      res.status(500).json({ error: "Failed to send reply" });
    }
  });

  // ── RBAC Permissions ─────────────────────────────────────────────────────────
  const ALL_MANAGED_PAGES = [
    { route: "/admin", label: "Dashboard" },
    { route: "/admin/stores", label: "Stores" },
    { route: "/admin/candidates", label: "Candidates" },
    { route: "/admin/employees", label: "Employees" },
    { route: "/admin/rosters", label: "Rosters" },
    { route: "/admin/approvals", label: "Pending Approvals" },
    { route: "/admin/timesheets", label: "Attendance History" },
    { route: "/admin/payrolls", label: "Payroll" },
    { route: "/admin/cash", label: "Cash & Close" },
    { route: "/admin/finance", label: "Cash Flow" },
    { route: "/admin/suppliers", label: "Suppliers" },
    { route: "/admin/suppliers/invoices", label: "Invoices" },
    { route: "/admin/accounts-payable", label: "Accounts Payable" },
    { route: "/admin/notices", label: "Notices" },
    { route: "/admin/executive", label: "AI Smart Inbox" },
  ];
  const MANAGER_ALLOWED = [
    "/admin", "/admin/stores", "/admin/candidates", "/admin/employees",
    "/admin/rosters", "/admin/approvals", "/admin/timesheets",
    "/admin/payrolls", "/admin/cash", "/admin/notices",
  ];
  const STAFF_ALLOWED = ["/admin", "/admin/rosters"];

  function buildDefaultPermissions() {
    const defaults: { role: string; route: string; label: string; allowed: boolean }[] = [];
    for (const page of ALL_MANAGED_PAGES) {
      defaults.push({ role: "ADMIN", route: page.route, label: page.label, allowed: true });
      defaults.push({ role: "MANAGER", route: page.route, label: page.label, allowed: MANAGER_ALLOWED.includes(page.route) });
      defaults.push({ role: "STAFF", route: page.route, label: page.label, allowed: STAFF_ALLOWED.includes(page.route) });
    }
    return defaults;
  }

  app.get("/api/permissions", async (_req: Request, res: Response) => {
    try {
      let perms = await storage.getPermissions();
      if (perms.length === 0) {
        await storage.setPermissions(buildDefaultPermissions());
        perms = await storage.getPermissions();
      }
      res.json(perms);
    } catch (err) {
      console.error("Error fetching permissions:", err);
      res.status(500).json({ error: "Failed to fetch permissions" });
    }
  });

  app.patch("/api/permissions", async (req: Request, res: Response) => {
    try {
      const { permissions } = req.body;
      if (!Array.isArray(permissions)) return res.status(400).json({ error: "permissions array required" });
      const valid = permissions.every((p: any) =>
        typeof p.role === "string" && typeof p.route === "string" &&
        typeof p.label === "string" && typeof p.allowed === "boolean"
      );
      if (!valid) return res.status(400).json({ error: "Invalid permission entry" });
      await storage.setPermissions(permissions);
      const updated = await storage.getPermissions();
      res.json(updated);
    } catch (err) {
      console.error("Error updating permissions:", err);
      res.status(500).json({ error: "Failed to update permissions" });
    }
  });

  // ── REVIEW invoices (from auto-discovery inbox) ──────────────────────────────
  app.get("/api/invoices/review", async (_req: Request, res: Response) => {
    try {
      const reviewInvoices = await storage.getSupplierInvoices({ status: "REVIEW" });
      res.json(reviewInvoices);
    } catch (err) {
      console.error("Error fetching review invoices:", err);
      res.status(500).json({ error: "Failed to fetch review invoices" });
    }
  });

  // ── Approve supplier group — creates/links supplier + sweeps ALL matching REVIEW invoices ──
  app.post("/api/invoices/review/approve-group", async (req: Request, res: Response) => {
    try {
      const { supplierData, senderEmail, supplierName, existingSupplierId } = req.body as {
        supplierData: {
          name: string; abn?: string; contactName?: string; contactEmails?: string[];
          bsb?: string; accountNumber?: string; address?: string; notes?: string; isAutoPay?: boolean;
        };
        senderEmail?: string;
        supplierName: string;
        existingSupplierId?: string; // If set, link to this supplier instead of creating new
      };

      if (!supplierData?.name || !supplierName) {
        return res.status(400).json({ error: "supplierData.name and supplierName are required" });
      }

      const isInternal = (email: string) =>
        !email || /@eatem\.com\.au$/i.test(email) || /^peterkang75@gmail\.com$/i.test(email);

      let supplier: any;

      if (existingSupplierId) {
        // ── LINK mode: attach invoices to an existing supplier ──────────────────
        supplier = await storage.getSupplier(existingSupplierId);
        if (!supplier) return res.status(404).json({ error: "Existing supplier not found" });

        console.log(`[Review/approve-group] Linking to existing supplier "${supplier.name}" (${supplier.id})`);

        // Build the email list to save: merge form emails into existing emails
        const formEmails = (supplierData.contactEmails ?? []).filter(Boolean);
        const existingEmails = supplier.contactEmails ?? [];
        const mergedEmails = Array.from(new Set([...existingEmails, ...formEmails]));

        // Auto-heal: if supplier has no email yet but senderEmail is external, add it
        if (mergedEmails.length === 0 && senderEmail && !isInternal(senderEmail)) {
          mergedEmails.push(senderEmail);
          console.log(`[Review/approve-group] Auto-healing supplier email → ${senderEmail}`);
        }

        // Update supplier with merged data (only fill blanks, don't overwrite existing)
        supplier = (await storage.updateSupplier(existingSupplierId, {
          active: true,
          abn: supplier.abn || supplierData.abn || null,
          contactName: supplier.contactName || supplierData.contactName || null,
          contactEmails: mergedEmails.length > 0 ? mergedEmails : supplier.contactEmails,
          bsb: supplier.bsb || supplierData.bsb || null,
          accountNumber: supplier.accountNumber || supplierData.accountNumber || null,
          address: supplier.address || supplierData.address || null,
          isAutoPay: supplier.isAutoPay ?? supplierData.isAutoPay ?? false,
        })) ?? supplier;

      } else {
        // ── CREATE mode: find-or-create supplier by name ───────────────────────
        supplier = await storage.findSupplierByNameAny(supplierData.name);
        if (supplier) {
          console.log(`[Review/approve-group] Supplier "${supplier.name}" (${supplier.active ? "active" : "inactive"}) (${supplier.id}) — reactivating/updating.`);
          supplier = (await storage.updateSupplier(supplier.id, {
            active: true,
            abn: supplierData.abn || supplier.abn,
            contactName: supplierData.contactName || supplier.contactName,
            contactEmails: supplierData.contactEmails && supplierData.contactEmails.length > 0
              ? supplierData.contactEmails
              : supplier.contactEmails,
            bsb: supplierData.bsb || supplier.bsb,
            accountNumber: supplierData.accountNumber || supplier.accountNumber,
            address: supplierData.address || supplier.address,
            notes: supplierData.notes || supplier.notes,
            isAutoPay: supplierData.isAutoPay ?? supplier.isAutoPay,
          })) ?? supplier;
        } else {
          supplier = await storage.createSupplier({
            name: supplierData.name,
            abn: supplierData.abn || null,
            contactName: supplierData.contactName || null,
            contactEmails: supplierData.contactEmails && supplierData.contactEmails.length > 0 ? supplierData.contactEmails : null,
            bsb: supplierData.bsb || null,
            accountNumber: supplierData.accountNumber || null,
            address: supplierData.address || null,
            notes: supplierData.notes || null,
            active: true,
            isAutoPay: supplierData.isAutoPay ?? false,
          });
        }
      }

      // 2. Set ALLOW routing rule for the sender email (if external)
      //    Also auto-register form emails that aren't already rules
      const emailsToRegister = new Set<string>();
      if (senderEmail && !isInternal(senderEmail)) emailsToRegister.add(senderEmail);
      for (const e of supplierData.contactEmails ?? []) {
        if (e && !isInternal(e)) emailsToRegister.add(e);
      }
      for (const email of emailsToRegister) {
        await storage.upsertEmailRoutingRule({
          email,
          action: "ALLOW",
          supplierName: supplier.name,
        });
        console.log(`[Review/approve-group] ALLOW rule → ${email}`);
      }

      // 3a. Expand any REVIEW invoices that contain multiple line-items in rawExtractedData.invoices
      //     (happens when a Statement PDF is parsed with parseInvoiceFromUnknownSender)
      const allStores = await storage.getStores();
      const sushiStore  = allStores.find(s => s.name.toLowerCase().includes("sushi"));
      const sandwichStore = allStores.find(s => s.name.toLowerCase().includes("sandwich"));
      function storeIdForCode(code: string): string | null {
        if (code === "SUSHI" && sushiStore) return sushiStore.id;
        if (code === "SANDWICH" && sandwichStore) return sandwichStore.id;
        return null;
      }

      const reviewInvoices = await storage.getSupplierInvoices({ status: "REVIEW" });
      const matchingReview = reviewInvoices.filter(inv => {
        const raw = inv.rawExtractedData as any;
        const name: string = raw?.supplier?.supplierName ?? "";
        return name.toLowerCase().includes(supplierName.toLowerCase()) || supplierName.toLowerCase().includes(name.toLowerCase());
      });

      let expandedCount = 0;
      for (const reviewInv of matchingReview) {
        const raw = reviewInv.rawExtractedData as any;
        const lineItems: any[] = Array.isArray(raw?.invoices) ? raw.invoices : [];
        if (lineItems.length <= 1) continue; // single-item handled by sweep below

        // Expand into individual invoices
        const existing = await storage.getSupplierInvoices({ supplierId: supplier.id });
        const existingNumbers = new Set(existing.map(i => i.invoiceNumber));
        const pdfBase64 = raw?.pdfBase64 as string | undefined;

        let firstDone = false;
        for (const item of lineItems) {
          const invNum = item.invoiceNumber || null;
          if (invNum && existingNumbers.has(invNum)) continue; // skip pre-existing duplicates
          const storeId = storeIdForCode(item.storeCode ?? "UNKNOWN");
          try {
            if (!firstDone) {
              // Upgrade the placeholder itself
              await storage.updateSupplierInvoice(reviewInv.id, {
                supplierId: supplier.id, status: "PENDING",
                invoiceNumber: invNum || reviewInv.invoiceNumber,
                invoiceDate: item.issueDate || reviewInv.invoiceDate,
                dueDate: item.dueDate ?? undefined, amount: item.totalAmount ?? reviewInv.amount,
                storeId,
                rawExtractedData: pdfBase64 ? { ...raw, pdfBase64 } : raw,
                notes: `Imported from statement — approved via Review Inbox.\nFrom: ${raw?.senderEmail ?? ""}\nSubject: ${raw?.subject ?? ""}`,
              });
              firstDone = true;
              expandedCount++;
            } else {
              await storage.createSupplierInvoice({
                supplierId: supplier.id, storeId,
                invoiceNumber: invNum,
                invoiceDate: item.issueDate,
                dueDate: item.dueDate ?? undefined,
                amount: item.totalAmount,
                status: "PENDING",
                rawExtractedData: pdfBase64 ? { pdfBase64, senderEmail: raw?.senderEmail, subject: raw?.subject } : undefined,
                notes: `Imported from statement — approved via Review Inbox.\nFrom: ${raw?.senderEmail ?? ""}\nSubject: ${raw?.subject ?? ""}`,
              });
              expandedCount++;
            }
            // Track within-loop to avoid duplicate invoice numbers in the same statement
            if (invNum) existingNumbers.add(invNum);
          } catch (dupErr: any) {
            if (dupErr?.code === "23505" || dupErr?.message?.includes("unique constraint")) {
              console.warn(`[Review/approve-group] Skipping duplicate invoice ${invNum} for supplier ${supplier.id}`);
            } else {
              throw dupErr; // re-throw non-duplicate errors
            }
          }
        }
      }

      // 3b. Sweep by AI-extracted supplier name (PDF-parsed invoices — single-item)
      const sweptByName = await storage.sweepReviewInvoicesBySupplierName(supplierName, supplier.id);

      // 3c. Sweep by senderEmail (forwarded / no-PDF invoices where supplier.supplierName is absent)
      //     Only runs if a senderEmail is present — avoids false matches on empty strings.
      let sweptByEmail = 0;
      if (senderEmail) {
        sweptByEmail = await storage.sweepReviewInvoicesBySenderEmail(senderEmail, supplier.id);
      }

      const sweptCount = sweptByName + sweptByEmail + expandedCount;
      console.log(`[Review/approve-group] Supplier "${supplier.name}" (${supplier.id}). Expanded ${expandedCount} + swept ${sweptByName} by name + ${sweptByEmail} by email = ${sweptCount} invoice(s) → PENDING.`);
      res.json({ supplier, sweptCount });
    } catch (err: any) {
      console.error("Error approving supplier group:", err);
      res.status(500).json({ error: err?.message ?? "Failed to approve supplier group" });
    }
  });

  // ─── Backfill Intercompany Settlements (one-time fix for all past periods) ─
  app.post("/api/admin/backfill-settlements", async (req: Request, res: Response) => {
    try {
      // Fetch ALL saved payrolls that have fixedAmount > 0 (these are the ones that pay intercompany)
      const allPayrolls = await storage.getPayrolls();
      const fixedPayrolls = allPayrolls.filter(
        (p) => p.fixedAmount && parseFloat(String(p.fixedAmount)) > 0
      );

      let created = 0;
      let skipped = 0;

      for (const savedPayroll of fixedPayrolls) {
        const { employeeId, storeId: payingStoreId, periodStart, periodEnd } = savedPayroll;
        const fixedAmt = parseFloat(String(savedPayroll.fixedAmount));
        if (!periodStart || !periodEnd) { skipped++; continue; }

        // Get ALL approved shiftTimesheets for this employee in this period (across all stores)
        const allSheets = await storage.getShiftTimesheets({
          employeeId,
          startDate: periodStart,
          endDate: periodEnd,
          status: "APPROVED",
        });

        // Compute hours per store from actualStartTime/actualEndTime
        const hoursByStore: Record<string, number> = {};
        for (const sheet of allSheets) {
          const [sh, sm] = (sheet.actualStartTime || "0:0").split(":").map(Number);
          const [eh, em] = (sheet.actualEndTime || "0:0").split(":").map(Number);
          const diffMins = eh * 60 + em - (sh * 60 + sm);
          const hrs = (diffMins < 0 ? diffMins + 1440 : diffMins) / 60;
          hoursByStore[sheet.storeId] = Math.round(((hoursByStore[sheet.storeId] || 0) + hrs) * 100) / 100;
        }

        const totalHours = Object.values(hoursByStore).reduce((a, b) => a + b, 0);
        if (totalHours <= 0) { skipped++; continue; }

        // Cancel any existing settlements for this payroll to regenerate fresh
        const existing = await storage.getIntercompanySettlements({ payrollId: savedPayroll.id });
        for (const old of existing) {
          await storage.updateIntercompanySettlement(old.id, { status: "CANCELLED" });
        }

        // Detect Dual Role stores (employee has hourly rate > 0 there, no fixedAmount)
        const allAssignments = await storage.getEmployeeStoreAssignments({ employeeId });
        const dualRoleStoreIds = new Set(
          allAssignments
            .filter((a) => {
              const aRate  = parseFloat(String(a.rate  ?? "0") || "0");
              const aFixed = parseFloat(String(a.fixedAmount ?? "0") || "0");
              return aRate > 0 && aFixed === 0 && a.storeId !== payingStoreId;
            })
            .map((a) => a.storeId)
        );

        for (const [storeId, hours] of Object.entries(hoursByStore)) {
          if (storeId === payingStoreId) continue;
          if (hours <= 0) continue;
          if (dualRoleStoreIds.has(storeId)) continue;
          const portion = hours / totalHours;
          const amountDue = Math.round(fixedAmt * portion * 100) / 100;
          await storage.createIntercompanySettlement({
            payrollId: savedPayroll.id,
            employeeId,
            fromStoreId: storeId,
            toStoreId: payingStoreId,
            totalAmountDue: amountDue,
            paidInCash: 0,
            paidInBank: 0,
            status: "PENDING",
          });
          created++;
        }
      }

      res.json({ message: "Backfill complete", created, skipped });
    } catch (err) {
      console.error("Error backfilling settlements:", err);
      res.status(500).json({ error: "Backfill failed" });
    }
  });

  // ─── Intercompany Settlements ──────────────────────────────────────────────
  app.get("/api/settlements", async (req: Request, res: Response) => {
    try {
      const { status } = req.query as Record<string, string>;
      const settlements = await storage.getIntercompanySettlements(status ? { status } : undefined);

      // Enrich with employee and store names
      const employees = await storage.getEmployees();
      const allStores = await storage.getStores();
      const empMap = new Map(employees.map((e) => [e.id, e]));
      const storeMap = new Map(allStores.map((s) => [s.id, s]));

      const enriched = settlements.map((s) => ({
        ...s,
        employeeName: empMap.get(s.employeeId)?.preferredName || empMap.get(s.employeeId)?.legalFirstName || "?",
        fromStoreName: storeMap.get(s.fromStoreId)?.name || "?",
        toStoreName: storeMap.get(s.toStoreId)?.name || "?",
      }));

      res.json(enriched);
    } catch (err) {
      console.error("Error fetching settlements:", err);
      res.status(500).json({ error: "Failed to fetch settlements" });
    }
  });

  app.patch("/api/settlements/:id/settle", async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { paidInCash, paidInBank } = req.body as { paidInCash: number; paidInBank: number };
      const updated = await storage.updateIntercompanySettlement(id, {
        paidInCash: paidInCash || 0,
        paidInBank: paidInBank || 0,
        status: "SETTLED",
        settledAt: new Date(),
      });
      if (!updated) return res.status(404).json({ error: "Settlement not found" });
      res.json(updated);
    } catch (err) {
      console.error("Error settling:", err);
      res.status(500).json({ error: "Failed to settle" });
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
