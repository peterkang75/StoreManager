---
## MANDATORY POST-TASK CHECKLIST
This checklist MUST be completed after every coding task before marking done.
Report each item as PASS / FAIL / WARNING with file and line reference.

1. API REGISTRATION: Every new endpoint in storage.ts is registered in routes.ts with correct HTTP method.
2. SCHEMA-STORAGE SYNC: Every new table in schema.ts has methods in IStorage interface AND DatabaseStorage implementation.
3. FRONTEND-BACKEND CONTRACT: Every fetch() or apiRequest() in frontend points to an endpoint that exists in routes.ts.
4. TYPE SAFETY: No TypeScript errors. No undefined field access without null checks.
5. DATE HANDLING: No toISOString().slice(0,10) in new code. Use toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" }).
6. PROTECTED FILES: vite.ts, drizzle.config.ts, package.json were NOT modified.
7. DB MIGRATION: If schema.ts was modified, db:push was executed successfully.
8. PLAN.MD SYNC — update ALL of the following sections that are affected by this task.
   Do not skip any section. Vague or partial updates are not acceptable.

   SECTION 2.x (Database Schema tables):
   - Every new table added to schema.ts MUST appear in the correct Section 2.x table
     with its full field list and a clear Notes description.
   - If the table fits an existing section (e.g. 2.7 Operational Utilities), add it there.
   - If it does not fit, create a new subsection.

   SECTION 3.x (Implemented Modules & Features):
   - Every new feature or module MUST be documented under the correct Phase section.
   - Mark status clearly: ✅ COMPLETE / IN PROGRESS / ❌ NOT IMPLEMENTED.
   - Include enough detail that another developer could understand what was built
     without reading the code.

   SECTION 4 (API Endpoints):
   - Every new API endpoint registered in routes.ts MUST be added to the correct
     table in Section 4 with Method, Path, and Description.
   - This is non-negotiable. Missing endpoints in Section 4 = incomplete task.

   SECTION 5 (Known Constraints & Conventions):
   - If this task introduces a new architectural rule, convention, or constraint,
     add it to Section 5.

   SECTION 6 (Next Steps / Action Plan):
   - Mark completed items with [x] and ✅ COMPLETE.
   - Move newly started items to IN PROGRESS.
   - Add any newly identified follow-up tasks as [ ] items.
---

# Multi-Store Business Management System — Master Plan

> **Business context:** Australian retail/hospitality group operating multiple stores (Sushi, Sandwich, Meat, PYC, Holdings, Head Office).  
> **Roster & Employee Portal** features are scoped to **Sushi + Sandwich stores only**.  
> **Admin UI** labels/buttons in English; guidance/subtitle text in Korean.  
> **Employee Portal (mobile)** is English only.

---

## 1. Tech Stack & Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| UI Components | Shadcn UI, Tailwind CSS, Lucide React icons |
| Routing (frontend) | Wouter |
| Server State | TanStack Query v5 |
| Forms | React Hook Form + Zod resolver |
| Backend | Node.js, Express, TypeScript (tsx) |
| ORM | Drizzle ORM |
| Database | PostgreSQL (Neon serverless) |
| AI / LLM | OpenAI GPT-4o (invoice parsing) |
| PDF extraction | `pdftotext` CLI (via `spawnSync`) |
| Email inbound | Cloudmailin webhook → Gmail forwarding |
| File uploads | Multer (multipart), base64 for webhook |
| Session (portal) | localStorage key `ep_session_v5` (auto-migrated from legacy `ep_session_v4` sessionStorage) |

### Directory structure (key paths)

```
/
├── client/src/
│   ├── pages/
│   │   ├── admin/          # All admin desktop pages
│   │   └── mobile/         # Employee portal pages
│   ├── components/
│   │   ├── layouts/        # AdminLayout, etc.
│   │   └── ui/             # Shadcn primitives
│   └── lib/
│       └── queryClient.ts  # TanStack Query client + apiRequest helper
├── server/
│   ├── index.ts            # Express bootstrap, API response logger
│   ├── routes.ts           # All API route definitions
│   ├── storage.ts          # IStorage interface + DatabaseStorage implementation
│   ├── invoiceParser.ts    # PDF extraction + OpenAI invoice parsing pipeline
│   └── db.ts               # Drizzle DB connection (Neon)
├── shared/
│   └── schema.ts           # Drizzle table definitions, insert schemas, types
└── plan.md                 # This document
```

### Key architectural rules
- Frontend fetches from same-origin Express server (Vite proxies in dev, same port in prod).
- Business logic lives in `storage.ts`; routes stay thin (validate → call storage → return).
- `pdftotext` CLI used for PDF text extraction (not `pdf-parse`, which is incompatible).
- Webhook body limit set to **20 MB** to handle base64-encoded PDF attachments.
- Date math always uses **AEDT (Australia/Sydney)** local calendar dates via `toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" })` — never `toISOString().slice(0,10)`.
- **Draft State (Payroll):** `sessionStorage` is strictly used for payroll drafts to survive tab/store switching. Keys MUST be formatted as `payrollDrafts_${storeId}_${periodStart}_${periodEnd}` to prevent date collision. Drafts are only purged when a finalized DB record is detected for that specific context.

---

## 2. Database Schema

All tables use `varchar` UUID primary keys (`gen_random_uuid()`).

### 2.1 Core

| Table | Key Fields | Notes |
|---|---|---|
| `stores` | `id`, `name`, `code`, `address`, `active`, `isExternal`, `openTime`, `closeTime`, `globalPayrollNote` | Codes: Sushi=1, Sandwich=2, Meat=3, Holdings=4, PYC=8, HO=6 |
| `users` | `id`, `username`, `password` | Admin authentication (basic) |

### 2.2 People / HR

| Table | Key Fields | Notes |
|---|---|---|
| `candidates` | `id`, `name`, `dob`, `gender`, `nationality`, `visaType`, `visaExpiry`, `hireDecision` | Pre-hire pipeline |
| `employees` | `id`, `firstName`, `lastName`, `nickname`, `storeId`, `status`, `role`, `pin`, `salaryType`, `rate`, `fixedAmount`, `tfn`, `bsb`, `accountNo`, `superCompany`, `superMembershipNo`, `vevoUrl`, `selfieUrl`, `passportUrl`, `canSubmitCloseForm`, `canManageSchedule`, `canApproveTimesheet` | Status: ACTIVE/INACTIVE/TERMINATED |
| `employeeStoreAssignments` | `employeeId`, `storeId`, `rate`, `fixedAmount`, `isFixedSalary`, `salaryDistribute` | Multi-store rate overrides |
| `employeeOnboardingTokens` | `candidateId`, `employeeId`, `token`, `expiresAt`, `usedAt` | One-time link for self-onboarding |
| `employeeDocuments` | `employeeId`, `docType`, `filePath` | Uploaded HR documents |

