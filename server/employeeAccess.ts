// Who may change which employee fields via PUT /api/employees/:id, and what
// a portal (EMPLOYEE) session may see of coworkers. Pure so it can be checked
// without a DB: `npx tsx server/employeeAccess.check.ts`.

export type Viewer = { id: string; role: string; allowedRoutes: string[] };

// Exactly what the portal "Edit my profile" form sends (EmployeePortal.tsx ProfileFormData).
export const SELF_SERVICE_FIELDS = [
  "email", "streetAddress", "streetAddress2", "suburb", "state", "postCode",
  "visaType", "visaSubclass", "visaExpiry", "workEntitlements", "passportNo", "nationality",
  "selfieUrl", "passportUrl", "fhc", "tfn", "accountName", "bsb", "accountNo",
  "superCompany", "superMembershipNo",
];

// Never writable through this endpoint, even by ADMIN (passwords go through set-password).
const NEVER_FIELDS = ["id", "passwordHash", "createdAt", "updatedAt", "lastLoginAt"];

// Only ADMIN may change these: role and every can* permission switch.
const isAdminOnlyField = (k: string) => k === "role" || /^can[A-Z]/.test(k);

// What a portal session sees of a coworker (Clock/Roster pickers need id, name, status).
const COWORKER_FIELDS = ["id", "nickname", "firstName", "lastName", "status", "storeId", "role", "selfieUrl"];

export type UpdateDecision = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

export function filterEmployeeUpdate(
  viewer: Viewer,
  target: { id: string; role: string | null },
  body: Record<string, unknown>,
): UpdateDecision {
  const role = viewer.role.toUpperCase();
  const pick = (allow: (k: string) => boolean) =>
    Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => !NEVER_FIELDS.includes(k) && allow(k)));

  if (role === "ADMIN") return { ok: true, body: pick(() => true) };

  // Own record: self-service profile fields only, whatever the role.
  if (target.id === viewer.id) return { ok: true, body: pick((k) => SELF_SERVICE_FIELDS.includes(k)) };

  if (role === "EMPLOYEE") return { ok: false, status: 403, error: "FORBIDDEN_NOT_SELF" };
  if (!viewer.allowedRoutes.includes("/admin/employees") && !viewer.allowedRoutes.includes("*")) {
    return { ok: false, status: 403, error: "FORBIDDEN_ROUTE" };
  }
  if ((target.role ?? "").toUpperCase() === "ADMIN") return { ok: false, status: 403, error: "FORBIDDEN_ADMIN_TARGET" };
  // Strip rather than reject: the admin detail page saves the whole record, unchanged role included.
  return { ok: true, body: pick((k) => !isAdminOnlyField(k)) };
}

export function coworkerView(emp: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(emp).filter(([k]) => COWORKER_FIELDS.includes(k)));
}
