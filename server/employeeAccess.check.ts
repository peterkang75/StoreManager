// Run: npx tsx server/employeeAccess.check.ts
import assert from "node:assert/strict";
import { filterEmployeeUpdate, coworkerView } from "./employeeAccess";

const emp = { id: "e1", role: "EMPLOYEE", allowedRoutes: [] };
const mgr = { id: "m1", role: "MANAGER", allowedRoutes: ["/admin/employees"] };
const staff = { id: "s1", role: "STAFF", allowedRoutes: ["/admin/rosters"] };
const admin = { id: "a1", role: "ADMIN", allowedRoutes: ["*"] };
const evil = { role: "ADMIN", rate: "99", bsb: "123456", passwordHash: "x", canApproveTimesheet: true, canOrder: true, pin: "1111" };

// Employee, own record: only profile fields survive.
assert.deepEqual(filterEmployeeUpdate(emp, { id: "e1", role: "EMPLOYEE" }, evil), { ok: true, body: { bsb: "123456" } });
// Employee, someone else: refused.
assert.equal(filterEmployeeUpdate(emp, { id: "x", role: "EMPLOYEE" }, evil).ok, false);
// Manager with matrix access, other staff: everything but role/can*/passwordHash.
assert.deepEqual(filterEmployeeUpdate(mgr, { id: "e1", role: "EMPLOYEE" }, evil), { ok: true, body: { rate: "99", bsb: "123456", pin: "1111" } });
// Manager on own record: no self pay rise, no self promotion.
assert.deepEqual(filterEmployeeUpdate(mgr, { id: "m1", role: "MANAGER" }, evil), { ok: true, body: { bsb: "123456" } });
// Manager on an ADMIN record: refused.
assert.equal(filterEmployeeUpdate(mgr, { id: "a1", role: "ADMIN" }, { email: "x" }).ok, false);
// Staff without /admin/employees: refused for others.
assert.equal(filterEmployeeUpdate(staff, { id: "e1", role: "EMPLOYEE" }, { status: "INACTIVE" }).ok, false);
// Admin: everything except passwordHash.
const a = filterEmployeeUpdate(admin, { id: "e1", role: "EMPLOYEE" }, evil);
assert.ok(a.ok && a.body.role === "ADMIN" && a.body.canOrder === true && !("passwordHash" in a.body));
// Coworker view drops sensitive data.
assert.deepEqual(coworkerView({ id: "e1", firstName: "A", lastName: "B", tfn: "1", bsb: "2", rate: "3", status: "ACTIVE" }), { id: "e1", firstName: "A", lastName: "B", status: "ACTIVE" });

console.log("employeeAccess checks passed");