### 2.3 Roster & Time

| Table | Key Fields | Notes |
|---|---|---|
| `rosters` | `storeId`, `employeeId`, `date`, `startTime`, `endTime`, `notes` | Flat weekly roster grid entries |
| `rosterPublications` | `storeId`, `weekStart`, `publishedAt` | Tracks which weeks have been published |
| `rosterPeriods` | `storeId`, `startDate`, `endDate`, `description` | Legacy period-based roster groups |
| `shifts` | `rosterPeriodId`, `storeId`, `employeeId`, `date`, `startTime`, `endTime`, `role` | Individual shift records under a period |
| `timeLogs` | `employeeId`, `storeId`, `shiftId`, `clockIn`, `clockOut`, `source`, `adjustmentReason` | Raw clock-in/out records |
| `shiftTimesheets` | `storeId`, `employeeId`, `date`, `actualStartTime`, `actualEndTime`, `status`, `isUnscheduled` | Per-shift timesheet submission from portal. Status: PENDING / APPROVED / REJECTED |
| `timesheets` | `employeeId`, `storeId`, `periodStart`, `periodEnd`, `totalHours`, `status`, `managerId`, `approvedAt` | Period-level timesheet aggregates |
| `shift_presets` | `id`, `storeId` (unique FK), `fullDayStart`, `fullDayEnd`, `openShiftStart`, `openShiftEnd`, `closeShiftStart`, `closeShiftEnd` | Per-store preset times for the 3 fixed quick-fill buttons (Full Day / Open Shift / Close Shift). One row per store; upserted on save. |
| `shift_preset_buttons` | `id` (serial PK), `storeId` (FK → stores), `name`, `startTime`, `endTime`, `sortOrder` | User-defined custom quick-fill buttons per store (e.g. "Full Day 2"). Unlimited per store. Displayed in CellEditor + Generate Shifts dialog alongside the 3 fixed presets. |
| `store_trading_hours` | `id` (serial PK), `storeId` (FK), `dayOfWeek` (varchar 3: "mon"–"sun"), `openTime`, `closeTime`, `isClosed` | Per-store, per-day-of-week trading hours. Composite unique index on `(storeId, dayOfWeek)`. Upserted on save. |
| `school_holidays` | `id` (serial PK), `name`, `startDate`, `endDate`, `createdAt` | Global school holiday periods (~4 per year, Australian VIC). Not per-store. |
| `public_holidays` | `id` (serial PK), `name`, `date`, `storeClosures` (jsonb: `{ storeId: boolean }`), `createdAt` | Australian public holidays. Each store's closure status stored in JSON map. Assumed open unless explicitly marked closed. |
| `store_recommended_hours` | `storeId` (PK, FK → stores), `termWeeklyHours` (real), `holidayWeeklyHours` (real), `updatedAt` | Per-store recommended weekly work hours during school term vs school holiday periods. |

### 2.4 Payroll & Finance

| Table | Key Fields | Notes |
|---|---|---|
| `payrolls` | `employeeId`, `storeId`, `periodStart`, `periodEnd`, `hours`, `rate`, `fixedAmount`, `calculatedAmount`, `adjustment`, `totalWithAdjustment`, `cashAmount`, `bankDepositAmount`, `taxAmount`, `grossAmount`, `superAmount`, `isBankTransferDone` | Australian ATO Schedule 1 FY2025-26 tax |
| `financialTransactions` | `transactionType`, `fromStoreId`, `toStoreId`, `cashAmount`, `bankAmount`, `referenceNote`, `isBankSettled` | Inter-store cash/bank flows (Convert, Remittance, Manual) |
| `dailyClosings` | `storeId`, `date`, `salesTotal`, `cashSales`, `cashOut`, `nextFloat`, `actualCashCounted`, `differenceAmount`, `creditAmount`, `ubereatsAmount`, `doordashAmount` | Admin-side EOD reconciliation |
| `cashSalesDetails` | `storeId`, `date`, `envelopeAmount`, `countedAmount`, denomination counts × 11 | Detailed coin/note breakdown |
| `dailyCloseForms` | `storeId`, `date`, `submittedBy`, denomination counts × 11, `numberOfReceipts`, `totalCalculated`, `envelopeAmount` | Employee-submitted EOD cash form |

### 2.5 Accounts Payable (AP)

| Table | Key Fields | Notes |
|---|---|---|
| `suppliers` | `name`, `abn`, `contactEmails[]`, `bsb`, `accountNumber`, `contactName`, `address`, `notes`, `active`, `isAutoPay` | `contactEmails` is a text array; `isAutoPay` triggers AUTO_DEBIT payment on invoice creation |
| `supplierInvoices` | `supplierId`, `storeId`, `invoiceNumber`, `invoiceDate`, `dueDate`, `amount`, `status`, `pdfUrl`, `rawExtractedData`, `sourceNote`, `deletedAt` | Status: PENDING / PAID / OVERDUE / QUARANTINE / REVIEW. Unique on `(supplierId, invoiceNumber)`. `deletedAt` enables soft-delete |
| `supplierPayments` | `supplierId`, `invoiceId`, `paymentDate`, `amount`, `method` | Payment records per invoice |
| `quarantinedEmails` | `senderEmail`, `subject`, `hasAttachment`, `rawPayload` | Emails from non-whitelisted senders |
| `rejectedEmails` | `id`, `senderEmail`, `senderName`, `subject`, `body`, `rawPayload` (jsonb), `receivedAt`, `suggestedSupplierId` (nullable), `reviewed` (bool) | Whitelist-only pipeline log — every webhook email whose sender is not in `suppliers.contactEmails` is parked here for manager review. Promoted to a supplier or deleted from the Rejected tab (§3.22). |
| `intercompanySettlements` | `id`, `fromStoreId`, `toStoreId`, `employeeId`, `payrollId`, `amount`, `periodStart`, `periodEnd`, `settledAt`, `settledByTransactionId` | Tracks inter-store salary debts; `settledAt` + `settledByTransactionId` record settlement |

### 2.6 System & Communication Tables

