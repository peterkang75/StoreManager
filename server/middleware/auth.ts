// Phase B: role-based authentication middleware.
//
// Architecture:
// - One Bearer token per logged-in user (portal_sessions table).
// - requireAuth attaches req.user = { id, role, email, allowedStoreIds, allowedRoutes }.
// - requireRole gates by exact role match.
// - requirePermission consults the AccessControl matrix (adminPermissions table)
//   via apiToRouteKey() to decide if the user can hit this API path.
// - validateStoreScope rejects writes when the body/query storeId isn't in the user's allowed list.
//
// All middleware is no-op on req.user.role === "ADMIN" — admins bypass all gates.

import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";

export interface AuthUser {
  id: string;
  role: string;
  email: string | null;
  allowedStoreIds: string[];
  allowedRoutes: string[]; // empty array if matrix not consulted; "*" for ADMIN
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== "string") return null;
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

/**
 * requireAuth: validates Bearer token, loads user info, attaches to req.user.
 * Returns 401 if missing/invalid/expired token.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearer(req);
  if (!token) {
    return res.status(401).json({ error: "AUTH_REQUIRED", message: "Authentication required" });
  }

  const session = await storage.getPortalSession(token);
  if (!session) {
    return res.status(401).json({ error: "SESSION_EXPIRED", message: "Session expired or invalid" });
  }

  const emp = await storage.getEmployee(session.employeeId);
  if (!emp) {
    return res.status(401).json({ error: "USER_NOT_FOUND", message: "User no longer exists" });
  }

  const role = (emp.role ?? "EMPLOYEE").toUpperCase();
  const [allowedStoreIds, allowedRoutes] = await Promise.all([
    storage.getEmployeeAllowedStoreIds(emp.id, role),
    storage.getRoleAllowedRoutes(role),
  ]);

  req.user = {
    id: emp.id,
    role,
    email: emp.email,
    allowedStoreIds,
    allowedRoutes,
  };
  next();
}

/**
 * requireRole(...allowedRoles): allows only specific roles. ADMIN always passes.
 * Use for owner-only routes (financial, system config).
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (req.user.role === "ADMIN") return next();
    if (allowedRoles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "FORBIDDEN", message: "Insufficient role" });
  };
}

/**
 * Map an /api/* path to the AccessControl matrix routeKey (frontend path style).
 * Returns:
 *   - "ADMIN_ONLY" — only ADMIN role permitted, matrix not consulted
 *   - null — no permission check needed (e.g., /api/upload available to all authed users)
 *   - "/admin/*" — matrix routeKey to look up in user.allowedRoutes
 */
export function apiToRouteKey(apiPath: string): string | "ADMIN_ONLY" | null {
  // ADMIN-only routes (matrix not consulted)
  if (apiPath.startsWith("/api/store-config")) return "ADMIN_ONLY";
  if (apiPath.startsWith("/api/automation-rules")) return "ADMIN_ONLY";
  if (apiPath.startsWith("/api/email-routing-rules")) return "ADMIN_ONLY";
  if (apiPath.startsWith("/api/universal-inbox")) return "ADMIN_ONLY";
  if (apiPath.startsWith("/api/rejected-emails")) return "ADMIN_ONLY";
  if (apiPath.startsWith("/api/settlements")) return "ADMIN_ONLY";

  // Owner-tier financial — owner-only via routeKey or ADMIN_ONLY tag.
  // We map to the corresponding admin frontend page so the matrix can decide
  // (default matrix allows MANAGER on payrolls, suppliers, etc.; ADMIN can revoke).
  if (apiPath.startsWith("/api/payrolls")) return "/admin/payrolls";
  if (apiPath.startsWith("/api/finance")) return "/admin/finance";
  if (apiPath.startsWith("/api/suppliers/invoices") || apiPath.startsWith("/api/supplier-invoices")) return "/admin/suppliers/invoices";
  if (apiPath.startsWith("/api/suppliers")) return "/admin/suppliers";
  if (apiPath.startsWith("/api/supplier-payments")) return "/admin/accounts-payable";
  if (apiPath.startsWith("/api/invoices")) return "/admin/suppliers/invoices";

  // Operations & people
  if (apiPath.startsWith("/api/employees") || apiPath.startsWith("/api/employee-store-assignments")) return "/admin/employees";
  if (apiPath.startsWith("/api/candidates")) return "/admin/candidates";
  if (apiPath.startsWith("/api/rosters") || apiPath.startsWith("/api/roster-periods") || apiPath.startsWith("/api/shift-presets") || apiPath.startsWith("/api/shifts")) return "/admin/rosters";
  if (apiPath.startsWith("/api/timesheets") || apiPath.startsWith("/api/time-logs") || apiPath.startsWith("/api/attendance")) return "/admin/timesheets";
  if (apiPath.startsWith("/api/admin/approvals")) return "/admin/approvals";
  if (apiPath.startsWith("/api/daily-closings") || apiPath.startsWith("/api/daily-close-forms") || apiPath.startsWith("/api/cash-sales")) return "/admin/cash";
  if (apiPath.startsWith("/api/notices")) return "/admin/notices";
  if (apiPath.startsWith("/api/dashboard")) return "/admin";
  if (apiPath.startsWith("/api/stores")) return "/admin/stores";

  // Mobile/admin shared (low-sensitivity)
  if (apiPath.startsWith("/api/storage") || apiPath.startsWith("/api/shopping")) return "/admin/rosters";
  if (apiPath.startsWith("/api/upload")) return null; // any authed user

  // Permissions matrix CRUD itself — ADMIN only
  if (apiPath.startsWith("/api/permissions")) return "ADMIN_ONLY";

  // Default to ADMIN_ONLY for unknown admin paths (safe default)
  return "ADMIN_ONLY";
}

/**
 * requirePermission: checks AccessControl matrix for the request path.
 * ADMIN bypasses. MANAGER/STAFF must have the routeKey in user.allowedRoutes.
 */
export function requirePermission() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (req.user.role === "ADMIN") return next();

    const key = apiToRouteKey(req.path);
    if (key === null) return next(); // no permission check for this path
    if (key === "ADMIN_ONLY") {
      return res.status(403).json({ error: "FORBIDDEN_ADMIN_ONLY", message: "Admin role required" });
    }
    if (req.user.allowedRoutes.includes(key) || req.user.allowedRoutes.includes("*")) return next();
    return res.status(403).json({ error: "FORBIDDEN_ROUTE", message: "Route not permitted for your role", routeKey: key });
  };
}

/**
 * validateStoreScope: ensures the storeId in query/body is in user.allowedStoreIds.
 * ADMIN bypasses. If no storeId is supplied, the route handler should auto-filter by allowedStoreIds.
 */
export function validateStoreScope(getStoreId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "AUTH_REQUIRED" });
    if (req.user.role === "ADMIN") return next();
    const storeId = getStoreId(req);
    if (!storeId) return next(); // handler will auto-filter
    if (!req.user.allowedStoreIds.includes(storeId)) {
      return res.status(403).json({ error: "FORBIDDEN_STORE", message: "Store not in your assigned scope" });
    }
    next();
  };
}
