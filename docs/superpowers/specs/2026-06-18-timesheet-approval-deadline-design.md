# Timesheet Approval Deadline + Director Override — Design

Date: 2026-06-18
Status: Approved (inline) — implementing

## Problem

The "마감" (close) of a payroll period is implicit: it happens when the owner saves
the payroll (`payrolls.created_at`). Managers have no visible deadline for finishing
timesheet approvals, so shifts get approved *after* a period is closed (real case:
Susan's 06-01~06-14 shifts approved 06-17, a day after the 06-16 payroll close).
Late approvals silently miss the run and require messy back-pay / unlock workarounds.

## Goal

1. A clear, automatic per-cycle **approval deadline**.
2. Managers see the deadline prominently on the Approve screen.
3. After the deadline the cycle is **locked** for managers; the screen tells them to
   contact the Director for manual handling.
4. The **Director (ADMIN)** can temporarily reopen (unlock) a locked store+cycle, and
   can always edit directly without unlocking.

## Deadline definition (Australia/Sydney)

- Cycle = 14 days, Mon→Sun (anchor 2026-03-09), per `shared/payrollCycle.ts`.
- Approval deadline = **end of the Monday following the period** ("그 다음 월요일 자정").
  - e.g. period 06-01~06-14 (Sun end) → managers may approve through all of Mon 06-15
    → cycle **locks at 06-16 00:00 Sydney**.
- Rule: `closed = sydneyToday >= shiftDate(cycleEnd, 2)`. Buffer Monday = `shiftDate(cycleEnd, 1)`.

## Enforcement model: server-side (real lock) + UI banner

UI-only blocking is bypassable (refresh / direct API), so the lock is enforced on the
server. The Approve screen reaches the handlers with `req.user` populated (global
`requireAuth`); **ADMIN bypasses all gates**, MANAGER is the lock target.

Guarded endpoints (all manager mutations on `shift_timesheets`):
`/:id/approve`, `/:id/edit-approve`, `/:id/update-times`, `/:id/reject`, `DELETE /:id`,
`/add-shift`, `/auto-fill`, `/bulk-approve`, `/bulk-revert`.

Guard logic (shared helper): if `role === "ADMIN"` → allow. Else resolve the affected
shift's `storeId` + `date` → cycleStart. If `closed` and no active override for
(store, cycle) → `403 { error: "CYCLE_LOCKED", message, deadline }`.

## Director override (manual re-lock)

New table `timesheet_approval_overrides(id, store_id, cycle_start, unlocked_by,
unlocked_at)`, UNIQUE(store_id, cycle_start). **Row exists = that store+cycle is
force-open.** Director re-lock deletes the row.

ADMIN-only endpoints:
- `POST /api/admin/approvals/unlock-cycle` { storeId, cycleStart }
- `POST /api/admin/approvals/relock-cycle` { storeId, cycleStart }
- `GET  /api/admin/approvals/cycle-status?storeId=&cycleStart=` →
  `{ cycleStart, cycleEnd, deadlineMonday, closed, overrideActive, serverToday }`

## Frontend (TimesheetApprovals.tsx — already cycle-based)

Top banner keyed to the displayed `cycleStart` + `storeFilter`:
- Always: "이번 급여 주기(start~end) 근무시간 승인 마감: {Mon}(월) 자정까지".
- Locked & no override: red — "이 주기는 마감되었습니다. 수정이 필요하면 Director에게 연락하세요."
  Manager mutation buttons disabled (server enforces regardless; toast on 403).
- Locked & override active: amber — "Director가 임시로 열어둠".
- ADMIN (`useAdminRole().currentRole === "ADMIN"`): when a single store is selected on a
  locked cycle, show Unlock / Re-lock toggle. ADMIN is never blocked.
  When storeFilter = ALL on a locked cycle, prompt director to pick a store to unlock.

## Relationship to existing concepts

Separate, additive time-based lock on **manager approval actions**. Coexists with the
payroll save-close (`created_at`) and the employee submission window. If a cycle stays
locked, late shifts still flow through the existing **back-pay** path.

## Edge cases

- Susan (06-01 shift approved 06-18): cycle locked 06-16 → manager blocked, contact
  director. Exactly intended.
- add-shift / auto-fill into a locked cycle → blocked.
- All date math in Australia/Sydney (DST-safe via `toLocaleDateString` with timeZone).