| Table | Key Fields | Notes |
|---|---|---|
| `todos` | `id`, `title`, `description`, `status`, `priority`, `dueDate`, `sourceEmail`, `senderEmail`, `originalSubject`, `originalBody`, `assignedTo` | Status: TODO / IN_PROGRESS / DONE. Email-originated tasks store raw email for AI reply workflow |
| `notices` | `id`, `title`, `content`, `targetStoreId`, `authorId`, `isActive`, `createdAt` | `targetStoreId = null` = global notice shown to all stores |
| `emailRoutingRules` | `email` (PK), `supplierName`, `action`, `createdAt` | Actions: `ROUTE_TO_AP` / `ROUTE_TO_TODO` / `FYI_ARCHIVE` / `SPAM_DROP` (legacy: `ALLOW` / `IGNORE`) |
| `universalInbox` | `id`, `senderEmail`, `senderName`, `subject`, `body`, `hasAttachment`, `rawPayload` (jsonb), `status`, `createdAt` | Status: `NEEDS_ROUTING` / `PROCESSED` / `DROPPED`. Full Cloudmailin payload stored for re-processing |
| `adminPermissions` | `role` + `route` + `label` (composite PK), `allowed` | RBAC permission matrix; seeded with defaults on first load |

### 2.7 Operational Utilities

| Table | Key Fields | Notes |
|---|---|---|
| `shoppingItems` | `id`, `storeId`, `name`, `category`, `unit`, `createdAt` | Catalogue of purchasable items per store |
| `activeShoppingList` | `id`, `storeId`, `itemId`, `quantity`, `addedBy`, `addedAt` | Current active shopping list (cleared once purchased) |
| `storageUnits` | `id`, `name` (unique), `createdAt` | Dynamic unit catalogue. Seeded with: ea, pack, box, ctn. Used as Select options for storageItems. |
| `storageItems` | `id`, `storeId`, `name`, `category`, `unit`, `currentStock`, `lastCheckedAt`, `lastCheckedBy`, `createdAt` | Storage room item catalogue per store. Unit references storageUnits.name. |
| `activeStorageList` | `id`, `storeId`, `itemId`, `addedBy`, `addedAt` | Items an employee plans to fetch from storage today. Cleared after fetching. |
| `automation_rules` | `id`, `title`, `actionType`, `frequency`, `daysOfWeek` (int[]), `targetEmployeeId`, `targetStoreId`, `payload` (jsonb), `description`, `isActive`, `lastExecutedAt`, `createdAt` | Recurring task automation rules. actionType: ROSTER / PAYROLL_ADJUSTMENT / FINANCE_TRANSFER. frequency: WEEKLY / MONTHLY_FIRST_WEEK / MONTHLY. payload shape varies by actionType. Executes via one-click from Dashboard widget. |

---

## 3. Implemented Modules & Features

