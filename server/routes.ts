import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage, generateSecureToken } from "./storage";
import { insertStoreSchema, insertCandidateSchema, insertEmployeeSchema } from "@shared/schema";
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

  return httpServer;
}