> **§3.1–3.9** (완료 모듈 상세): [PLAN_ARCHIVE.md — Sections 3.1–3.9](PLAN_ARCHIVE.md#sections-31-39-core-implemented-modules)에 보관됨.
> **§3.10–3.25** (모두 ✅ 완료): [PLAN_ARCHIVE.md — Sections 3.10–3.25](PLAN_ARCHIVE.md)에 보관됨.


## 4. API Endpoints

> 전체 엔드포인트 목록: [PLAN_ARCHIVE.md — Section 4](PLAN_ARCHIVE.md#section-4-api-endpoints)에 보관됨. 새 엔드포인트 추가 시 아카이브 테이블에도 추가할 것.

---

## 5. Known Constraints & Conventions

- **`pdftotext`** must be available as a system binary (Nix environment has it installed).
- **`pdf-parse` npm package is not used** — incompatible with the ESM/TSX build.
- **Webhook sender**: always use `req.body.headers.from`, not `req.body.envelope.from`.
- **Week date helpers**: use `toYMD(d)` (local calendar fields) — never `toISOString().slice(0,10)`.
- **Payroll tax**: ATO Schedule 1 FY2025-26 weekly tax table.
- **`vite.ts`, `drizzle.config.ts`, `package.json`**: never modify these files.
- **Multi-store salary**: `salaryDistribute` field controls how fixed salary is split across multiple store assignments.
- **Store filter for roster/portal**: only stores where `name.toLowerCase()` includes `"sushi"` or `"sandwich"` show in roster builder and employee portal.
- **PIN storage**: always `bcryptjs` hashed (cost 10). Never store plain text. During migration, existing plain-text PINs continue to work and are auto-upgraded to bcrypt hash on first successful login. The `verifyPin(inputPin, storedPin)` helper in `server/routes.ts` handles both formats transparently.
- **Webhook Basic Auth**: `POST /api/webhooks/inbound-invoices` requires HTTP Basic Authentication. Credentials `CLOUDMAILIN_USER` and `CLOUDMAILIN_PASS` are stored as Replit Secrets (never in code). Auth check runs before all body parsing — unauthenticated requests receive HTTP 401 immediately.
- **Date-string parsing — local midnight**: Whenever a `YYYY-MM-DD` string must be turned into a `Date` for date-arithmetic (week buckets, cycle math, day-of-week, etc.), parse it as `new Date(dateStr + "T00:00:00")` *or* `new Date(y, mo − 1, d)`. Never `new Date(dateStr)` alone — that parses as UTC midnight and silently shifts to the previous calendar day in AEDT, producing off-by-one errors. This rule applies to Payroll period math, AccountsPayable week-grouping (`getMondayStr`), Roster grids, and anywhere similar.
- **Payroll cycle anchor (single source of truth)**: The fortnightly pay cycle grid is anchored to a fixed constant `PAY_CYCLE_ANCHOR = new Date(2026, 2, 23)` — Monday March 23, 2026, local midnight. Every pay period in the system (past or future) must align to this 14-day grid. Any UI that surfaces a pay period MUST validate that `(start − anchor) % 14 === 0` before treating it as a real cycle, and reject / round to the nearest valid cycle otherwise. This anchor MUST NOT be changed — moving it would invalidate every historical payroll record.
- **Mobile portal language**: English only. Admin: subtitle/guidance text in Korean, button/label/heading text in English. Mixing is intentional, not a bug.
- **Brand colours (hard-coded everywhere)**: Sushi `#16a34a` (green-600), Sandwich `#dc2626` (red-600). Used in store badges, payroll headers, AP store toggle buttons, dashboard cards, and roster grid colour-coding.
- **Express route ordering — literal paths before `:param`**: A literal route like `GET /api/payrolls/back-pay-candidates` MUST be registered *before* the parametric `GET /api/payrolls/:id`. Express matches in registration order, so a literal registered after `:id` is shadowed — `:id="back-pay-candidates"`, the param handler runs, `getPayroll()` finds nothing, and the client gets a silent `404`. This shipped broken in the back-pay feature (the endpoint 404'd for ~2 weeks; the banner never rendered for anyone). Fixed 2026-06-16 by moving the candidates route above `/api/payrolls/:id`. When adding any new `/api/<resource>/<literal>` GET, register it above `/api/<resource>/:id`.
- **Back-pay — uniform recording, branch only at payout (2026-06-16)**: Every back-pay item records BOTH `hours` and `amount` (notional = hours×rate) for ALL staff. A `paid_amount` column holds what was actually disbursed: `= amount` for hourly, `0` for fixed-salary (their pay doesn't change with hours — only hours are tracked, e.g. 40h-contract variance). Salary type is resolved per shift via `esa.fixed_amount>0 OR esa.is_fixed_salary IS TRUE OR employee.fixed_amount>0`. So: cost views sum `paid_amount` (fixed = $0), hours views sum `hours` (everyone). `applyBackPay` adds only `paid_amount` to adjustment/cash; fixed-salary apply records hours and pays nothing. Migration backfills existing rows `paid_amount = amount` once (guarded DO block — must NOT re-run, or it would overwrite future fixed-salary $0 rows).
- **Back-pay — payment vs cost are different periods (2026-06-16)**: A late-approved shift from a closed period is *paid* in the current pay run but is *expensed* in the period the work was done. (1) **Disbursement**: `applyBackPay` adds the amount to `adjustment` AND `cashAmount` (envelope), matching recalcRow's adjustment→cash model — otherwise the payslip/envelope/bank-deposit reports (which read the stored `cashAmount`/`bankDepositAmount`) would exclude it and the employee would not actually be paid. `grossAmount`/tax/super are left unchanged (back-pay is treated like any cash adjustment — no PAYG/super). (2) **Cost reporting**: `/api/dashboard/summary` attributes each `payroll_back_pay_items` amount to its `originalPeriodStart` via `getBackPayItemsForCostReport()`, so May work shows in May labor and June is not inflated. No double-count because `grossAmount` never holds back-pay. CAVEAT: `applyBackPay` records the FULL shift amount, not a delta — correct only for newly-*added* shifts; a modified-existing shift (hours already in the original `grossAmount`) would double-pay and double-count. All current items are newly-added shifts.

---

## 6. Next Steps / Action Plan

> Single source of truth for all project phases — completed, in-progress, and deferred.
> Cross-references the detailed feature documentation in §3 (Implemented Modules).

### 6.0 Active Issues & Bug Fixes 🚨 (Immediate Priority)

> Open production bugs and stability issues that take precedence over §6.2 feature work.

- [ ] **Platform migration: Replit → Claude Code + Railway** 🚧 (2026-04-21~)
  - Live checklist: `Migration.md` (project root)
  - **Railway production URL**: `https://storemanager-production-103d.up.railway.app`
  - Phase 0~5 완료 (2026-04-21). Phase 6a (feature smoke test) 이관 회귀 없음 확인.
  - **잔여 작업**: Phase 6b (Cloudmailin webhook URL 전환 — 사용자 직접), Phase 6c (1~3일 Railway 관찰), Phase 7 (Replit Archive — 1~2주 관찰 후).
  - On completion: Replit Production 401 bug (below) becomes obsolete — Railway env vars are set explicitly in Phase 4.3.

- [ ] **Production 401 Unauthorized error** — API requests in the deployed environment intermittently return HTTP 401 even for endpoints that succeed in development.
  - **Investigation surface**: API auth middleware in `server/routes.ts` (PIN-protected routes + webhook Basic Auth), plus the production environment-variable set in Replit Secrets.
  - **Likely culprits**: missing or stale `CLOUDMAILIN_USER` / `CLOUDMAILIN_PASS` / `OPENAI_API_KEY` in production, session/cookie middleware behaving differently behind the deploy proxy, or a CORS/credentials mismatch on cross-subdomain requests.
  - **First step**: pull deployment logs around the 401 timestamps + diff the production secrets list against the dev secrets list.


> ✅ 해결된 버그 상세: [PLAN_ARCHIVE.md — Section 6.0](PLAN_ARCHIVE.md#section-60-resolved-bugs)에 보관됨.

---

### 6.1 Completed Phases ✅

| Phase | Title | Detail Section |
|---|---|---|
| Phase 1 | Accounts Payable Fine-Tuning (AI parser, webhook routing, dashboard checkboxes, bulk pay) | §3.8 – §3.16 |
| Phase 2 | Communication & Mobile (Notice Board, PWA install) | §3.12 |
| Phase 3 | Executive Cockpit + RBAC (AI email reply, Smart Inbox widget, permission matrix) | §3.11, §6.4 below |
| Phase 4 | Settings Consolidation (Shift Presets, Store Settings, Automation Rules) | §3.17 – §3.20 |
| Phase 5 | Storage & Shopping Module (storage room inventory, dynamic units, shopping cart) | §3.5.2 below |
| Phase 6 | Payroll Cycle Hardening (fixed-anchor 14-day grid, sessionStorage period persistence, AP week separator, local-midnight date parsing) | §3.6, §3.14, §5 |
| Phase 7 | AP Whitelist-Only Pipeline + Stuck-Invoice Recovery (rejected_emails, 4-way classifier, bulk-reclassify, multi-store supplier resolver, body-text fallback, Xero sender fix) | §3.22 |
| Phase 8 | AP + Payroll UX Polish (week bands, Shift+click range, copy buttons, per-store Bank Transfer Tracker cards) | §3.23, §3.24 |
| Phase 9 | Employee Portal UX Hardening Batch (session persistence v5, PIN safety, timesheet guards, notices dismiss, profile draft) | §3.25 |


> **§6.1.1–6.1.13** (완료 Phase 상세): [PLAN_ARCHIVE.md — Section 6.1](PLAN_ARCHIVE.md#section-61-completed-phases--detailed-breakdowns)에 보관됨.

---

### 6.2 In Progress 🚧

#### 6.2.1 Manager Reporting Dashboard (High Priority)
> **2026-05-05 업데이트:** 본 항목은 §7.6 Wave 2 (운영 P&L Dashboard)로 흡수되었음. Wave 2 완료 시 본 항목 ✅ COMPLETE 마킹.

- [ ] Combine payroll totals (labour cost) + AP invoice totals (COGS) + daily sales totals per store.
- [ ] Calculate and display:
  - Labor % = Total Payroll ÷ Total Sales × 100
  - COGS % = Total Supplier Invoices ÷ Total Sales × 100
  - Gross Profit % = (Sales − Labor − COGS) ÷ Sales × 100
- [ ] Weekly and monthly trend charts per store.
- [ ] Reuses existing `/api/dashboard/summary` (with the `periodStart > endDate` fix from §3.6) — extend with COGS aggregation.

---

### 6.3 Deferred / Future Backlog 📋

> Items intentionally postponed. Each entry includes the reason it was deferred and any prerequisite work.

#### 6.3.0 Mobile Portal: Manager Personal-vs-Team View 📱
- **Status:** Phase 0 완료 (2026-04-30). Phase 1+ 대기.
- **Scope:** OWNER/MANAGER가 포털에서 본인 데이터 + 팀 시프트/타임시트 동시 열람. 현재 포털은 `session.id`로 하드 스코프.
- **Phase 1:** `usePortalScope` 훅 + `<ScopeToggle>` (My/Team), `GET /api/portal/team-week`, Schedule 탭 토글 (OWNER→Team default). 권한 가드: 미들웨어가 storeIds 검증.
- **Phase 2:** Timesheets + Home 탭 Team 모드. `GET /api/portal/team-history`, `/api/portal/team-today`.
- **Phase 3:** MobileClock Team 모드 (공유 기기 위협 모델 별도 검토).
- **Plan 파일**: `/Users/peter/.claude/plans/peppy-splashing-thompson.md`

#### 6.3.0a Admin/Non-Portal API Authentication (Phase B) 🚨
- **Status:** Critical security gap — see §6.0. Phase 0 fixed only `/api/portal/*`.
- **Scope:** Wire `express-session` + `connect-pg-simple` (already installed; `SESSION_SECRET` env var exists). Add admin login flow (현재 어드민 페이지는 PIN 인증 없이 직접 접근 가능). Apply role-based gate middleware to all `/api/*` (non-portal) routes: `/api/employees`, `/api/payrolls`, `/api/daily-closings`, `/api/suppliers`, `/api/invoices`, `/api/timesheets`, `/api/rosters`, `/api/finance/*`, `/api/cash-sales`, etc.
- **Effort:** 1–2 days. Risk: every existing admin page must continue to work after gate lands — careful enumeration of routes vs missed routes.
- **Why deferred from Phase 0:** Sized to half-day quick fix originally, ballooned to multi-day once the missing session infra was discovered. User opted for narrow Phase 0 (portal only) with this followup.

#### 6.3.1 PWA Service Worker (offline + push)
- **Status:** Deferred from Phase 2.
- **Scope:** Register a service worker for offline shell caching, background sync for timesheet submissions, and Web Push notifications for shift reminders.
- **Prereq:** None — `manifest.json` and theme-color are already in place.

#### 6.3.2 AI Executive Assistant — Smart Inbox v2
- **Status:** Logged for later (originally Phase 4).
- **Scope:** Beyond the existing Triage Inbox + AI translation, add: per-email AI categorisation (Action / FYI / Spam) with confidence score, one-click "smart reply" suggestions, and a daily Korean digest email summarising overnight inbound mail.
- **Prereq:** Existing `POST /api/ai/email-translate-summarize` endpoint can be reused.

#### 6.3.3 Auto To-Do Extraction & Time-Based Reminders
- **Status:** Logged for later (originally Phase 4).
- **Scope:** GPT pipeline that reads inbound emails, extracts actionable tasks + implicit due dates, and creates `todos` rows automatically. Background scheduler fires reminders ("Invoice from X due in 3 days") via `mailer.ts` or in-app notification.
- **Prereq:** None — `todos` schema already supports `dueDate` and `senderEmail`.

#### 6.3.4 B2B Catering & Delivery App (separate project)
- **Status:** Future, separate codebase.
- **Scope:** Standalone web app for Sushi + Sandwich corporate catering orders (menu browsing, quote requests, advance ordering). Reuses existing Stripe e-commerce code from a sister project.
- **Prereq:** None — independent repo.

#### 6.3.5 DoorDash Drive Integration (in catering app)
- **Status:** Future, dependent on §6.3.4.
- **Scope:** White-label flat-fee last-mile delivery via DoorDash Drive API. Replaces consumer-facing DoorDash for catering orders to retain brand control.

#### 6.3.6 Sales Sync Webhook (catering → management)
- **Status:** Future, dependent on §6.3.4.
- **Scope:** Catering app POSTs completed order/sales data to this management system's `/api/dashboard/summary` in real-time, eliminating manual sales entry for catering revenue.

#### 6.3.7 Automated Notification Logic (Cron Jobs)
- **Status:** Logged for later — companion to the deferred PWA Service Worker (§6.3.1).
- **Scope:** Server-side cron / scheduled jobs that fire automatic notifications without manager intervention:
  - **Clock-in reminder** — N minutes before a rostered shift start, push to the rostered employee.
  - **Clock-out reminder** — N minutes after shift end if no clock-out recorded, push to the employee.
  - **Daily Close Form reminder** — fire to closing-shift employees of Sushi/Sandwich at the store's `closeTime` if no form submitted.
- **Prereq:** Push subscription pipeline from §6.3.1 + `Notification.requestPermission()` UI (already shipped per §3.21) + a job runner (`node-cron` or similar, registered in `server/index.ts`).
- **Design rule:** Same opt-in principle as §6.4 — notifications are reminders, never silent state mutations.

#### 6.3.8 Full Storage List Implementation
- **Status:** ⚠️ Already shipped — see §6.1.6 + §3 (`storageItems`, `activeStorageList`, `storageUnits` tables, `/admin/storage` admin page, `StorageListView` portal component, dynamic units management).
- **Listed here for traceability** because it appeared on the original future-roadmap discussion. If the request was for *additional* storage features (e.g. low-stock alerts, automatic reorder suggestions, supplier link from stock items), file those as new sub-items.

#### 6.3.9 Custom Domain & SSL Setup
- **Status:** Logged for later (post-launch).
- **Scope:** Move the production deployment off the default `*.replit.app` URL onto a custom Australian domain (e.g. `.com.au`). Configure DNS (A/CNAME), point at Replit's deployment, verify automatic SSL provisioning, update PWA `manifest.json` `start_url`, update Cloudmailin webhook URL, update any hard-coded URLs in mailer templates.
- **Prereq:** Domain purchase + DNS access. Coordinate with §6.0 401 fix so the auth/cookie config is solid before introducing a new origin.

#### 6.3.10 Shopping List Optimisation
- **Status:** Partially complete — sort-by-`selectionCount` already shipped (§6.1.6). Remaining work below.
- **Scope:**
  - **"Frequently Bought Items" surface** — promote the top-N items per store to a dedicated "Quick Add" row at the top of `ShoppingListView`, separate from the category-grouped catalogue. Computed from `selectionCount` over a rolling time window (last 30 days) rather than all-time.
  - **Mobile swipe-to-complete** — currently items are ticked off via tap. Add native-feeling left-swipe-to-remove gesture (e.g. via Framer Motion drag) so finger-only operation while shopping is faster.
- **Prereq:** None.

#### 6.3.11 Gmail API Direct Integration — Replace Cloudmailin
- **Status:** 결정 완료, AP 안정화 후 시작 예정.
- **동기:** Cloudmailin이 대용량 첨부 메일을 무음으로 드롭 (2026-04-23 첫 사례: Newline Beverages EStatement.pdf "Message too large"). Gmail API 직접 폴링으로 25MB 제한까지 커버 + Cloudmailin 의존성 제거.
- **결정:** Cloudmailin 완전 대체 (병행 X). Gmail `gmail.readonly` 스코프, 5분 폴링, messageId dedup.
- **구현 플랜 (~1.5일):** Phase 1 OAuth 셋업 → Phase 2 폴링 워커 → Phase 3 DB 스키마(`gmail_config`, `gmail_processed_messages`) → Phase 4 모니터링 위젯. 상세: [PLAN_ARCHIVE.md 미작성 — 시작 세션에 작성].
- **Cut-over:** Gmail 폴러 ≥3일 병행 관찰 → Cloudmailin 비활성화 → Railway env 제거.
- **Prereq:** 없음. AP 수동 정리 안정화 후 시작.

#### 6.3.12 Post-Payroll Back-Pay Workflow (Late-Approval Recovery) ✅
- **Status:** 구현 완료 (2026-06-04). 5/4~5/17 누락분 시범 처리 대기.
- **동기 / 실제 사례:** 2026-05-04~05-17 페이롤 마감(2026-05-19) 이후 매니저가 2026-05-21에 7개 시프트를 사후 일괄 입력 → Anjali 4건(36h raw), Dawa 2건(22h raw), Swaraj 1건(9h raw) 미지급 상태로 표류. 시스템은 누락 사실을 알리지도, 처리 경로를 제공하지도 않음.
- **목표:** (1) 페이롤 마감 후 status/시간 변경된 시프트 자동 검출 (2) 다음 페이롤에 한 클릭으로 back-pay 반영 (3) 중복 반영 원천 차단 (4) 마감 전 PENDING 잔존 시 경고.
- **결정 사항 (사용자 확정 2026-06-04):**
  - **Q1=B**: 5/4~5/17 누락 7건은 이 기능의 첫 사용 케이스로 처리 (수동 SQL 없음).
  - **Q2=A**: 한 클릭으로 `payrolls.adjustment` 자동 가산 + `adjustmentReason` 자동 입력.
  - **Q3=A**: 페이롤 저장 시 PENDING 시프트 잔존 경고 같이 구현.
- **마감 정의:** 별도 `lockedAt` 도입 없이 기존 `payrolls.created_at` = 마감 시점. 검출 조건: `shift_timesheets.updated_at > 그 기간 payroll.created_at` & `status=APPROVED` & `payroll_back_pay_items`에 미등록.
- **시급 한계:** 시프트 시점 시급 별도 저장 없음 → **현재 직원 시급**으로 back-pay 계산 (인상 후엔 인상 시급 적용됨, 운영상 받아들임).
- **REJECTED 처리 (1차 보류):** 마감 후 REJECTED 전환은 1차에서 검출 표시만, 마이너스 adjustment는 오너 수동.
- **신규 테이블 (단 하나):** `payroll_back_pay_items(id, shift_timesheet_id UNIQUE, applied_to_payroll_id, original_period_start, original_period_end, hours, rate, amount, reason, created_at)`. UNIQUE 제약이 중복 반영 차단의 핵심.
- **구현 순서:**
  | Step | 작업 | 상태 |
  |---|---|---|
  | 1 | DB schema + storage 메서드 (`detectBackPayCandidates`, `applyBackPay`) | ✅ |
  | 2 | `GET /api/payrolls/back-pay-candidates` + `POST /api/payrolls/:id/back-pay-apply` + `GET .../back-pay-items` | ✅ |
  | 3 | Payrolls.tsx 상단 알림 배너 + 상세 모달 (체크박스 + Apply) | ✅ |
  | 4 | 페이롤 Save 시 PENDING 잔존 경고 dialog | ✅ |
  | 5 | PaySlips.tsx에 "Back Pay" 별도 라인 표시 (amber 강조 + 라벨) | ✅ |
  | 6 | 5/4~5/17 누락 시범 처리 + 타입체크 + 배포 | 🚧 prod 검증 대기 |
- **검출 검증 결과 (prod 데이터, 2026-06-04):** Sushi 8건 (Anjali 4 + Dawa 2 + Karma Yonjan 2 신규 발견) + Sandwich 1건 (Swaraj Ghising 5/16) = 총 9건. 사용자가 처음 알려준 7건 외에 Karma Yonjan 2건 추가 발견 — 검출 로직이 의도대로 wider net.
- **위험 / 회복:** Migration 추가형 → 코드 롤백만으로 회복 가능. 기존 페이롤 계산 로직(adjustment, totalWithAdjustment) 재사용 — 기존 페이롤 변경 없음. UNIQUE 위반 시 transaction 롤백.
- **Prereq:** 없음.

---

### 6.4 Architectural Principles (Maintained)

- **Automation Rules — no fully-automatic execution.** Every recurring task always requires a human "Execute" click on the Dashboard widget. Reminders only — never silent background mutations to payroll, finance, or rosters. Reuse existing storage/API methods inside `executeAutomationRule()` rather than building parallel logic paths.
- **Sydney timezone everywhere.** All "today" / "this week" / "this cycle" calculations use `Australia/Sydney` via `toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" })`. Never `toISOString()` for date strings.
- **Anchor-based cycles.** The fortnightly payroll grid is anchored to a fixed constant (§5) and must never drift. Adding new cycle-aware UI must validate against the anchor before treating any period as legitimate.
- **Session vs database boundary.** Drafts (payroll inputs, selected period, etc.) live in `sessionStorage` keyed by context. The DB only ever sees finalised, validated data. On commit, the matching session key is purged to prevent ghost re-hydration.
파일 분리 리팩토링 완료 이후 구현 예정

---

## 7. Crew × Xero Payroll + 운영 회계 통합 (New Initiative)

> **Status (2026-05-05):** Planning complete. Wave 1 ready to start.
> **Conversation source:** 2026-05-05 brainstorming session with user (kept in this section verbatim where decisions were made — implementation may happen weeks/months later, every detail must be self-contained here).
> **Master goal:** 회계사 비용 절감 + 중복 입력 제거. Crew는 사장이 자체 처리할 수 있는 모든 영역을 처리, 회계사는 판단·신고(BAS, EOFY, Income Tax)만 담당.

### 7.1–7.4 배경·결정 (아카이브됨)

> 전체 배경, 원칙, 확정 결정 사항 (D1~D21), Wave 전략 상세: [PLAN_ARCHIVE.md — Section 7.1–7.4](PLAN_ARCHIVE.md#section-71-74-xero-initiative--background--decisions)에 보관됨.

**핵심 요약:**
- **Crew = 운영 P&L**, **Xero = 회계신고** — 데이터 이중 입력 없음, 목적별 분리
- **Wave 1** (~6일): Supplier GST + Cash Expense | **Wave 2** (~3일): 운영 P&L Dashboard | **Wave 3** (~8일): Xero OAuth + Pay Run + BAS Export
- **STP 추가 필드** (Wave 3 전 필요): `employmentStartDate`, `superFundAbnOrUsi`, `residencyStatus`, `tfnDeclarationStatus`, `helpStslDebt`
- 21개 결정 (D1~D21) 확정 완료 (2026-05-05)

### 7.5 Wave 1 — Cash Expense + Supplier GST

**범위:** Supplier에 GST 비율 추가 + Cash Expense 입력/검토 시스템 + AP 인보이스 GST 자동 계산 표시
**예상 기간:** ~6일 (Auto mode wall-clock)
**위험도:** 낮음 (외부 API 연동 없음, 기존 모듈 확장만)
**의존성:** 없음

> **§7.5.1–7.5.4 (DB/Schema/Storage/API 구현 스펙):** Wave 1 Day 1~2 커밋으로 구현 완료. 상세: [PLAN_ARCHIVE.md — Section 7.5.1–7.5.4](PLAN_ARCHIVE.md#section-7514-wave-1-dbstorageapi-구현-스펙-day-12-완료)

#### 7.5.5 UI 변경

**1. Supplier 등록/수정 폼 (admin) — `/admin/suppliers`**
- 기존 폼 (§3.9)에 "GST 적용 비율" 필드 추가
- 입력: 슬라이더 (0~100) 또는 number input
- 짧은 설명 라벨: "0=GST 없음 (신선식품 위주), 50=Woolworths처럼 혼합, 100=전액 GST 적용"
- Sandwich 매장 가이드 예시 (helper text):
  - Woolworths/Coles → 50%
  - 야채 도매상 → 0%
  - Drink wholesaler → 100%
- Sushi 매장 가이드 예시:
  - Chicken Shop → 0%
  - 야채/생선 도매상 → 0%
  - Drink wholesaler → 100%
  - Utensil/Daiso → 100%

**2. Cash Expense 입력 — Daily Close form 안에 섹션 추가 (D12)**
- 위치: `client/src/pages/mobile/DailyCloseForm.tsx` (또는 동등 파일)
- 새 섹션 "현금 지출 (Cash Expenses)" — Daily Close 마감 화면 안 카드
- 입력 row 컴포넌트:
  - Supplier 드롭다운 (autocomplete from suppliers list, **select-only — D13**)
    - 신규 supplier 추가는 admin만 가능 → 직원이 모르는 곳에서 사면 다른 처리
  - Amount input (numeric, AUD)
  - Memo input (optional)
  - "Add" 버튼 → row 추가 + 화면에 "GST 추정: $X" 표시
- 한 Daily Close에 여러 cash expense 가능 (반복 추가)
- "Other"/신규 vendor 처리 (D14):
  - 직원이 supplier 드롭다운에서 "Other / Unknown" 옵션 선택
  - Memo 입력 강제 (3자 이상 검증) — 어떤 곳에서 어떤 항목 샀는지 짧게
  - 시스템: 임시 supplier 마커 또는 "Unknown" supplier (single record per store)에 매핑 + review_status='PENDING'
  - 사장 검토 화면에서 이 항목들을 별도 강조 → 사장이 (a) 기존 supplier로 재할당 + GST 비율 적용, (b) 신규 supplier 등록 + 매핑, (c) 그대로 유지하되 GST 비율 수동 지정

**3. Cash Expense 검토 화면 (admin) — 새 페이지 또는 기존 페이지 확장**
- 위치 후보 1: `/admin/accounts-payable` 페이지에 새 탭 ("Cash Expenses")
- 위치 후보 2: `/admin/cash` (Finance / Cash) 페이지에 섹션 추가
- → 1차 권장: AccountsPayable 안에 탭. AP 모듈과 데이터 모델 공유 (suppliers).
- 표시:
  - 기간 토글: 주간 / 월간 / 분기 (D19에 맞춰 동일 컴포넌트로)
  - 매장 필터 (기존 store toggle 재사용)
  - 합계: 총 지출 / GST 추정 합계 / PENDING 건수
  - Supplier 그룹 (collapsible) — supplier 별 합계 + GST 추정 + 항목 list
  - PENDING ("Other"/신규 vendor) 항목 별도 섹션 강조 → 사장이 처리
  - Row 액션: Edit (수정), Delete, Approve (PENDING → APPROVED)
- 합계 카드: "이번 주 현금 지출: 25건 / 합계 $487 / GST 추정 환급가능 $24.30 / PENDING 처리 필요: 7건"

**4. AP Invoice GST 자동 계산 표시**
- `/admin/accounts-payable` 화면에서 invoice row에 GST 표시
- 계산: `invoice.amount × supplier.defaultGstRate / 100 / 11`
- DB 저장 X — UI 표시만 (Wave 3에서 supplier_invoices에 정식 컬럼 추가)
- Tooltip: "Supplier defaults to {N}% GST applicable. Override on Wave 3+"

#### 7.5.6 Wave 1 작업 순서 (TDD, 일별 commit)

| Day | 작업 | 상태 |
|---|---|---|
| 1 | DB migration + supplier API 확장 + supplier 폼 UI (`defaultGstRate` 필드) | ✅ 완료 (47dddf8) |
| 2 | `cash_expenses` 테이블 + storage methods + POST/GET API | ✅ 완료 (ddf5bd8) |
| 3 | Daily Close form에 cash expense 섹션 + 입력 row 컴포넌트 + `/api/cash-expenses/suppliers` 직원용 picker | ✅ 완료 (8cba571) |
| 4 | Cash expense 검토 탭 (AP 페이지 안, 주간/월간/분기 토글, PENDING 강조, supplier 그룹, edit/delete/approve) | ✅ 완료 (085cf15) |
| 5 | AP 인보이스 GST 추정 표시 (To Pay 행/그룹헤더 + Paid History 행) + Other/Unknown sentinel을 AP supplier picker 3곳에서 숨김 | ✅ 완료 (feffa91) |
| 6 | 버그 fix + 사장 직접 시범 사용 + 작은 UX 조정 | 🚧 사장 시범 사용 대기 |

각 day 끝에 `git add ... && git commit && git push` (Railway 자동 배포 → 사장이 실제 매장에서 시도).

#### 7.5.7 Wave 1 회복 / 롤백

- 모든 DB migration은 additive — 문제 발생 시 컬럼/테이블 그대로 두고 코드만 롤백 가능
- 기존 AccountsPayable, Daily Close, Suppliers 모듈 동작 변경 없음 (UI 추가만)
- 직원 portal에 새 입력 섹션 추가 — 안 쓰면 그만, 기존 흐름 영향 없음

#### 7.5.8 Wave 1 결과물 (사용자 가시 변화)

- Supplier 등록 시 GST 비율 입력 가능
- 직원이 Daily Close 마감 시 그날 현금으로 산 항목 입력 가능
- 사장이 매주/매월 cash expense 합계와 GST 추정치 확인 가능
- AP 인보이스에 GST 추정치 표시 (운영 P&L 정확성 향상)
- 데이터가 쌓이기 시작 → Wave 2의 운영 P&L 입력 데이터 확보

### 7.6 Wave 2 — 운영 P&L Dashboard

> **참고:** §6.2.1 "Manager Reporting Dashboard"가 이 Wave의 일부로 흡수됨. §6.2.1의 항목은 Wave 2 완료 시 ✅로 마킹.

**범위:** 매장별 운영 P&L을 기존 Dashboard에 통합. Daily Close 매출 + AP 결제 + Cash Expense + Payroll 합산 → 매장별 실시간 수익.
**예상 기간:** ~3일 (Auto mode wall-clock)
**위험도:** 낮음 (UI 추가만, 데이터는 모두 존재)
**의존성:** Wave 1 완료 (cash_expenses 데이터 + supplier GST 비율)

#### 7.6.1 데이터 소스 (모두 기존 Crew DB)

| 항목 | 소스 테이블 | 비고 |
|---|---|---|
| 매출 | `dailyClosings.salesTotal`, `dailyClosings.cashSales` 등 | EFTPOS / Cash 분리 |
| COGS (paid invoices) | `supplierPayments` JOIN `supplierInvoices` JOIN `suppliers` | supplier별 그룹, GST 추정 |
| Cash Expenses | `cash_expenses` (Wave 1 신규) | supplier별 그룹, GST 스냅샷 |
| Payroll | `payrolls.cashAmount + bankDepositAmount + taxAmount + superAmount` | 항목별 분리 |

#### 7.6.2 새 API endpoint

`GET /api/operational-pnl`
- Query: `storeId`, `from`, `to`, `granularity` (week|month|quarter)
- 응답:
```json
{
  "period": { "from": "2026-04-21", "to": "2026-04-27" },
  "store": { "id": "...", "name": "Sandwich Shop" },
  "sales": {
    "total": 14250.00,
    "eftpos": 11820.00,
    "cash": 2430.00
  },
  "cogs": {
    "total": 3840.00,
    "gstEstimate": 245.00,
    "bySupplier": [
      { "supplierId": "...", "name": "Bidfood", "amount": 2100.00, "gst": 95.45 },
      ...
    ]
  },
  "cashExpenses": {
    "total": 340.00,
    "gstEstimate": 18.00,
    "bySupplier": [...]
  },
  "payroll": {
    "total": 5420.00,
    "bankDeposit": 4800.00,
    "cashWages": 420.00,
    "taxAndSuper": 200.00
  },
  "operatingProfit": 4650.00,
  "operatingProfitPct": 32.6
}
```

#### 7.6.3 UI 변경 (D18 — 기존 Dashboard 그래프 활용)

- 위치: `client/src/pages/admin/Dashboard.tsx` (또는 ManagerDashboard.tsx)
- 신규 위젯/섹션 추가, 기존 그래프 패턴 재사용
- 기간 토글: Week / Month / Quarter (D19) — 기존 store toggle 옆에 배치
- 표시: 매장별 카드 또는 테이블 (위 §7.6.2 응답 구조 그대로)
- 그래프: 매출/COGS/Payroll 추세 (existing chart 컴포넌트 재사용)

#### 7.6.4 Wave 2 작업 순서

| Day | 작업 |
|---|---|
| 1 | `/api/operational-pnl` endpoint + 데이터 집계 로직 (sales + cogs + cash + payroll) |
| 2 | Dashboard에 위젯 추가 + 기간/매장 토글 + 합계 카드 |
| 3 | 그래프 추가 (추세 시각화) + 사장 검토 + UX 조정 |

#### 7.6.5 Wave 2 결과물

- 사장이 Dashboard에서 "이번 주/월/분기 매장 운영 수익"을 한눈에 확인
- COGS·Cash·Payroll 비중 즉시 파악
- §6.2.1 Manager Reporting Dashboard 기능 완성

### 7.7 Wave 3 — Xero Pay Run 푸시 + BAS Export

**범위:** 매장별 Xero OAuth + Employee 매핑 + STP 데이터 보완 + Pay Run Draft 푸시 + 분기 BAS Export PDF
**예상 기간:** ~8일 | **위험도:** 중 (OAuth + STP 컴플라이언스) | **의존성:** Wave 1 완료

**신규 테이블:** `xero_connections`, `xero_oauth_states`, `employee_xero_links`, `xero_pay_runs`
**employees 추가 필드:** `employmentStartDate`, `superFundAbnOrUsi`, `residencyStatus`, `tfnDeclarationStatus`, `helpStslDebt`
**supplier_invoices 추가 필드:** `gstAmount`, `gstRateSnapshot`
**NPM:** `xero-node` | **Railway env:** `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_TOKEN_ENCRYPTION_KEY`
**Pay Run 흐름:** bankDepositAmount > 0 행만 Draft 푸시 → 사장이 Xero에서 검토 후 Post(STP 자동 ATO 제출) → Auto Super
**BAS Export:** Summary.pdf (매출/COGS/Cash Expenses/Payroll + GST 분리) + Invoices/ ZIP

> 상세 구현 스펙 (DB SQL, 폴더 구조, API 전체 목록, 작업 순서): [PLAN_ARCHIVE.md — Section 7.7](PLAN_ARCHIVE.md#section-77-wave-3--xero-pay-run-푸시--bas-export-상세-구현)

### 7.8–7.11 Phase 2+ Backlog / 운영 패턴 / 분담표 / 업데이트 규칙

> 상세: [PLAN_ARCHIVE.md — Section 7.8–7.11](PLAN_ARCHIVE.md#section-7811-xero-phase-2-backlog--operational-notes)

### 7.12 진행 추적 (Tracker)

| Wave | 상태 | 시작일 | 완료일 | 비고 |
|---|---|---|---|---|
| Planning | ✅ COMPLETE | 2026-05-05 | 2026-05-05 | D1~D21 확정 |
| Wave 1 | 🚧 IN PROGRESS | 2026-05-05 | – | Day 1~5 완료. Day 6 (사장 시범 사용 + 버그 fix) 대기 |
| Wave 2 | 📋 PLANNED | – | – | Wave 1 운영 검증 후 |
| Wave 3 | 📋 PLANNED | – | – | Wave 2 완료 후 |
| Phase 2+ | 📋 BACKLOG | – | – | PLAN_ARCHIVE.md §7.8 |
