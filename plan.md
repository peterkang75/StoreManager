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

### 3.1 Store Management (`/admin/stores`)
- List all stores with status (active/external flags).
- Add new store, edit store details (name, code, address, open/close times).
- Set a per-store global payroll note (displayed on payroll views).
- Store colour coding throughout the app: Sushi `#16a34a` (green), Sandwich `#dc2626` (red).

### 3.2 Employee Management (`/admin/employees`)
- Full employee list with **status filter** (defaults to ACTIVE), sorted: Sushi → Sandwich → HO → others, then nickname alphabetically.
- Add / Edit employee with comprehensive profile: personal info, visa details, pay info (hourly rate or fixed salary), banking (TFN, BSB, account), superannuation, portal PIN, role flags.
- **Multi-store assignment**: employees can be assigned to multiple stores with per-store rate overrides.
- **VEVO verification**: upload visa VEVO PDF → server extracts text via `pdftotext` → parses and stores verification details (`vevoUrl`, `vevoVerifiedAt`, `vevoVerifiedBy`). VEVO lock applied to restricted fields when a VEVO file exists.
- Employee detail page (`/admin/employees/:id`) with all tabs.
- **Direct Register**: create an employee account directly without onboarding flow.
- **Onboarding flow**: generate one-time token → candidate completes self-service form at `/onboarding/:token` → employee record created.
- Bulk CSV import for employee records; photo import endpoint.
- Employee documents upload (passport, etc.).

### 3.3 Candidate Pipeline (`/admin/candidates`)
- Track pre-hire candidates (interview notes, visa, availability, desired rate).
- Hire decision: PENDING / HIRED / REJECTED.
- Promote candidate to employee via "Hire" action (generates onboarding token or direct register).
- Interview form at `/mobile/interview` for capturing candidate details on mobile.

### 3.4 Roster Builder (`/admin/rosters`)
- **Weekly grid roster** for Sushi and Sandwich stores only.
- Select store + week → grid of employees × days.
- Add/edit/delete shifts per cell with start/end times and notes.
- **Cell quick-fill buttons**: Full Day / Open Shift / Close Shift (times from `shift_presets`) + any custom buttons (from `shift_preset_buttons`) for the selected store.
- **Copy previous week** to clone an existing roster week.
- **Generate Shifts** (bulk create): opens `GenerateRosterDialog` — select shift type, days (Mon–Sun), employees, and overwrite toggle → creates multiple shifts in one action via `POST /api/rosters/bulk-create`. See §3.18.
- **Publish roster**: marks a `(storeId, weekStart)` as published, making it visible to employees in the portal.
- Roster publication status shown in grid.

### 3.5 Timesheet Approvals (`/admin/approvals`)
- Admin view of all `shiftTimesheets` submitted by employees via portal.
- Filter by store and status (Pending / Approved / All); payroll cycle navigator (14-day periods).
- **Approve** individual submissions or **bulk approve** all pending for an employee at once.
- **Edit + Approve**: ±15-min quick-adjust buttons auto-save times before approval.
- **Update Times (no approve)**: save adjusted times without changing status (`PUT /api/admin/approvals/:id/update-times`).
- Shows scheduled vs actual times; highlights discrepancies and unscheduled shifts.
- **Auto-Fill from Roster**: creates PENDING timesheets for any rostered shift that has no submission yet.
- **Add Missing Shift**: manager can manually add an ad-hoc shift directly from the review modal (`POST /api/admin/approvals/add-shift`).
- **Standalone Add Shift button:** A global "Add Shift" button added to the Pending Approvals page header (alongside Auto-Fill from Roster and Weekly Payroll). Opens a modal that allows adding a shift for ANY employee — including INACTIVE employees and free-text names for one-off workers not in the system. Employee search covers all statuses. Uses existing POST /api/admin/approvals/add-shift endpoint. The existing per-employee "Add Missing Shift" inside the detail modal is unchanged.
- **Mark Absent**: reject/tombstone a shift so Auto-Fill won't recreate it (`PUT /api/admin/approvals/:id/reject`).
- **Bulk Revert**: revert all APPROVED timesheets for an employee back to PENDING (`POST /api/admin/approvals/bulk-revert`). Used when corrections are needed after approval.
- **Responsive layout**: desktop shows employee table → click to open detail modal; mobile shows employee summary cards → tap to open bottom-sheet review modal with per-shift cards (no horizontal scroll on mobile).

### 3.5a Admin Timesheets History (`/admin/timesheets`)
- Separate read-only view showing **all approved timesheets** (APPROVED status only) across all stores, navigable by payroll cycle.
- Grouped by employee; shows scheduled vs actual hours, discrepancy delta, store name.
- **Revert to Pending**: individual approved shifts can be reverted back to PENDING from this page (calls `PUT /api/admin/approvals/:id/reject` or equivalent revert action).
- Payroll cycle navigator (14-day periods); store filter.
- Shows payroll lock status (if a payroll has been generated for the period, shifts are displayed as locked).

### 3.6 Payroll (`/admin/payrolls`, `/admin/weekly-payroll`)
- **Generate payroll** for a period: pulls approved timesheets, calculates pay from hours × rate (or fixed amount) per employee.
- **ATO Schedule 1 FY2025-26** tax withholding calculation built in.
- Superannuation (11.5%) calculated automatically.
- Split payroll into **cash** and **bank deposit** amounts.
- Adjustment field (bonus/deduction) with reason.
- Mark bank transfer done with date stamp.
- **Pay slips** printable view per employee per period.
- **Payroll import** from archived legacy data.
- **Weekly payroll summary** (`/admin/weekly-payroll`): aggregated view across stores.
- **Draft Persistence & Ghost Prevention:** Payroll inputs are saved to `sessionStorage` per store and period. The UI hydrates from this session. Once a payroll is generated/saved to the DB, the specific session draft is forcefully purged to prevent "ghost" deductions.
- **Intercompany Transfers:** If an employee has a fixed salary at Store A but works at Store B, Store B does not pay them directly (`cash = 0`, `bank = 0`, `tax = 0` forced by backend). Instead, Store B accrues an Intercompany Settlement debt to Store A.
- **Dual Role Exception:** If an employee has a fixed salary at Store A but earns a direct *Hourly Rate* at Store B (e.g., Peter), the Intercompany zero-override is bypassed, and their direct payout at Store B is preserved.
- **Unified Bank Transfer Tracker:** A modal tracking all pending banking outflows for a period. It combines both **Direct Employee Bank Deposits** (`bank > 0`) AND **Intercompany Settlements** (e.g., `Karma [ Transfer to Sandwich ]`) into a single actionable list for the manager.
- **Settle Intercompany Debt:** `PATCH /api/settlements/:id/settle` — marks a settlement record as settled, linking it to a `financialTransaction` ID.
- **Backfill Settlements:** `POST /api/admin/backfill-settlements` — admin utility to retroactively generate `intercompanySettlements` records for historical payroll periods that pre-date the feature.
- **Dashboard Labor filter (bug fix):** `GET /api/dashboard/summary` now filters payroll periods using `periodStart > endDate` (previously `periodEnd > endDate`). This correctly includes any payroll period that overlaps the selected date range — a period is only excluded when its *start* is beyond the range end, not when its *end* is.
- **Draft Cash Balance (Real-time):** While editing payroll, the top CashBalances widget shows a "Draft: $X,XXX" line under each store's balance card. This reflects the current session's total cash outflow in real-time before saving to DB. All store drafts (Sushi, Sandwich, etc.) are visible simultaneously regardless of which store is currently selected in the payroll form. Implemented via `draftByStore` prop (Record<storeId, totalCash>) computed from `payrollDrafts` state in PayrollPage and passed down to CashBalances widget. **A negative `Draft: -$X` value is expected behavior** — it represents the projected cash balance *after* the pending payroll outflow is settled (current cash − draft outflow), not a calculation bug.
- **Fixed Fortnightly Pay Cycle (anchored, never drifting):** `getCurrentPayCycle()` replaces the legacy "last completed Sunday" logic with a fixed 14-day grid anchored to `PAY_CYCLE_ANCHOR = new Date(2026, 2, 23)` (Monday March 23, 2026, local midnight). `cycleIndex = floor(daysSinceAnchor / 14)`, then `cycleStart = anchor + cycleIndex * 14` and `cycleEnd = cycleStart + 13`. Example cycles: Mar 23 – Apr 5 (cycle 0), **Apr 6 – Apr 19** (cycle 1), Apr 20 – May 3 (cycle 2), and so on indefinitely in both directions. Today's cycle is computed from AEDT (`Australia/Sydney`) so the boundary flips at Sydney midnight, not UTC midnight. Prev / Next navigation moves by exactly ±14 days, always landing on a valid cycle boundary.
- **Period Persistence Across HMR / Reload:** The selected pay period is mirrored to `sessionStorage` under `PERIOD_SS_KEY` (key: `"payroll_selected_period"`) as `{ start, end }`. On mount, the stored value is restored *only if* its `start` aligns with the fixed-cycle grid (i.e. `(savedStart − PAY_CYCLE_ANCHOR) % 14 === 0`). Misaligned legacy entries (e.g. saved when the old `getLastFortnight()` returned non-cycle dates) are silently discarded and the current cycle is used instead. This prevents Vite HMR or accidental page reloads from snapping the manager back to the default cycle while they are mid-edit.
- **Local-midnight date parsing:** All date math inside Payroll (`shiftPeriod`, period validation, etc.) parses `YYYY-MM-DD` strings via `new Date(dateStr + "T00:00:00")` so that the resulting `Date` represents local midnight in the browser's timezone. Using bare `new Date(dateStr)` would parse as UTC midnight, which lands on the previous calendar day in AEDT — causing the wrong day-of-week and off-by-one period errors.

### 3.7 Finance / Cash (`/admin/finance`, `/admin/cash`)
- **Inter-store transactions**: Convert (float transfer), Remittance (store → HO), Manual entry.
- Track cash and bank amounts separately per transaction.
- **Bank settlement** toggle per transaction.
- **Store balances** summary view (running cash/bank totals per store).
- **Daily Closings** (`/admin/cash`): admin enters EOD reconciliation figures per store per day.
- Cash sales detail breakdown: denomination counts × 11 denominations ($100 → 5¢).
- Bulk cash sales entry and legacy import.
- Void a day's cash records.
- **Real-time Global Cash Widget:** The top dashboard cash balance strictly displays the *Actual DB Cash Balance*. It explicitly DOES NOT subtract active payroll drafts (`sessionStorage`) to avoid visual double-deductions and negative balance confusion before a payroll is actually finalized.
- **Manual Cash Adjustment & Audit Trail:** Managers can align the system's Cash Balance with the physical safe using the "Manual Entry" feature. They can record `Cash In` or `Cash Out` with specific categories (e.g., Petty Cash, Till Shortage, Owner Deposit) and notes. This creates a permanent audit trail transaction instead of destructively overwriting the balance.

### 3.8 Accounts Payable Dashboard (`/admin/accounts-payable`)
- **Summary cards**: `Total Payable` (all pending) + `Selected Total` (live sum of currently selected invoices, highlights in primary color when >0). Overdue amount shown in red beneath Total Payable if any exist.
- **View Tabs** (left-aligned): `To Pay` (PENDING + OVERDUE) | `Paid History` (PAID, sorted by updatedAt desc).
- **Store Toggle Buttons** (center-aligned in control bar): `All Stores` | `Sushi` | `Sandwich` | `Holdings` | `PYC` in that order. Resolved by keyword match on store name (case-insensitive).
- **To Pay view**: invoices grouped by supplier in collapsible Accordion cards (all open by default).
  - Supplier header: name, invoice count, total unpaid, **real-time selected subtotal** ("$X selected (N)" in primary color, visible when any invoice in group is selected), "Overdue: $X" in red (if applicable), select-all checkbox.
  - Expanded table columns: Invoice Date | Amount | Due Date (overdue red + AlertCircle; due-soon orange) | Invoice # | Store.
  - Overdue rows sorted to top within each group; rows highlighted with faint red background.
- **Paid History view**: invoices grouped by **payment date** (collapsible cards), then within each date group further grouped by **supplier** (collapsed by default). Each supplier row shows: supplier name · invoice count · supplier subtotal. Click to expand individual invoice rows (Invoice Date | Amount | Invoice # | Store | Payment method).
- **Top-right action bar** (inline, right of store filter buttons): when ≥1 invoice selected, shows selected total amount + `Clear` + `Pay Selected (N)` button. No sticky bottom bar.
- **Bulk Pay**: parallel PATCH `/api/invoices/:id/status` → `{ status: "PAID" }`, then invalidate query cache and clear selection.
- **Add Invoice** (`+ Add Invoice` button, top-right above summary cards):
  - Opens `AddInvoiceModal` with two tabs: **AI Scan** and **Manual Entry**.
  - **AI Scan tab**: Drag-and-drop or browse file upload (JPEG, PNG, WebP, PDF, max 10 MB). Calls `POST /api/invoices/parse-upload` (multer memory storage). Uses GPT-4o Vision for images, `extractPdfText` + GPT-4o for PDFs. On success auto-switches to Manual Entry with pre-filled fields.
  - **Manual Entry tab**: Supplier dropdown, Store dropdown, Invoice Number, Amount (AUD), Invoice Date, Due Date (optional). Validated with Zod + react-hook-form.
  - Saves via `POST /api/invoices` → `status: "PENDING"`. Invalidates `/api/invoices` query cache on success.
  - `parseUploadedFile()` in `server/invoiceParser.ts` handles both image (base64 Vision) and PDF (text extraction) parsing. Returns `{ supplierName, invoiceNumber, invoiceDate, dueDate, amount, storeCode }` plus fuzzy-matched `matchedSupplierId`.

### 3.9 Supplier Management (`/admin/suppliers`)
- List all suppliers with ABN, whitelisted contact emails (shown as tags), BSB/account number.
- Add / Edit supplier with full AP fields: name, ABN, contact name, contact emails (comma-separated → stored as array), BSB, account number, notes, active toggle.
- Whitelisted emails drive the webhook routing logic (see §3.10).

### 3.10 Invoice Inbound Pipeline (Webhook / Cloudmailin) + Auto-Discovery ✅ COMPLETE
- **Email flow**: Supplier sends invoice PDF to a dedicated email address → Gmail forwards to Cloudmailin → Cloudmailin POSTs multipart payload to `POST /api/webhooks/inbound-invoices`.
- **Basic Auth security**: The webhook endpoint verifies HTTP Basic Authentication on every request. Credentials are read from `process.env.CLOUDMAILIN_USER` and `process.env.CLOUDMAILIN_PASS` (stored as Replit Secrets). Requests without a valid `Authorization: Basic <base64>` header return HTTP 401 immediately — before any body parsing or business logic executes.
- **Sender extraction**: from `req.body.headers.from` only (`envelope.from` is skipped as it contains Gmail forwarding artifacts).
- **Routing logic** (checked in this order):
  1. Check `emailRoutingRules` table for the sender email.
  2. If rule = **IGNORE** → discard silently (no DB record).
  3. If rule = **ALLOW** → treat as known supplier, proceed to PDF extraction + AI parsing → `status: PENDING`.
  4. Check `suppliers.contactEmails` whitelist:
     - **Matched**: proceed to PDF extraction + AI parsing → `status: PENDING`.
  5. **Unknown sender with attachment** → Auto-Discovery flow:
     - Extract PDF text.
     - Call `parseInvoiceFromUnknownSender()` (GPT-4o) to get `UnknownSenderParsedResult`.
     - Insert record(s) with `status: "REVIEW"` + `rawExtractedData` JSON blob (contains extracted supplier info, invoice items).
  6. **Unknown sender, no attachment** → silently ignored.
  7. **Unreadable PDF** → quarantined to `quarantinedEmails` table.
- **PDF extraction**: attachment decoded from base64 (`content` field), `pdftotext` CLI extracts text.
- **AI parsing** (`server/invoiceParser.ts`):
  - `parseInvoiceWithAI(text, supplierName)` — known supplier: returns `ParsedInvoice[]` (invoiceNumber, issueDate, dueDate, totalAmount, storeCode).
  - `parseInvoiceFromUnknownSender(text)` — unknown sender: returns `UnknownSenderParsedResult` (supplier name/email/ABN/address + invoice array).
- **Duplicate check**: skip if `(supplierId, invoiceNumber)` already exists (NULL supplierId treated as distinct by PostgreSQL).
- **Email Routing Rules** (`emailRoutingRules` table): manager-controlled ALLOW/IGNORE per sender email with optional `supplierName` label.
- **CRUD endpoints**: `GET/PUT/DELETE /api/email-routing-rules/:email`; `GET /api/invoices/review`.
- **Quarantine**: `GET /api/webhooks/quarantined-emails` for PDFs that couldn't be read.
- **Frontend — AP page 5-tab layout** (`client/src/pages/admin/AccountsPayable.tsx`):
  - **To Pay** — existing supplier accordion + bulk pay (unchanged).
  - **Review Inbox (Supplier-Centric)** — invoices grouped by AI-extracted `supplierName`. One card per unique supplier name showing invoice count + total amount + individual invoice list. **Webhook smart-match**: after AI extracts supplier name, ILIKE match against `suppliers` table; if found → create as PENDING/PAID directly (skip REVIEW). **Backend sweep**: `POST /api/invoices/review/approve-group` creates supplier + runs two sweeps: (1) `sweepReviewInvoicesBySupplierName` for PDF-parsed invoices matched by `rawExtractedData.supplier.supplierName`; (2) `sweepReviewInvoicesBySenderEmail` for CEO-forwarded/no-PDF invoices matched by top-level `rawExtractedData.senderEmail`. Both sweep to PENDING. **Ignore Supplier** quarantines ALL invoices in the group. **Approve & Add Supplier** opens pre-filled modal + approves all group invoices at once.
  - **Paid History** — invoices grouped by payment date then by supplier (see §3.8 description).
  - **Email Rules** — data table (Email, Supplier Name, Action badge, Created date, Delete button). Delete removes rule so sender is treated as unknown again. Actions: `ROUTE_TO_AP` | `ROUTE_TO_TODO` | `FYI_ARCHIVE` | `SPAM_DROP` (+ legacy `ALLOW` → AP, `IGNORE` → Spam).
  - **Trash** — soft-deleted invoices. Shows list of deleted invoices with supplier name, amount, date. Two actions per row: **Restore** (moves back to PENDING/original status) or **Delete Permanently**. Bulk soft-delete available from To Pay tab.
  - Store filter row + summary cards only shown on To Pay and Paid History tabs.
- **Soft-Delete / Trash**: invoices can be soft-deleted (moves to Trash, `deletedAt` timestamp set). Excluded from all active queries. Restorable until permanently deleted.
- **Re-parse PDF** (`POST /api/supplier-invoices/:id/reparse-pdf`): re-runs `pdftotext` + GPT-4o parse on a stored PDF, updates invoice fields with fresh AI extraction result. Used when initial parse was incorrect.
- **Reassign Supplier** (`PATCH /api/supplier-invoices/:id/reassign`): change the `supplierId` on an existing invoice (e.g. after creating a supplier in Review Inbox).
- **Revert PAID → PENDING** (`POST /api/invoices/:id/revert`): revert a paid invoice back to PENDING status. Removes associated payment record. Used for payment corrections.

### 3.10a Legacy Supplier Invoices Page (`/admin/suppliers/invoices`)
- Separate, simpler invoice management view under Suppliers.
- Direct table of all supplier invoices with supplier name, amount, status, date.
- Create invoice manually (supplier, store, invoice number, amount, date, due date).
- Record payment: select payment method and date, marks invoice as PAID.
- Predates the full AP Dashboard; retained as a fallback direct-data view.

### 3.11 Email Routing — Human-Trained Rules Engine ✅ COMPLETE

**Architecture**: Replaced GPT-4o triage step with a deterministic routing engine. Manager-defined routing rules control all email processing — no AI classification needed.

- **Webhook** `POST /api/webhooks/inbound-invoices`:
  1. Extract sender from `headers.from` (never `envelope.from`)
  2. Look up routing rule AND check if sender email matches any supplier's `contactEmails` (both in parallel)
  3. Backward-compat: `ALLOW` → `ROUTE_TO_AP`, `IGNORE` → `SPAM_DROP`
  4. **TRIAGE GATE** — auto-process ONLY when sender is a confirmed direct supplier (email in supplier `contactEmails` DB):
     - **`SPAM_DROP`**: Drop silently (no Triage needed).
     - **`FYI_ARCHIVE`**: Acknowledge silently (no Triage needed).
     - **Direct supplier** (email in `contactEmails`): Auto-process AP pipeline regardless of routing rule. No supplierId → REVIEW. PDF + AI parse → PENDING.
     - **Everything else** (CEO forwarder, ROUTE_TO_TODO, unknown sender): Save to `universal_inbox` with `_suggestedAction` from routing rule stored in `rawPayload`. Human reviews in Triage Inbox.
  5. Routing rules from old system (ALLOW/ROUTE_TO_AP) no longer auto-process non-supplier senders. Only explicit `contactEmails` DB match bypasses Triage.
  6. **Key**: CEO with ROUTE_TO_AP rule but NOT in `contactEmails` → Triage Inbox with suggestedAction badge.

- **`universal_inbox` table** (`shared/schema.ts`): `id`, `senderEmail`, `senderName`, `subject`, `body`, `hasAttachment`, `rawPayload` (jsonb — full Cloudmailin payload for re-processing), `status` (`NEEDS_ROUTING` | `PROCESSED` | `DROPPED`), `createdAt`.

- **Triage Inbox** `GET /api/universal-inbox` + `POST /api/universal-inbox/:id/route`:
  - When manager routes an item, routing rule is saved AND current email is re-processed immediately.
  - Item status updated to `PROCESSED` or `DROPPED`.

- **Frontend** `/admin/triage-inbox` (`TriageInbox.tsx`) — sidebar under "Executive":
  - 3 tabs: Needs Routing (badge count) / Processed / Dropped.
  - Each card: sender name/email, subject, body preview, attachment indicator, received time.
  - 4 action buttons per card: Payables → ROUTE_TO_AP, To-Do → ROUTE_TO_TODO, FYI → FYI_ARCHIVE, Spam → SPAM_DROP.
  - Confirm dialog before routing. Toast on success.
  - Explanation panel (Korean) describing how the rules engine works.

- **todos** `GET/POST/PATCH/DELETE /api/todos`: unchanged.
- **AI Korean translation** ✅: task titles/descriptions generated in Korean by GPT.
- **Auto-Pay (Direct Debit)** ✅: `isAutoPay` boolean on `suppliers`. Auto-creates PAID invoice + AUTO_DEBIT payment on webhook/manual creation.

### 3.12 Employee Portal (Mobile)
- **Login**: `/m/portal` — employee selects store, finds their name, enters PIN.
- **PIN login**: alternative numeric PIN entry.
- **Today view**: shows today's scheduled shift (from published roster), with clock-in/out via time logs.
- **Roster view**: `/m/roster` — weekly schedule view for the employee's store.
- **Timesheet submission**: `/m/portal` → submit actual start/end times for each shift day.
  - Unscheduled shifts (employee worked but not rostered) can also be submitted.
  - Submissions go to `shiftTimesheets` as PENDING for admin approval.
  - **Cycle Timesheets view** (`GET /api/portal/cycle-timesheets`): shows all submitted timesheets for the current 14-day payroll cycle.
  - **Missed Shifts** (`GET /api/portal/missed-shifts`): shows rostered shifts in a date range that have no corresponding timesheet submission. Employee can submit from this view.
  - **Payroll History** (`GET /api/portal/history`): shows past payroll records for the employee (period, hours, amount paid, bank/cash split).
- **Daily Close Form**: `/m/daily-close` — employee submits EOD cash denomination count + receipt count.
  - Only visible to employees with `canSubmitCloseForm = true`.
- **Clock (Legacy)**: `/m/clock` — simple clock-in/out page. Employee selects their store and name, then taps Clock In / Clock Out. Records to `timeLogs` table. Predates the portal; retained as a simple fallback.
- **Direct Register**: `/m/register` — creates a new employee session directly (skips onboarding). Admin-use only URL.
- **Interview form**: `/m/interview` — captures candidate interview data on mobile device.
- Session stored in localStorage as `ep_session_v5` (includes `selfieUrl` for avatar display, `role` field as of dynamic unit update). Legacy `ep_session_v4` in `sessionStorage` is migrated on first mount — so existing logged-in employees survive the switch, and closing the browser tab no longer logs them out.
- **Admin Dashboard shortcut**: If the logged-in employee's role is `"Owner"` or `"Manager"`, a small "Admin Dashboard" button (outline, sm, LayoutDashboard icon) is shown below the employee name in the HomeTab greeting section. Tapping navigates to `/admin`. Role is returned by `POST /api/portal/login-pin` and stored in the session object. Regular `"Employee"` role sees no button.
- **PIN Security** (implemented):
  - **bcrypt hashing**: PINs are hashed with `bcryptjs` (cost 10) before storage. All login routes support migration — plain-text PINs still work on first login and are auto-upgraded to bcrypt hash on success. New PINs set via admin (`PUT /api/employees/:id`) are always hashed immediately.
  - **Rate limiting**: 5 failed PIN attempts triggers a 15-minute lockout (in-memory, per identifier). Applied to all 3 login routes. Returns HTTP 429 with `"Too many failed attempts. Try again in X minutes."` message displayed in the portal error UI.
  - **Change PIN feature**: SettingsTab "Change PIN" button opens a `ChangePinDrawer` (Drawer component). Three-step numpad flow: (1) enter current PIN, (2) enter new PIN, (3) confirm new PIN. Validation: new PIN must differ from current, confirm must match new. Calls `POST /api/portal/change-pin`. On success shows toast and closes drawer.

---

### 3.13 Email Sender Resolution Fixes ✅ COMPLETE

**Problem**: Emails routed via Google Groups, forwarding chains, or accounting SaaS platforms (Xero/MYOB/etc.) arrive with the wrong "From" address, causing incorrect supplier matching and broken routing rules.

**Sender Priority Hierarchy** (webhook parser + routing confirmation API):
1. **P1 — `X-Original-Sender` header**: Google Groups injects the real sender here.
2. **P2 — "via" pattern in From**: `email@domain.com via GroupName <group@>` → extract email before "via".
3. **P3 — Generic service + Reply-To**: If sender domain is a known accounting platform, use Reply-To as the true supplier.
4. **P4 — Reply-To ≠ From**: If Reply-To is an external address different from From, use it.
5. **P5 — Internal group sender + Reply-To (Pattern B)**: `'Name' via GroupName <internal@eatem.com.au>` → use Reply-To for email; strip "via GroupName" suffix from display name.
6. **P6 — Standard From**: Fallback.

**Generic Service Domains** (accounting/invoicing SaaS — never the true supplier; real supplier is always in Reply-To):
- `post.xero.com`, `xero.com`, `myob.com`, `myobaccountsright.com.au`
- `quickbooks.com`, `intuit.com`, `qbo.intuit.com`
- `invoicing.squareup.com`, `mail.wave.com`, `freshbooks.com`, `sage.com`
- `numberkeepers.com.au`
- Subject-line extraction: `"Invoice from X"` → supplier name "X" when Reply-To is missing.

**Pattern B "Name via Group" fix** (`TriageInbox.tsx`):
- `cleanSenderName()` utility strips `" via GroupName"` suffix from display names in cards and modals.
- Webhook parser applies same cleanup to `resolvedSenderName` before saving.

**Startup Migration Suite** (`server/index.ts` — runs automatically on every deploy):
- `fixViaEmailSenders()` — re-parses `universal_inbox` records with via-pattern sender emails (Pattern A + B).
- `fixGenericServiceSenders()` — fixes records where sender_email is a generic service domain; extracts real supplier from Reply-To header in `rawPayload`.
- `sanitizeInboxBodies()` — strips raw HTML/CSS from `body` column (htmlToPlainText conversion).

**Routing confirmation API fix** (`POST /api/universal-inbox/:id/route`):
- Re-derives true sender email using the same 5-priority hierarchy before saving the routing rule.
- If stored senderEmail doesn't match the derived true email, corrects the DB record immediately.
- Frontend `resolveTrueSenderEmail()` applies the same logic for the confirm dialog display.

---

### 3.14 Accounts Payable UX Improvements ✅ COMPLETE

**Store Filter — Unassigned Invoice Handling:**
- Invoices with `storeId = null` (unassigned) are now shown **only** in the "All Stores" view, not in store-specific tabs.
- Previously, unassigned invoices appeared in every store tab (e.g., Riverina Fresh appearing in Sushi tab even though it's not a Sushi supplier).
- When viewing a specific store tab and there are unassigned PENDING/OVERDUE invoices, an amber banner appears: `"N unassigned invoices not shown here"` + "View in All Stores" button.

**Supplier Accordion UX:**
- **Default state**: All supplier accordions collapsed on page/tab load (`openAccordions` initialized as `[]`).
- **Expanded-state visual distinction**:
  - `AccordionItem` carries `group` class → header uses `group-data-[state=open]:border-b` for a subtle bottom separator line only when open.
  - Expanded content area: `bg-muted/20 dark:bg-muted/10` subtle background tint replacing the old `border-t`.
- **Header layout restructured** (3-zone flex row):
  - **Left**: Checkbox · Supplier Name (truncatable) · Direct Debit badge · "N invoices" count
  - **Centre**: Total amount (`font-semibold`) · Selected amount with checkmark icon + primary accent colour (visible only when ≥1 invoice selected)
  - **Far right**: Overdue badge (red) · ChevronDown (rotates 180° via `group-data-[state=open]:rotate-180`)

**Weekly separator inside expanded supplier tables (`flatMap` row builder):**
- Within each expanded supplier accordion, invoice rows are emitted via `flatMap`. Between two consecutive rows whose **Monday-of-due-date** differs, an extra `<tr>` divider is injected:
  - `<tr><td colSpan={7} className="h-[3px] bg-slate-300 dark:bg-slate-600 p-0" /></tr>`
  - Explicit Tailwind colour (slate-300 / slate-600) is used instead of `bg-border` so the line is reliably visible against the muted table-row background in both themes.
- `getMondayStr(dateStr)` parses `YYYY-MM-DD` with `new Date(y, mo − 1, d)` (local-midnight components) — never `new Date(dateStr)` — to avoid the AEDT/UTC skew that would otherwise put rows into the wrong "week bucket". The Monday is computed as `date − ((dayOfWeek + 6) % 7)` days, then re-formatted as `YYYY-MM-DD`.
- Replaces the older `getWeekParity` (zebra-stripe) approach which only alternated row backgrounds and was hard to see when rows were already tinted (e.g. overdue red wash).

---

### 3.15 AP Invoice Parser Improvements ✅ COMPLETE

**Statement of Account vs Single Invoice Detection:**
- Both `parseInvoiceWithAI` (known supplier) and `parseInvoiceFromUnknownSender` (unknown sender) now detect whether the incoming PDF is a **Statement of Account** or a **Single Invoice**.
- Every `ParsedInvoice` object carries an `isStatement: boolean` field; `UnknownSenderParsedResult` carries a top-level `isStatement: boolean`.
- Both parsers accept an optional `subjectHint` string (email Subject line) for additional context — keywords like "Statement", "Statement of Account" in the subject strongly signal type (B).
- **Statement safety guard** (known-supplier and unknown-sender Triage paths + webhook Step 7):
  - If `isStatement = true` AND only 1 row extracted → force `status: REVIEW` with note `"possibly a grand-total error"` to prevent double-counting the entire account balance as one invoice.
  - Multi-row statements: each row inserted as a separate PENDING invoice using `sourceNote = "Reconciled from Statement of Account."`. Existing invoice numbers are skipped (deduplication); skipped count is logged.
- `rawExtractedData._isStatement: true` is stored on statement-origin REVIEW records.
- **UI indicators** (`AccountsPayable.tsx`):
  - Amber "Statement" badge on each invoice row in the Review Inbox that has `_isStatement: true`.
  - Warning banner inside the Approve modal when `raw._isStatement = true`: "Statement of Account detected — verify amount before approving."

**Invoice Total vs Combined Account Balance Fix:**
- Some suppliers (e.g. Green Star Food) print three totals at the bottom of a Tax Invoice:
  - `Invoice Total` — this invoice only (correct amount to pay)
  - `A/C Outstanding` — prior unpaid account balance
  - `Total` — Invoice Total + A/C Outstanding (should NOT be used as the invoice amount)
- All three parser prompts (`parseInvoiceWithAI`, `parseUploadedFile`, `parseInvoiceFromUnknownSender`) updated with explicit priority rules:
  1. **If "Invoice Total" label present → use it.** It always represents this invoice alone.
  2. **If "Invoice Total" + "A/C Outstanding" + combined "Total" structure detected → use "Invoice Total" only.** The combined "Total" includes prior debt and must be ignored.
  3. **Fallback** (no "Invoice Total" label) → use "Total AUD Incl. GST" / "Total Amount Payable" / "Amount Due".

### 3.16 Triage Inbox — Bulk Spam Drop ✅ COMPLETE

- **SPAM_DROP now triggers bulk-drop**: when a Triage Inbox item is dropped as spam, all other inbox items from the same sender email are also dropped atomically.
- `dropInboxItemsBySender(senderEmail, excludeId)` added to `IStorage`, `MemStorage`, and `DatabaseStorage`.
- Route `POST /api/universal-inbox/:id/route` calls this after setting the current item's status to `DROPPED`, then returns `{ bulkDropped: N }` in the response JSON.
- Frontend `mutationFn` in `TriageInbox.tsx` parses the JSON response and shows a toast: `"N other emails from this sender were also dropped."` (only for SPAM_DROP, not FYI_ARCHIVE).
- FYI_ARCHIVE does **not** trigger bulk-drop (FYI emails may have legitimate future correspondence).

### 3.17 Shift Presets & Custom Quick-Fill Buttons — Admin Settings ✅ COMPLETE

**Feature**: Admin Settings → Shift Presets (`/admin/settings/shift-presets`) — lets the admin configure (1) the times for the 3 fixed quick-fill buttons and (2) create unlimited additional custom quick-fill buttons per store.

**DB**:
- `shift_presets` — one row per store (unique on `storeId`). Fields: `id` (UUID PK), `storeId`, `fullDayStart`, `fullDayEnd`, `openShiftStart`, `openShiftEnd`, `closeShiftStart`, `closeShiftEnd` (all text, HH:mm). Default values: Full Day 06:30–18:30, Open Shift 06:30–12:30, Close Shift 12:30–18:30.
- `shift_preset_buttons` — user-defined custom buttons. Fields: `id` (serial PK), `storeId` (FK → stores), `name` (varchar 50), `startTime`, `endTime`, `sortOrder`. Unlimited per store; `db:push` run after schema addition.

**Storage** (`server/storage.ts`):
- Fixed presets: `getShiftPresets()`, `getShiftPresetByStore(storeId)`, `upsertShiftPreset(data)` in `IStorage`, `MemStorage`, `DatabaseStorage`.
- Custom buttons: `getPresetButtons(storeId)`, `upsertPresetButton(data)`, `deletePresetButton(id)` added to all three implementations.

**API** (`server/routes.ts`):
- `GET /api/shift-presets` — list all store fixed presets
- `GET /api/shift-presets/:storeId` — single store preset (404 if none)
- `PUT /api/shift-presets/:storeId` — upsert fixed preset for a store
- `GET /api/preset-buttons?storeId=` — list custom buttons for a store
- `POST /api/preset-buttons` — create custom button
- `PUT /api/preset-buttons/:id` — update custom button
- `DELETE /api/preset-buttons/:id` — delete custom button

**Frontend** (`client/src/pages/admin/ShiftPresets.tsx`):
- **Sushi shown first, Sandwich below** (explicit ordering).
- One Card per store: top section = 3 fixed preset rows (Full Day / Open Shift / Close Shift) with Start + End time selectors + live hours display + Save button. Korean subtitle guidance per row.
- Bottom section = "Custom Buttons" (`CustomButtonsSection`) — inline add/edit/delete rows. "Add Button" opens an inline row: name input + Start/End time selects + Save/Cancel. Existing buttons show name + times + Save + Delete.
- Integrated into AdminLayout Settings nav (`settingsNavItems`) as "Shift Presets" with Clock icon. Route registered in `App.tsx`.

**Roster CellEditor integration** (`client/src/pages/admin/Rosters.tsx`):
- `ShiftPreset` type imported from `@shared/schema`.
- `useQuery<ShiftPreset[]>({ queryKey: ["/api/shift-presets"] })` fetches fixed presets; `useQuery<ShiftPresetButton[]>({ queryKey: ["/api/preset-buttons", selectedStore] })` fetches custom buttons.
- `CellEditorProps` extended with `preset?: ShiftPreset` and `customButtons?: ShiftPresetButton[]`.
- Fixed quick-fill buttons use `preset?.fullDayStart ?? storeOpenTime` pattern. Custom buttons appear as additional chips after the 3 fixed ones.

**Generate Shifts dialog integration** (`GenerateRosterDialog`):
- Accepts `customButtons?: ShiftPresetButton[]` prop.
- Shift type selector shows: Full Day / Open Shift / Close Shift / Custom (time pickers) + each custom button as a selectable option (key pattern `"btn_${id}"`).
- On selection, resolves and displays the preset start–end time for confirmation.

### 3.18 Bulk Roster Generation ✅ COMPLETE

**Feature**: "Generate Shifts" button in the Roster toolbar opens a dialog to apply a single shift type to multiple employees across multiple days at once.

**Storage** (`server/storage.ts`): `bulkUpsertRosters(entries[], overwrite?)` — batch upserts roster rows. `overwrite=true` replaces existing entries; `overwrite=false` skips conflicts. Returns `{ created: number, skipped: number }`.

**API** (`server/routes.ts`): `POST /api/rosters/bulk-create` — accepts `{ entries: [], overwrite?: boolean }`, calls `storage.bulkUpsertRosters()`, returns `{ created, skipped }`.

**Frontend** (`client/src/pages/admin/Rosters.tsx`):
- `GenerateRosterDialog` component with:
  - **Shift type selector**: Full Day / Open Shift / Close Shift / Custom + any custom preset buttons (fetched via `/api/preset-buttons?storeId=`). Selecting a type previews the resolved start–end times from the store's fixed preset or the custom button definition.
  - **Day selector**: Mon–Sun toggle buttons (default: Mon–Fri selected).
  - **Employee selector**: "All employees" master checkbox + individual checkboxes per active employee in the selected store (scrollable list).
  - **Overwrite toggle**: checkbox to allow overwriting existing shifts (default: OFF, skips existing).
  - **Generate button**: shows `(N shifts)` count preview before generating.
- Button added to toolbar ("Generate Shifts") next to "Copy Prev Week".
- On success: invalidates roster query cache + shows toast with created/skipped counts.

### 3.19 Store Settings — Admin Settings ✅ COMPLETE

**Feature**: Settings → Store Settings (`/admin/settings/store-config`) — 4-tab page for configuring store operational data: trading hours, school holiday periods, public holidays, and recommended weekly work hours.

**DB** (4 new tables, `db:push` run):
- `store_trading_hours` — per-store, per-day trading hours with upsert on `(storeId, dayOfWeek)`.
- `school_holidays` — global school holiday periods (name, startDate, endDate). ~4 per year.
- `public_holidays` — public holiday dates with per-store `storeClosures` JSON map.
- `store_recommended_hours` — per-store term/holiday recommended weekly hours. PK = `storeId`.

**Storage** (`server/storage.ts`): All methods added to `IStorage`, `MemStorage` (stubs), and `DatabaseStorage` (real implementations):
- Trading hours: `getStoreTradingHours(storeId)`, `upsertStoreTradingHours(data)`
- School holidays: `getSchoolHolidays()`, `createSchoolHoliday()`, `updateSchoolHoliday()`, `deleteSchoolHoliday()`
- Public holidays: `getPublicHolidays()`, `createPublicHoliday()`, `updatePublicHoliday()`, `deletePublicHoliday()`
- Recommended hours: `getStoreRecommendedHours()`, `upsertStoreRecommendedHours(data)`

**API** (`server/routes.ts`) — all under `/api/store-config/`:
- `GET/PUT /api/store-config/trading-hours` — per-store day-level upsert
- `GET/POST/PUT/DELETE /api/store-config/school-holidays` and `/:id`
- `GET/POST/PUT/DELETE /api/store-config/public-holidays` and `/:id`
- `GET/PUT /api/store-config/recommended-hours`

**Frontend** (`client/src/pages/admin/StoreConfig.tsx`):
- **Tab 1 — Trading Hours**: Sushi / Sandwich store selector (buttons). Per-day row with isClosed toggle + open/close time selects (30-min slots). Save button appears on dirty rows only.
- **Tab 2 — School Holidays**: Scrollable list of periods. Add / Edit (dialog with name + date range) / Delete (confirm alert). Sorted by startDate.
- **Tab 3 — Public Holidays**: Table with holiday name, date, and Closed/Open badge per roster-enabled store. Add / Edit (dialog with name, date, per-store closure switches) / Delete. Sorted by date.
- **Tab 4 — Recommended Hours**: Card per store (Sushi / Sandwich). Two number inputs: Term weekly hours + Holiday weekly hours. Save per store, disabled until changed.

**Sidebar re-structure** (`client/src/components/layouts/AdminLayout.tsx`):
- Settings items are no longer listed as flat nav items in the sidebar.
- A single "Settings" `SidebarMenuButton` using `Collapsible` + `CollapsibleTrigger` is shown under a "System" group (ADMIN only).
- Expanding "Settings" reveals a `SidebarMenuSub` with 3 sub-items: **Access Control**, **Shift Presets**, **Store Settings**.
- If the current route starts with `/admin/settings`, the collapsible is auto-opened on mount.

### 3.20 Automation Rules ✅ COMPLETE

**Feature**: `/admin/automations` — Recurring task management. Managers configure rules that appear in the Dashboard when due, and execute them with one click.

**DB** (1 new table, `db:push` run):
- `automation_rules` — UUID PK, `title`, `actionType` (ROSTER/PAYROLL_ADJUSTMENT/FINANCE_TRANSFER), `frequency` (WEEKLY/MONTHLY_FIRST_WEEK/MONTHLY), `daysOfWeek` (integer[]), `targetEmployeeId` FK, `targetStoreId` FK, `payload` (jsonb), `description`, `isActive`, `lastExecutedAt`, `createdAt`.
- Payload shapes: ROSTER `{ storeId, startTime, endTime }` · PAYROLL_ADJUSTMENT `{ amount, reason }` · FINANCE_TRANSFER `{ fromStoreId, toStoreId, amount, transferType: "convert"|"remittance" }`

**Storage** (`server/storage.ts`): All methods added to `IStorage`, `MemStorage` (stubs), and `DatabaseStorage`:
- `getAutomationRules()` — all rules sorted by createdAt desc
- `getAutomationRulesDueToday()` — filters active rules by Sydney time logic:
  - WEEKLY: today's dayOfWeek is in `daysOfWeek` + not already executed today
  - MONTHLY_FIRST_WEEK: day 1-7 of month + not executed this week
  - MONTHLY: today is 1st of month + not executed this month
- `getAutomationRule(id)`, `createAutomationRule()`, `updateAutomationRule()`, `deleteAutomationRule()`
- `executeAutomationRule(id)`: dispatches action based on `actionType`, then updates `lastExecutedAt`
  - ROSTER: calculates current-week dates per dayOfWeek, calls `upsertRoster()` per date
  - PAYROLL_ADJUSTMENT: finds latest payroll for employee, calls `updatePayroll()` with adjustment + reason
  - FINANCE_TRANSFER: calls `createFinancialTransaction()` with CONVERT/REMITTANCE type

**API** (`server/routes.ts`): All under `/api/automation-rules/`:
- `GET /api/automation-rules/due-today` — (before `:id` route) returns active due rules enriched with employeeName + storeName
- `GET /api/automation-rules` — all rules, enriched
- `POST /api/automation-rules` — create (validates with `insertAutomationRuleSchema`)
- `PUT /api/automation-rules/:id` — update (partial)
- `DELETE /api/automation-rules/:id` — delete, returns `{ deleted: true }`
- `POST /api/automation-rules/:id/execute` — execute rule, returns `{ success, message }`

**Frontend** (`client/src/pages/admin/Automations.tsx`):
- Rule cards: title, actionType badge (color-coded), frequency + days summary, employee/store name, isActive toggle, Edit / Delete buttons.
- Empty state with icon and "New Rule" prompt.
- Sheet drawer for Create/Edit with dynamic form fields by actionType + daysOfWeek checkboxes (only when WEEKLY).
- AlertDialog for delete confirmation.

**Dashboard Widget** (`client/src/pages/admin/Dashboard.tsx`):
- `useQuery` for `/api/automation-rules/due-today` (staleTime: 0).
- Widget is hidden entirely when `visibleRules.length === 0`.
- Placed between Financial Performance and Triage sections.
- Per-rule row: title, actionType badge, description, employee+store, **Execute** button (spinner while pending, removes from list on success) + **Skip** button (removes from local list only, no API call).
- Execute calls `POST /api/automation-rules/:id/execute`, shows toast with result message.

**Sidebar** (`AdminLayout.tsx`): "Automations" added to `settingsNavItems` under the collapsible Settings menu (Repeat icon). `isSettingsActive` updated to also match `/admin/automations`.

---

### 3.21 Recent Polish & UX Hardening ✅ COMPLETE

A grouped record of incremental polish work that landed across multiple modules but doesn't warrant its own section. Each item is fully shipped to production.

**Global Design System & Brand Colours ✅**
- Sushime brand green (`#16a34a`) and Eat'em brand red (`#dc2626`) applied consistently as the source of truth for store identity across every surface: store cards, payroll headers, AP store toggle buttons, dashboard stat cards, roster grid colour bars, and badge colour mapping.
- Hard-coded brand hex values are intentional (not theme tokens) so the colours never shift between light/dark mode or accidentally inherit a Shadcn theme change.

**Dashboard — 2-Week Payroll Cycle Stacked Bar ✅**
- Replaced the older daily/weekly bar with a **fortnightly Stacked Bar** keyed to the fixed pay-cycle anchor (§5).
- Each bar = one full 14-day cycle; stacks layer Sushi (green) on top of Sandwich (red) for direct visual comparison of labour cost per cycle.
- X-axis labels use the cycle's `start – end` range (e.g. `Apr 6 – Apr 19`); tooltip shows per-store breakdown + total.
- Source data: `/api/dashboard/summary` aggregated by cycle, with the `periodStart > endDate` overlap fix (§3.6).

**Triage Inbox Polish ✅**
- **CSS / HTML body sanitisation**: `sanitizeInboxBodies()` startup migration strips raw HTML, inline CSS, and email-client scaffolding from `universal_inbox.body` so cards render clean Korean/English plain text. Runs once on every deploy in `server/index.ts`.
- **"View Full Email" modal**: Each inbox card now has a "View Full Email" action that opens a modal with the full sanitised body, AI-generated Korean summary (cached per item), and original sender + reply-to header inspection.
- **Advanced sender parsing**: 6-priority resolution hierarchy (§3.13) — handles Google Groups `via` pattern, Xero/MYOB/QuickBooks generic-service Reply-To extraction, internal-group "Name via Group" Pattern B cleanup, and standard From fallback. Re-applied retroactively via `fixViaEmailSenders()` + `fixGenericServiceSenders()` startup migrations.

**AccountsPayable UI Polish ✅**
- Supplier accordions default to **collapsed** on every page/tab load (`openAccordions = []`) — no more long scrolling past hundreds of expanded rows.
- **Selected amount display**: Real-time "$X selected (N)" appears in primary accent colour next to each supplier's total whenever ≥1 invoice in that group is checked. Replicated in the page-header summary card.
- **Header re-alignment**: 3-zone flex row (Left = checkbox + supplier name + Direct Debit badge + count · Centre = Total + Selected · Far right = Overdue badge + ChevronDown rotating 180° on open). See §3.14 for full layout spec.

**Payroll Field Polish ✅**
- **Memo field persistence**: Per-employee payroll Memo notes are saved into the same `sessionStorage` draft envelope as the rest of the row (`payrollDrafts_${storeId}_${periodStart}_${periodEnd}`). HMR / store toggle / period switch no longer wipes manager-typed notes; they only purge after the payroll is finalised to DB.
- **Number-input scroll prevention**: All `<Input type="number">` payroll cells (hours, rate, adjustment, cash split, bank split) now register `onWheel={(e) => e.currentTarget.blur()}` so scrolling the page over a focused number input no longer accidentally increments/decrements the value.

**Mobile Portal Polish ✅**
- **Logo placements**: Sushime / Eat'em store logos appear in the portal login picker (per-store cards), HomeTab header (current-store branding), and the PWA splash screen. SVG sources stored under `client/public/logos/`.
- **PWA base setup (Manifest + Service Worker shell)**:
  - `client/public/manifest.json` — name, short_name, `start_url: /m/portal`, `display: standalone`, theme/background colour, icon set (192/512 + maskable).
  - `client/public/sw.js` — minimal service worker registered from `client/index.html`. Currently no-op cache (just registration scaffolding); offline asset caching + background sync is deferred (§6.3.1).
  - `<meta name="theme-color">`, `apple-mobile-web-app-capable`, `apple-touch-icon` all wired in `client/index.html`.
- **Notification permission request UI**: SettingsTab in EmployeePortal includes a "Enable Notifications" button that calls `Notification.requestPermission()` and shows the resolved state (Granted / Denied / Default) as a Badge. The actual push pipeline + cron-driven notifications are deferred (§6.3.2).

---

### 3.22 AP Whitelist-Only Pipeline + Stuck-Invoice Recovery ✅ COMPLETE (2026-04-22 → 2026-04-23)

**Problem (pre-whitelist)**: The Triage Inbox + universal_inbox + routing-rules stack grew into a 5-layered funnel (TRIAGE → TODO/FYI/Payables/Spam → REVIEW → PENDING → QUARANTINE). Suppliers' invoices still slipped into REVIEW/QUARANTINE because GPT-4o-mini misclassified tear-off Payment Advice slips as REMITTANCE, Xero sender resolution pointed at `post.xero.com` instead of the real supplier, and statements were either parsed as single-row invoices or silently dropped. 74 invoices were stuck in REVIEW+QUARANTINE.

**Resolution design** — narrow the front door, shrink the back door, keep the back-end for rollback. Implementation plan lived at `/Users/peter/.claude/plans/whimsical-singing-pillow.md` (whitelist-only invoice mode).

**DB (new table)** — `rejectedEmails` (§2.5):
- Every webhook email whose sender is **not** in `suppliers.contactEmails` is parked here instead of being dropped or triaged. Field list in §2.5.
- Migration `db:push` run 2026-04-22.

**Classifier upgrade** (`server/invoiceParser.ts:classifyDocumentForAP`) — 2-way → 4-way:
- Old: `{ INVOICE | CONFIRMATION }` with `isStatement` side-channel.
- New: `{ INVOICE | STATEMENT | REMITTANCE | OTHER }`. Prompt explicitly distinguishes the tear-off Payment Advice slip at the bottom of a Xero invoice from a genuine REMITTANCE (= "we just paid you $X", multiple invoice numbers listed).
- Used by the webhook gate and by the `bulk-reclassify` recovery endpoint.

**Webhook rewrite** (`server/routes.ts:/api/webhooks/inbound-invoices`):
1. Basic Auth + dedup (unchanged).
2. Sender resolution 6-tier hierarchy (§3.13) with one fix — X-Original-Sender is **skipped** when its domain is in `GENERIC_SERVICE_DOMAINS` (Xero/MYOB/QuickBooks/etc.). This prevents `messaging-service@post.xero.com` from winning over a valid Reply-To.
3. **Whitelist gate**: `findSupplierByEmail(sender)` — case/whitespace tolerant.
   - **NO** → insert into `rejectedEmails` (full raw payload retained), return 200 `{ action: "rejected_unknown_sender" }`. No universal_inbox, no TODO, no routing-rule consultation.
   - **YES** → proceed.
4. **Attachment gate**: no PDF attachment → body-text fallback (see below). Still no supplier + no attachment → drop.
5. **Classify gate**: `classifyDocumentForAP`. OTHER / REMITTANCE → drop (log only). INVOICE → 1 PENDING row. STATEMENT → many PENDING rows with `(supplierId, invoiceNumber)` dedup.
6. Amount parse failure remains the single human-in-the-loop path → REVIEW status with `"Needs manual entry"` note.

**Body-text fallback** (commit `b113d89`): suppliers like AGL / Telstra / Total Equipment sometimes send invoice totals inline in the email body with no attachment. When no PDF is present but the sender is whitelisted, the webhook now runs `classifyDocumentForAP` + `parseInvoiceWithAI` against the HTML-stripped body, so a PENDING row is still created.

**PDF extraction hardening** (`server/invoiceParser.ts:extractPdfText`, commit `45ba83f`): if `pdf-parse` returns empty text, fall back to the `pdftotext` CLI (poppler-utils). Fixes suppliers whose PDFs use subset-encoded fonts that pdf-parse can't decode.

**Stuck-invoice recovery endpoints** (one-shots, safe to re-run):
- `POST /api/invoices/bulk-reclassify` — scans every `supplierInvoices` row where `status IN ('REVIEW','QUARANTINE')` with a stored `rawExtractedData.pdfBase64`, re-extracts PDF text, runs the new 4-way classifier + parser, and promotes matches to PENDING. Parser-first safety net: if `parseInvoiceWithAI` returns a plausible INVOICE result, we trust the parser over the classifier (covers tear-off Payment Advice case). STATEMENT expands in-place. REMITTANCE / OTHER → DELETED (soft). Parse failure → REVIEW with note. Returns `{ promoted, statementExpanded, dropped, needsManual, totalProcessed }`.
- `POST /api/invoices/backfill-from-inbox` — walks `universalInbox` (legacy Triage backlog), pulls the attached PDF, runs the same pipeline. Recovered 16 orphan REVIEW rows during 2026-04-23 cleanup.

**Store resolution for multi-store suppliers** (`resolveStoreIdForInvoice` + `MULTI_STORE_SUPPLIER_IDS`, commit `b3cfed2`):
- Some suppliers (Escalate, Total Equipment, Campos Coffee) bill both Sushi and Sandwich. We must NOT guess their storeId from supplier history — the PDF itself is the source of truth.
- 4-tier priority inside the resolver:
  1. `storeCode` extracted from PDF ("Bill To" / "SUSHI" / "SANDWICH" / "EATEM" keywords) → hard match.
  2. Parent invoice's `storeId` (for statement children reusing the header row's context).
  3. Supplier history majority **only if** the supplier is single-store AND ≥80% of that supplier's existing PAID/PENDING rows map to one store.
  4. `null` (surfaces in "All Stores" view + an amber banner on store-specific tabs, per §3.14).
- `MULTI_STORE_SUPPLIER_IDS` is an explicit opt-out set. History-majority rule is skipped for these suppliers — they always route via PDF storeCode or stay unassigned.

**Invoice placeholder in-place promotion** (commit `3bd5de8`): when `reparse-pdf` is run on a placeholder PENDING row (created by the old Triage flow with `amount=0`, `invoiceNumber="PENDING-..."`) and the refreshed parse returns a multi-row STATEMENT, the first parsed item promotes the placeholder in-place (UPDATE) and subsequent items INSERT. Prevents the previous "duplicate row + orphan placeholder" state.

**Rejected Emails UI** (`client/src/pages/admin/AccountsPayable.tsx` Rejected tab, `client/src/pages/admin/Suppliers.tsx` reused for contactEmails edit):
- New tab in Accounts Payable: Rejected (count badge = `reviewed = false` rows).
- Each card: sender email/name, subject, received timestamp, body preview, "Add to supplier…" (promote modal → create new supplier or append email to existing `contactEmails`) and "Delete" (permanent remove).
- After promotion the rejected row is marked `reviewed = true`, and the next email from that sender flows straight through the whitelist.

**Sidebar cleanup** (commit `710d5ea`, `client/src/components/layouts/AdminLayout.tsx`): Smart Inbox + Triage Inbox menu items commented out. Backend + routes preserved for 2-stage rollback.

**Known limitation / explicit trade-off**:
- REMITTANCE drops are silent. If a supplier sends a genuine remittance we want to record, the raw payload is only visible in server logs. If that becomes a real need, we add a "Classified-as-OTHER" log tab (phase 2).
- Gmail forwarder size bounce (Newline Beverages case, 2026-04-23) is not fixed by this plan — see §6.3.11 (Gmail API direct integration) for the real remedy.

---

### 3.23 AP Dashboard UX Polish ✅ COMPLETE (2026-04-23)

**Store filter simplification**: Holdings + PYC buttons hidden from the store toggle row (`STORE_ORDER = ["sushi","sandwich"]`). Their invoices still appear under "All Stores" — just no dedicated tab, because they produce almost no AP volume.

**To Pay default state**: All supplier accordions collapsed on every tab/store change. Removed the old auto-open useEffect. Matches the manager's actual review flow (read supplier name + total first, expand only the groups with discrepancies).

**Weekly colour bands** (replaces zebra-stripe of §3.14): within each supplier's expanded table, consecutive rows sharing a Monday-of-due-date get a faint shared background band (`bg-slate-200/80`) and a distinct blue-tint hover (`bg-blue-50`). Bands were intentionally strengthened after the first iteration was too faint to distinguish. `getMondayStr` still uses local-midnight parsing (§5).

**Shift+click range select** (commits `1175f90`, `f97714f`): Gmail/Excel-style range selection inside supplier tables. Shift+click on a second row selects every row between the last clicked and the current (inclusive). If the anchor row was selected, the range is **added**; if the anchor was unselected, the range is **removed** — so Shift+click also deselects a band. Uses a `lastClickedId` ref scoped per supplier group.

**Selected Total copy buttons** (commit `287ce5b`): each supplier's per-group "$X selected (N)" breakdown and the page-header Selected Total card now show a clipboard icon. Tap writes the raw numeric amount (no `$`, no commas) to the clipboard — manager pastes straight into internet-banking payment amount fields without edit.

**Paid History sort direction** (commits `595db0d`, `307c571`): payment-date groups remain newest-first (most recent at the top), but within each payment-date group the individual invoice rows sort **oldest invoice date first**. Matches how the manager reads reconciliation — "which old invoice did this latest payment clear?"

---

### 3.24 Bank Transfer Tracker — Per-Store Totals & Copy Buttons ✅ COMPLETE (2026-04-23)

**Per-store summary cards** (commit `6e68a82`, `client/src/pages/admin/Payrolls.tsx`): top of the Bank Transfer Tracker dialog shows one card per store (Sushi / Sandwich) with: total bank outflow for that store, completed count, remaining count. Replaces the previous flat "N of M transfers done" single line.

**Copy buttons across the tracker** (commits `287ce5b`, `556703f`):
- Next to each employee's bank deposit amount → copies raw numeric value.
- Next to each store's card total → copies raw numeric value.
- Next to each employee's **name** → copies the exact string shown (nickname fallback → `firstName lastName`). Used when the bank's Payee Reference field wants the legal name copy-pasted rather than retyped.

All copy buttons use the shared shadcn `Copy` icon (lucide-react), toast on success.

---

### 3.25 Employee Portal UX Hardening Batch ✅ COMPLETE (2026-04-23)

Three sequential commits (`03a2ea0`, `33019bf`, `7f374e6`) fixed 15 issues surfaced by a kitchen-staff UX audit. All live in `client/src/pages/mobile/EmployeePortal.tsx`.

**Session persistence (v4 → v5)**:
- `ep_session_v4` (sessionStorage) → `ep_session_v5` (localStorage). Employee no longer logs out when they close the tab or put the phone to sleep.
- One-time migration on mount: if `ep_session_v4` exists in sessionStorage, copy to `ep_session_v5` in localStorage and delete the legacy key.

**PIN entry safety**:
- Auto-submit grace window: 80 ms → **350 ms**, with a cancel ref. Gives slow-typing users time to correct a 5th-digit mispress without firing the login call.
- PIN prompt copy: "Enter the last 4 digits of the mobile number you gave your manager" (previously just "Enter PIN").
- **Weak-pattern rejection** in `/api/portal/change-pin` + drawer validation: rejects repeated digits (1111), ascending/descending sequences (1234, 4321), and new PINs that differ from the current by fewer than 2 positions. Employee sees an inline explanation rather than a generic "Invalid PIN".

**Timesheet drawer guards**:
- `inFlightRef` ref on Submit buttons — prevents double-submit while the mutation is pending (was reproducible on slow 4G).
- Soft confirmation when the employee types different hours than the rostered times: "You're submitting X hours for a shift rostered at Y hours — are you sure?" (Cancel keeps them in the drawer.)

**Home tab prominence & banners**:
- `TodayShiftCard` store name: 13px / weight 700 → 18px / weight 800 so the first thing the employee sees is the store they're scheduled for today.
- **Pending-timesheet banner**: if the employee has any shift in the past 7 days without a timesheet submission, a banner appears at the top of the Home tab with a direct jump link.

**Unscheduled shift drawer**:
- Smart default times: current-time-rounded-to-nearest-15min as start, start + 8h as end. Replaces the previous "blank empty fields".
- Inline end-before-start error with an AlertTriangle icon and a pink background (previously a silent no-op on submit).

**Notices**:
- Each notice now has a × button in its top-right that dismisses locally. Dismissed IDs stored in `localStorage` per-employee (`dismissed_notices_${employeeId}`), so the notice stays dismissed across sessions but the admin still sees it as active.

**Profile draft safety**:
- Draft of unsaved profile edits kept in `localStorage`; restored on mount.
- `beforeunload` listener warns before reload if draft is dirty.
- "• Unsaved" indicator next to Save button.
- Back button ("Home") warns if draft is dirty: "You have unsaved profile changes. Discard and go back?"

**Required-field clarity**:
- Asterisks (`*`) on TFN, BSB, Account No, Super Fund, Super Member No labels.
- Submit errors now list the specific missing field names instead of a generic "Please complete all required fields".
- BSB `maxLength`: 6 → 9 (tolerate user-entered `123-456` or `123 456`). Server strips non-digits before storage.

**First-login PIN drawer**:
- Added "Skip for now" button that calls `onPinChanged` (the parent receives it as a successful close). Employees who just want to view today's shift can skip the forced PIN change on first login.

---

## 4. API Endpoints

### Stores
| Method | Path | Description |
|---|---|---|
| GET | `/api/stores` | List all stores |
| POST | `/api/stores` | Create store |
| PUT | `/api/stores/:id` | Update store |
| PUT | `/api/stores/:id/payroll-note` | Update global payroll note |

### Employees & HR
| Method | Path | Description |
|---|---|---|
| GET | `/api/employees` | List employees (filterable) |
| POST | `/api/employees` | Create employee |
| GET | `/api/employees/:id` | Get employee detail |
| PUT | `/api/employees/:id` | Update employee |
| PUT | `/api/employees/:id/store-assignments` | Update multi-store assignments |
| POST | `/api/employees/:id/vevo-upload` | Upload + parse VEVO PDF |
| POST | `/api/employees/import` | Bulk CSV import |
| POST | `/api/employees/import-photos` | Bulk photo import |
| GET | `/api/employee-store-assignments` | List all store assignments |
| PATCH | `/api/employee-store-assignments/:id` | Update single assignment |
| POST | `/api/direct-register` | Create employee directly |

### Candidates & Onboarding
| Method | Path | Description |
|---|---|---|
| GET | `/api/candidates` | List candidates |
| POST | `/api/candidates` | Create candidate |
| GET | `/api/candidates/:id` | Get candidate |
| PUT | `/api/candidates/:id` | Update candidate |
| POST | `/api/candidates/:id/hire` | Promote to employee (generates token) |
| GET | `/api/onboarding/:token` | Validate onboarding token |
| POST | `/api/onboarding/:token` | Submit onboarding form |

### Roster & Shifts
| Method | Path | Description |
|---|---|---|
| GET | `/api/rosters` | Get rosters (by storeId + weekStart) |
| POST | `/api/rosters` | Create roster entry |
| DELETE | `/api/rosters/:id` | Delete roster entry |
| POST | `/api/rosters/copy-week` | Copy previous week roster |
| POST | `/api/rosters/bulk-create` | Bulk create/overwrite roster entries (Generate Shifts) |
| POST | `/api/rosters/publish` | Publish roster for a store+week |
| GET | `/api/rosters/published` | Check published status |
| GET | `/api/rosters/employees` | Employees eligible for roster |
| GET | `/api/roster-periods` | List roster periods |
| POST | `/api/roster-periods` | Create roster period |
| PUT | `/api/roster-periods/:id` | Update roster period |
| GET | `/api/shifts` | List shifts |
| POST | `/api/shifts` | Create shift |
| PUT | `/api/shifts/:id` | Update shift |
| DELETE | `/api/shifts/:id` | Delete shift |

### Settings
| Method | Path | Description |
|---|---|---|
| GET | `/api/shift-presets` | List all store fixed shift presets |
| GET | `/api/shift-presets/:storeId` | Get fixed preset for a specific store |
| PUT | `/api/shift-presets/:storeId` | Upsert (create or update) fixed preset for a store |
| GET | `/api/preset-buttons` | List custom quick-fill buttons (filter by ?storeId=) |
| POST | `/api/preset-buttons` | Create a new custom quick-fill button |
| PUT | `/api/preset-buttons/:id` | Update a custom quick-fill button |
| DELETE | `/api/preset-buttons/:id` | Delete a custom quick-fill button |
| GET | `/api/store-config/trading-hours` | Get trading hours for a store (?storeId=) |
| PUT | `/api/store-config/trading-hours` | Upsert one day's trading hours for a store |
| GET | `/api/store-config/school-holidays` | List all school holiday periods (sorted by startDate) |
| POST | `/api/store-config/school-holidays` | Create school holiday period |
| PUT | `/api/store-config/school-holidays/:id` | Update school holiday period |
| DELETE | `/api/store-config/school-holidays/:id` | Delete school holiday period |
| GET | `/api/store-config/public-holidays` | List all public holidays (sorted by date) |
| POST | `/api/store-config/public-holidays` | Create public holiday |
| PUT | `/api/store-config/public-holidays/:id` | Update public holiday (name, date, storeClosures) |
| DELETE | `/api/store-config/public-holidays/:id` | Delete public holiday |
| GET | `/api/store-config/recommended-hours` | List recommended weekly hours for all stores |
| PUT | `/api/store-config/recommended-hours` | Upsert recommended hours for a store |
| GET | `/api/automation-rules` | All rules enriched with employeeName + storeName |
| POST | `/api/automation-rules` | Create rule (validated via insertAutomationRuleSchema) |
| GET | `/api/automation-rules/due-today` | Active rules due today (Sydney TZ logic), enriched |
| PUT | `/api/automation-rules/:id` | Update rule (partial) |
| DELETE | `/api/automation-rules/:id` | Delete rule, returns `{ deleted: true }` |
| POST | `/api/automation-rules/:id/execute` | Execute rule — returns `{ success, message }` |

### Time Logs & Timesheets
| Method | Path | Description |
|---|---|---|
| GET | `/api/time-logs` | List time logs |
| POST | `/api/time-logs/clock-in` | Record clock-in |
| POST | `/api/time-logs/clock-out` | Record clock-out |
| PUT | `/api/time-logs/:id` | Update time log |
| GET | `/api/timesheets` | List period timesheets |
| POST | `/api/timesheets/generate` | Generate timesheets from time logs |
| GET | `/api/timesheets/:id` | Get timesheet |
| PUT | `/api/timesheets/:id/approve` | Approve timesheet |
| PUT | `/api/timesheets/:id/reject` | Reject timesheet |
| GET | `/api/admin/approvals` | List shift timesheet submissions |
| PUT | `/api/admin/approvals/:id/approve` | Approve single shift timesheet |
| PUT | `/api/admin/approvals/:id/edit-approve` | Edit times + approve |
| PUT | `/api/admin/approvals/:id/reject` | Reject / Mark Absent (PENDING→REJECTED) |
| PUT | `/api/admin/approvals/:id/update-times` | Update times only (no status change) |
| POST | `/api/admin/approvals/add-shift` | Add ad-hoc shift directly |
| POST | `/api/admin/approvals/bulk-approve` | Bulk approve shift timesheets |
| POST | `/api/admin/approvals/bulk-revert` | Bulk revert APPROVED → PENDING |

### Payroll
| Method | Path | Description |
|---|---|---|
| GET | `/api/payrolls` | List payrolls (filterable) |
| GET | `/api/payrolls/current` | Current period payrolls |
| GET | `/api/payrolls/latest-period` | Latest period dates |
| GET | `/api/payrolls/:id` | Get payroll record |
| PUT | `/api/payrolls/:id` | Update payroll |
| PATCH | `/api/payrolls/:id/bank-transfer-status` | Toggle bank transfer done |
| POST | `/api/payrolls/generate` | Generate payroll for period |
| POST | `/api/payrolls/bulk` | Bulk upsert payrolls |
| POST | `/api/payrolls/import-archive` | Import legacy payroll archive |
| GET | `/api/payrolls/bank-deposits` | Bank deposit summary |
| GET | `/api/payrolls/envelope-slips` | Envelope/pay slip data |
| GET | `/api/admin/weekly-payroll` | Weekly payroll summary across stores |

### Finance & Cash
| Method | Path | Description |
|---|---|---|
| GET | `/api/finance/transactions` | List financial transactions |
| POST | `/api/finance/manual` | Create manual transaction |
| POST | `/api/finance/convert` | Create convert (float transfer) |
| POST | `/api/finance/remittance` | Create remittance |
| PUT | `/api/finance/transactions/:id/settle` | Mark bank settled |
| DELETE | `/api/finance/transactions/:id` | Delete transaction |
| GET | `/api/finance/balances` | Store balance summary |
| POST | `/api/finance/import-legacy-converts` | Import legacy convert records |
| GET | `/api/cash-sales` | List cash sales (filterable) |
| POST | `/api/cash-sales` | Create cash sale entry |
| POST | `/api/cash-sales/bulk` | Bulk create cash sales |
| PUT | `/api/cash-sales/:id` | Update cash sale |
| GET | `/api/cash-sales/latest-date` | Latest date with data |
| DELETE | `/api/cash-sales/void-day` | Void all entries for a date |
| GET | `/api/daily-closings` | List daily closings |
| POST | `/api/daily-closings` | Create daily closing |
| PUT | `/api/daily-closings/:id` | Update daily closing |
| GET | `/api/daily-close-forms` | List employee close forms |
| POST | `/api/daily-close-forms` | Submit employee close form |

### Accounts Payable
| Method | Path | Description |
|---|---|---|
| GET | `/api/suppliers` | List suppliers |
| POST | `/api/suppliers` | Create supplier |
| PUT | `/api/suppliers/:id` | Update supplier |
| GET | `/api/supplier-invoices` | List invoices (with supplier join, excludes soft-deleted) |
| POST | `/api/supplier-invoices` | Create invoice manually |
| PUT | `/api/supplier-invoices/:id` | Update invoice |
| GET | `/api/supplier-invoices/deleted` | List soft-deleted (Trash) invoices |
| PATCH | `/api/supplier-invoices/:id/soft-delete` | Soft-delete invoice (move to Trash) |
| PATCH | `/api/supplier-invoices/:id/restore` | Restore from Trash |
| PATCH | `/api/supplier-invoices/:id/reassign` | Change supplier on invoice |
| POST | `/api/supplier-invoices/:id/reparse-pdf` | Re-run AI parse on stored PDF |
| DELETE | `/api/supplier-invoices/:id` | Permanently delete invoice |
| GET | `/api/supplier-invoices/:id/pdf` | Stream PDF file for viewing |
| GET | `/api/invoices` | AP dashboard invoices (enriched, filterable by status/supplierId/storeId) |
| PATCH | `/api/invoices/:id/status` | Update invoice status (e.g. PENDING → PAID) |
| POST | `/api/invoices/:id/revert` | Revert PAID invoice back to PENDING |
| GET | `/api/invoices/review` | List all REVIEW-status invoices |
| POST | `/api/invoices/review/approve-group` | Create supplier + sweep REVIEW → PENDING |
| POST | `/api/invoices/parse-upload` | Parse uploaded file (image/PDF) via AI |
| POST | `/api/invoices/bulk-reclassify` | One-shot: re-run parser + 4-way classifier on every REVIEW/QUARANTINE row with a stored PDF. Promotes INVOICE → PENDING, expands STATEMENT, drops REMITTANCE/OTHER. Returns `{ promoted, statementExpanded, dropped, needsManual, totalProcessed }`. §3.22. |
| POST | `/api/invoices/backfill-from-inbox` | One-shot: walk legacy `universal_inbox` rows, pull attached PDF, run the new pipeline to recover orphan REVIEW invoices. Idempotent. §3.22. |
| GET | `/api/supplier-payments` | List payments |
| POST | `/api/supplier-payments` | Record payment |

### Email Routing & Triage Inbox
| Method | Path | Description |
|---|---|---|
| GET | `/api/email-routing-rules` | List all routing rules |
| PUT | `/api/email-routing-rules/:email` | Create or update routing rule |
| DELETE | `/api/email-routing-rules/:email` | Delete routing rule |
| GET | `/api/universal-inbox` | List inbox items (filterable by status) |
| POST | `/api/universal-inbox/:id/route` | Route item (saves rule + re-processes email) |

### Rejected Emails (Whitelist Pipeline — §3.22)
| Method | Path | Description |
|---|---|---|
| GET | `/api/rejected-emails` | List rejected emails (filter by `?reviewed=false` for unread tab badge) |
| POST | `/api/rejected-emails/:id/promote` | Promote: append sender to existing supplier's `contactEmails`, or create new supplier. Marks row `reviewed=true`. |
| DELETE | `/api/rejected-emails/:id` | Permanently delete a rejected email row |

### Webhooks & Email Inbound
| Method | Path | Description |
|---|---|---|
| POST | `/api/webhooks/inbound-invoices` | Cloudmailin inbound email handler |
| GET | `/api/webhooks/quarantined-emails` | List quarantined (unknown sender) emails |

### Notices
| Method | Path | Description |
|---|---|---|
| GET | `/api/notices` | List notices (filterable by storeId) |
| POST | `/api/notices` | Create notice |
| PUT | `/api/notices/:id` | Update notice |
| DELETE | `/api/notices/:id` | Delete notice |

### Executive / To-Do
| Method | Path | Description |
|---|---|---|
| GET | `/api/todos` | List todos (filterable by status) |
| POST | `/api/todos` | Create todo |
| PATCH | `/api/todos/:id` | Update todo (status, fields) |
| DELETE | `/api/todos/:id` | Delete todo |
| POST | `/api/todos/:id/draft-reply` | AI-translate Korean draft → English reply |
| POST | `/api/todos/:id/send-reply` | Send English reply via SMTP, mark DONE |
| GET | `/api/todos/:id/korean-summary` | Generate Korean AI summary of email body |

### RBAC & Permissions
| Method | Path | Description |
|---|---|---|
| GET | `/api/permissions` | Get full permission matrix (seeds defaults) |
| PATCH | `/api/permissions` | Bulk replace permission matrix |

### Dashboard
| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/summary` | Summary: payroll totals, sales, cash balances. Labor date filter uses `periodStart > endDate` (not `periodEnd`) to correctly include payroll periods that overlap the selected range. |

### Automation Rules
| Method | Path | Description |
|---|---|---|
| GET | `/api/automation-rules` | List all rules (enriched with employee/store names) |
| POST | `/api/automation-rules` | Create automation rule |
| PUT | `/api/automation-rules/:id` | Update automation rule |
| DELETE | `/api/automation-rules/:id` | Delete automation rule |
| GET | `/api/automation-rules/due-today` | Rules due today (Sydney timezone, isActive=true only) |
| POST | `/api/automation-rules/:id/execute` | Execute rule — ROSTER: upsertRoster for each dayOfWeek date this week; PAYROLL_ADJUSTMENT: update current cycle payroll adjustment; FINANCE_TRANSFER: createFinancialTransaction (CONVERT or REMITTANCE) |

### Shopping List
| Method | Path | Description |
|---|---|---|
| GET | `/api/shopping/items` | Get item catalogue for a store |
| POST | `/api/shopping/items` | Add item to catalogue |
| GET | `/api/shopping/active` | Get active shopping list for a store |
| POST | `/api/shopping/active` | Add item to active list (increments count) |
| DELETE | `/api/shopping/active/:id` | Remove (tick off) an item from active list |
| DELETE | `/api/shopping/active` | Clear entire active list for a store |

### Storage
| Method | Path | Description |
|---|---|---|
| GET | `/api/storage/items` | List storage item catalogue (filter by ?storeId=) |
| POST | `/api/storage/items` | Create storage item |
| PATCH | `/api/storage/items/:id` | Update storage item fields |
| DELETE | `/api/storage/items/:id` | Delete storage item |
| PATCH | `/api/storage/items/:id/stock` | Update stock count + lastCheckedAt + lastCheckedBy |
| GET | `/api/storage/active` | Get active fetch list (filter by ?storeId=) |
| POST | `/api/storage/active` | Add item to active fetch list |
| DELETE | `/api/storage/active/:id` | Remove single item from fetch list (fetched) |
| DELETE | `/api/storage/active` | Clear entire fetch list for a store (?storeId=) |
| GET | `/api/storage/units` | List all units (seeds defaults if empty) |
| POST | `/api/storage/units` | Create new unit (409 if duplicate) |
| DELETE | `/api/storage/units/:id` | Delete unit (409 if in use by any item) |

### Intercompany Settlements
| Method | Path | Description |
|---|---|---|
| PATCH | `/api/settlements/:id/settle` | Mark settlement as settled (link to transaction) |
| POST | `/api/admin/backfill-settlements` | Retroactively generate settlement records |

### AI Utilities
| Method | Path | Description |
|---|---|---|
| POST | `/api/ai/email-translate-summarize` | Translate English email to Korean + summarise |

### Employee Portal
| Method | Path | Description |
|---|---|---|
| POST | `/api/mobile/auth` | Validate employee by store + name |
| POST | `/api/portal/login` | Portal login (returns session) |
| POST | `/api/portal/login-pin` | Portal PIN login — returns `id`, `nickname`, `firstName`, `storeId`, `selfieUrl`, `role`. Rate-limited (5 attempts / 15 min). Auto-upgrades plain-text PIN to bcrypt on success. |
| POST | `/api/portal/change-pin` | Employee changes their own PIN. Body: `{ employeeId, currentPin, newPin }`. Verifies current PIN (bcrypt-aware), hashes and saves new PIN. |
| GET | `/api/portal/employees` | Employees for a store (for login picker) |
| GET | `/api/portal/stores` | Active stores for portal |
| GET | `/api/portal/today` | Today's shift for employee |
| GET | `/api/portal/shift` | Current week shifts |
| GET | `/api/portal/week` | Published roster for week |
| GET | `/api/portal/timesheet` | Employee's timesheet submissions |
| POST | `/api/portal/timesheet` | Submit shift timesheet |
| POST | `/api/portal/unscheduled-timesheet` | Submit unscheduled shift |
| GET | `/api/portal/cycle-timesheets` | All timesheets for current payroll cycle |
| GET | `/api/portal/missed-shifts` | Rostered shifts with no timesheet submission |
| GET | `/api/portal/history` | Past payroll records for employee |

### Misc
| Method | Path | Description |
|---|---|---|
| POST | `/api/upload` | General file upload (returns URL) |

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

- [x] **Payroll: 신규 Approve된 shift의 Hours가 해당 cycle에서 0으로 표시되는 버그** (2026-04-21 해결)
  - **증상**: Pending Approval에서 shift를 Approve한 뒤 Payroll 화면 해당 cycle로 이동해도 Hours가 0으로 유지. sessionStorage를 수동으로 비우고 새로고침하면 정상 표시.
  - **근본 원인**: `client/src/pages/admin/Payrolls.tsx` draft hydration 로직이 기존에 `if (!merged[employee.id])` 패턴으로 작동 — sessionStorage에 draft row가 있으면 아예 재계산을 스킵. 과거에 해당 cycle을 방문했던 시점(approve 전)에 `hours:0`으로 저장된 draft가 이후 approve된 데이터를 덮어씀.
  - **수정**: `mergeDraftOverManagerInputs()` 헬퍼 추가. API 출처 필드(hours, rate, fixedAmount, 직원 플래그)는 항상 최신 데이터로 재계산, 매니저 타이핑 필드(adjustment, memo, tax override, gross/cash 수동 분할)만 sessionStorage에서 보존 후 `recalcRow` 재실행. `isNewContext` 경로와 background refetch 경로 둘 다 동일하게 정정.
  - **영향**: 기존 draft 보존 스펙(§2.1.1)은 매니저 입력 필드에 한정되어 유지됨. 탭/매장 전환·HMR 후에도 typed adjustment/memo/tax 계속 보존, 대신 새로 승인된 shift는 즉시 반영.

- [ ] **Admin/non-portal API routes are not authenticated** 🚨 (2026-04-30 발견)
  - **현황 (2026-04-30 부분 해결)**: 모바일 portal 라우트(`/api/portal/today|shift|week|missed-shifts|cycle-timesheets|history|timesheet|unscheduled-timesheet`)는 Bearer 토큰 게이트(§3.x portal_sessions 테이블) 적용됨. 어드민·기타 라우트는 여전히 무인증.
  - **남은 leak 범위**: `/api/employees`, `/api/payrolls`, `/api/daily-closings`, `/api/suppliers`, `/api/invoices`, `/api/timesheets`, `/api/rosters`, `/api/finance/*`, `/api/cash-sales`, etc. 모든 어드민 라우트. URL 알면 누구나 호출 가능.
  - **해결안 (Phase B)**: `express-session` + `connect-pg-simple` wiring (이미 패키지 설치됨, `.env.local`에 `SESSION_SECRET` 존재). 어드민 로그인 흐름 추가 (현재 어드민 페이지는 인증 없이 접근). 라우트별 role 가드 미들웨어 (OWNER/MANAGER 권한 체크). 1–2일 작업 추정.
  - **임시 완화 (2026-04-30 적용)**: Railway URL이 직원에게 노출되는 사고 발생 — 어드민 경로에 사이트 전체 HTTP Basic Auth 게이트 추가 (`server/index.ts`, env: `ADMIN_AUTH_USER`/`ADMIN_AUTH_PASS`). Portal(`/m/*`, `/api/portal/*`, `/assets/*`)·Cloudmailin 웹훅은 bypass. 직원은 PIN-only 흐름 유지. 어드민 URL은 비번 popup으로 차단. Phase B 완료 시 제거 또는 defense-in-depth 유지 결정.
  - **남은 follow-up**: Portal `POST /api/portal/login-pin` rate-limit (4자리 PIN brute-force 위험 — 분당 10회·시간당 50회·5회 실패 시 5분 lockout, ~20줄). 현재 위협 모델에서 제외했지만 발생 시 즉시 추가.

- [x] **Statement vs Invoice reconciliation stability** (2026-04-23 해결 — §3.22)
  - **조치**: 화이트리스트 전용 파이프라인 도입 + 4-way classifier(INVOICE/STATEMENT/REMITTANCE/OTHER). Statement은 per-row PENDING으로 확장되고 `(supplierId, invoiceNumber)` 중복 스킵, 1-row 결과는 REVIEW 유지. Xero 송신자 해석 버그 수정으로 `post.xero.com` → 실제 공급업체 정상 매칭.
  - **Stuck-invoice 회복**: `POST /api/invoices/bulk-reclassify` + `POST /api/invoices/backfill-from-inbox` 실행으로 74건 중 대다수 PENDING으로 승격됨.
  - **남은 작업**: (v2 과제) 공백/접두사 차이가 있는 같은 invoice 번호의 fuzzy-dedup 규칙, statement-원본 REVIEW 아이템을 한 화면에서 재점검하는 reconciliation 리포트.

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

#### 6.1.1 Phase 1 — Accounts Payable Fine-Tuning ✅
- [x] **AI Parser Update (Statements & Routing):** `invoiceParser.ts` returns `ParsedInvoice[]` arrays (never a lumped total). `storeCode` derived from "Bill To" text: `"SUSHI"` (Olitin/Sushime), `"SANDWICH"` (Eatem). `max_tokens = 1000` for multi-invoice responses.
- [x] **Webhook DB Logic:** `POST /api/webhooks/inbound-invoices` iterates the array, resolves `storeCode` → `storeId`, deduplicates per `(supplierId, invoiceNumber)`. Returns `{ created, skipped }`.
- [x] **AP Dashboard UI Upgrades:** Store filter dropdown, checkbox column, real-time Selected Total, bulk Mark-N-as-Paid.

#### 6.1.2 Phase 2 — Communication & Mobile ✅
- [x] **Notice Board** — `notices` table + `/admin/notices` admin page + portal HomeTab notices feed.
- [x] **PWA Install** — `manifest.json`, `theme-color`, `apple-mobile-web-app-capable`. Service worker / offline / push are deferred (see §6.3).

#### 6.1.3 Phase 5.0 — AI Email Reply Workflow ✅
- `todos` table extended with `originalSubject`, `originalBody`, `senderEmail`.
- `server/mailer.ts` created (nodemailer Gmail SMTP).
- `POST /api/todos/:id/draft-reply` — Korean → English via GPT-4o.
- `POST /api/todos/:id/send-reply` — sends via SMTP, marks DONE.
- `POST /api/todos/:id/korean-summary` — GPT-4o Korean summary, cached per task.
- `POST /api/ai/email-translate-summarize` — standalone endpoint used by Triage Inbox.
- `ExecutiveDashboard.tsx`: `EmailReplyModal` (left = original English + Korean summary, right = Korean input → translate → editable English → send).

#### 6.1.4 Phase 5.1 — Dashboard Cockpit ✅
- AI Smart Inbox widget on `/admin` (top 5 urgent tasks).
- Shopping List widget (per-store cart, tick off / clear).
- Today's Recurring Tasks widget (from §3.20 Automation Rules).

#### 6.1.5 Phase 5.2 — Role-Based Access Control (RBAC) ✅
- `admin_permissions` table (composite PK).
- `GET /api/permissions` (seeds defaults), `PATCH /api/permissions` (bulk replace).
- Defaults: ADMIN = all, MANAGER = most ops, STAFF = Dashboard + Rosters.
- `AdminRoleContext` (localStorage `admin_role_v1`), sidebar role dropdown, dynamic nav filtering, header role badge.
- `/admin/settings/access-control` — ADMIN-only permission matrix editor.

#### 6.1.6 Phase 5 — Storage & Shopping Module ✅
- **Shopping List**: `ShoppingListView` in EmployeePortal, catalogue grouping + search + clear, sorted by `selectionCount` desc within each category.
- **Storage List**: `storageItems` + `activeStorageList` tables (FK to lastCheckedBy/addedBy intentionally removed — plain varchar for display name). 9 storage methods + 7 API routes. Portal `StorageListView` (amber-500 accent), admin `/admin/storage` page.
- **Dynamic Units**: `storageUnits` table seeded with ea/pack/box/ctn. Manager via "Manage Units" panel in admin page; Select in all forms reads from `GET /api/storage/units`. Delete blocked when unit is in use.

#### 6.1.7 Phase 6 — Payroll Cycle Hardening ✅
- [x] **Fixed-anchor pay cycle** (`getCurrentPayCycle`, `PAY_CYCLE_ANCHOR = Mar 23 2026`) — see §3.6 + §5.
- [x] **Period sessionStorage persistence** with cycle-grid validation (`PERIOD_SS_KEY`) — survives HMR / reload, rejects misaligned legacy entries.
- [x] **AP week separator** — `flatMap` row builder + `getMondayStr` injects a `bg-slate-300 dark:bg-slate-600` 3px divider between weeks; replaces the old zebra-stripe approach.
- [x] **Local-midnight date parsing rule** — `new Date(dateStr + "T00:00:00")` mandated everywhere; documented in §5 Conventions.

#### 6.1.8 Phase 7 — AP Whitelist-Only Pipeline + Stuck-Invoice Recovery ✅ (2026-04-22 → 2026-04-23)
- [x] **`rejectedEmails` table + CRUD endpoints** — whitelist-only front door (§3.22, §2.5, §4 Rejected Emails group).
- [x] **4-way classifier** (`classifyDocumentForAP` → INVOICE / STATEMENT / REMITTANCE / OTHER) — fixes Xero Payment Advice slip misclassification.
- [x] **Webhook rewrite** — Triage gate replaced with whitelist + classify (§3.22). Sidebar Smart Inbox + Triage Inbox hidden.
- [x] **`POST /api/invoices/bulk-reclassify`** + **`POST /api/invoices/backfill-from-inbox`** — one-shot stuck-invoice recovery. Reclassified ~74 stuck REVIEW/QUARANTINE rows; 16 orphans pulled back from universal_inbox.
- [x] **Multi-store supplier resolver** (`resolveStoreIdForInvoice` + `MULTI_STORE_SUPPLIER_IDS`) — PDF storeCode wins; history-majority only for single-store suppliers with ≥80% concentration.
- [x] **PDF extract hardening** — `pdftotext` fallback for pdf-parse failures; HTML-stripped body-text fallback when no attachment is present.
- [x] **Sender resolution fix** — skip `X-Original-Sender` when its domain is in `GENERIC_SERVICE_DOMAINS` (Xero/MYOB/QuickBooks).
- [x] **Rejected Emails tab** in Accounts Payable — promote to supplier (new or existing) or delete.

#### 6.1.9 Phase 8 — AP + Payroll UX Polish ✅ (2026-04-23)
- [x] **To Pay defaults**: Holdings/PYC hidden from store toggle, all supplier accordions collapsed by default.
- [x] **Week colour bands** inside supplier tables (bg-slate-200/80 band + bg-blue-50 hover).
- [x] **Shift+click range select** (Gmail/Excel pattern) — add or remove contiguous rows in one gesture.
- [x] **Paid History sort**: payment-date groups newest-first; invoices within a group oldest-first.
- [x] **Copy buttons** on Selected Total, per-supplier subtotals, per-employee bank amount, per-store bank total, and employee name.
- [x] **Bank Transfer Tracker** per-store summary cards at the top of the dialog.

#### 6.1.10 Phase 9 — Employee Portal UX Hardening Batch ✅ (2026-04-23)
- [x] **Session v5** — `ep_session_v4` sessionStorage → `ep_session_v5` localStorage (auto-migrated); session survives tab close.
- [x] **PIN safety** — auto-submit grace 80ms → 350ms, weak-pattern rejection (repeated / sequential / <2 digits different), clearer prompt.
- [x] **Timesheet guards** — `inFlightRef` double-submit prevention + soft confirmation for modified hours.
- [x] **Home tab prominence** — TodayShiftCard store name 18px/800; pending-timesheet banner.
- [x] **Smart default times** on Unscheduled shift drawer; inline end-before-start error.
- [x] **Notices dismissible** (persisted per-employee in localStorage).
- [x] **Profile draft safety** — localStorage draft + `beforeunload` + "• Unsaved" indicator + back-nav confirmation + required-field asterisks.
- [x] **First-login PIN drawer**: "Skip for now" button added; BSB maxLength 6 → 9.

#### 6.1.13 Interview → Hire → Onboarding Handoff (GuniSMS) ✅ (2026-04-24)

Turns interview capture + hiring + onboarding into one flow so anyone conducting an interview follows the same script and Hire triggers an SMS to the candidate with their onboarding link.

- **Schema (`candidates`)**: new columns `phone`, `birth_year`, `visa_expiry_month`, `has_experience`, `availability_days` (jsonb: `{ mon|tue|…: "NONE"|"MORNING"|"AFTERNOON"|"ALLDAY" }`), `availability_commitment`. Legacy `availability` / `experience` / `desired_rate` / `interview_notes` kept and relabelled in the UI. Run `npm run db:push` on target DB.
- **Schema (`employees`)**: new `candidate_id` FK → `candidates.id` (nullable). Populated during onboarding submission so Phase C can look up the interview context.
- **`server/sms.ts`**: GuniSMS adapter. Normalises AU mobiles to E.164 (`normalizeAuPhone`), returns `{ ok:false, error:"not configured" }` when env is missing so callers fall back to manual link sharing. Pending: finalise request body against the actual GuniSMS spec.
- **`.env.example`**: `GUNISMS_API_URL`, `GUNISMS_API_KEY`, `GUNISMS_SENDER_ID`.
- **Routes**:
  - `POST /api/candidates/:id/send-form-sms` — marks HIRE if needed, reuses an active onboarding token (or mints one), calls `sendSms`, returns `{ ok, url, smsId?, error? }`.
  - `GET /api/employees/:id/interview` — joins `employees.candidate_id` → `candidates`, 404 when no link exists.
  - `POST /api/onboarding/:token` now copies `candidateId` onto the new `employees` row.
- **Storage**: `getActiveOnboardingTokenForCandidate` + `getCandidateByEmployeeId` on both MemStorage and DatabaseStorage.
- **`/m/interview` (full redesign)**: 6 cards (Basic / Personal / Visa / Experience Y-N+details / 7-day × 4-slot Availability grid + commitment / Official-only salary+memo) + a Hire-or-Reject decision footer. Hire mints the token and surfaces a Send Form button → POST send-form-sms → toast "SMS sent to {phone}" or copy-link fallback.
- **`/admin/candidates` detail sheet**: shows the new fields, including an AvailabilityGrid with a free-text fallback for legacy rows. "Generate Onboarding Link" replaced with "Send Onboarding SMS" (disabled when phone is blank; falls back to the existing OnboardingLinkDialog on failure).
- **`/m/onboarding/:token`**: phone is now pre-filled from the candidate. Success screen replaced by a Welcome screen with an *Open Staff Portal* CTA + "How to log in" card + getting-started bullets (clock in/out, roster, notices, payslips).
- **`/admin/employees/:id`**: new read-only **Interview Information** card appended after Superannuation. Renders the interview answers, Interview Salary, and Interviewer Memo, only when `employees.candidateId` links to a candidate row (legacy employees see no card).

#### 6.1.12 Manager Dashboard — Permission-Driven Shortcut Grid ✅ (2026-04-23)
- [x] New `client/src/pages/admin/ManagerDashboard.tsx` — 2-column mobile-first grid of big-touch-target shortcut cards (icon + label, square aspect) wrapped in `max-w-md mx-auto` so it preserves a phone-sized feel on desktop too.
- [x] `client/src/App.tsx` — `/admin` route wrapped in `DashboardByRole` switcher: renders `ManagerDashboard` when `currentRole === "MANAGER"`, otherwise the existing `AdminDashboard` (financial KPIs, charts, AI Smart Inbox, etc.).
- [x] Shortcut list mirrors `AdminLayout` sidebar nav and is filtered via `useAdminRole().hasAccess(url)`, so whatever ADMIN toggles in `/admin/settings/access-control` is what the manager sees — no separate config.
- [x] Dashboard's own route (`/admin`) is intentionally excluded from the grid (no self-link).
- [x] No new endpoints; uses existing `/api/permissions` already consumed by `AdminRoleContext`.
- [x] **Portal → Admin role bridge** — `EmployeePortal.tsx` header Dashboard button now writes the portal session role into `localStorage["admin_role_v1"]` (Owner → ADMIN, Manager → MANAGER) before navigating to `/admin`, so `AdminRoleContext` reflects the logged-in portal role (fixed: manager saw full owner dashboard because admin_role_v1 defaulted to ADMIN).

#### 6.1.11 One-off data cleanup (2026-04-23) ✅
- [x] Roster Excel import: `Schedule-Export 2026-04-20 to 2026-04-26.xlsx` → 44 shifts imported via fuzzy name match (difflib.SequenceMatcher ratio ≥ 0.75).
- [x] StoreId backfill for orphan PENDING rows (Pearl Seafoods, YK Investment, Cn Paultry, etc.).
- [x] Credit memo handling confirmed: Foodlink SC333504 with negative $87.50 persisted correctly.

---

### 6.2 In Progress 🚧

#### 6.2.1 Manager Reporting Dashboard (High Priority)
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
- **Status:** Phase 0 (Bearer 토큰 portal 가드) 2026-04-30 완료. Phase 1+ 대기.
- **Origin:** OWNER/MANAGER가 모바일 포털에서 본인 데이터(시프트·타임시트)도 갖고 있으면서 동시에 팀을 봐야 하는데 현재 포털은 항상 `session.id`로 하드 스코프.
- **Phase 1 — Schedule 탭 Team 모드** (다음 작업 후보):
  - `usePortalScope` 훅 + `<ScopeToggle>` 세그먼트 컴포넌트 (My / Team)
  - 신규 엔드포인트 `GET /api/portal/team-week` (storeIds는 세션에서 derive — 쿼리 파라미터 X, 신뢰 경계)
  - Schedule 탭에 토글 추가, default: OWNER → Team / MANAGER → My
  - 본인 row 강조: `#f9f9f9` 배경 + 라벨 "You" (Rausch Red 사용 X — design.md §7 단일 액센트 룰 준수)
  - 다중 매장 매니저 (`storeIds=[A,B]`): union + dismissable filter chip row
  - 권한 가드: 미들웨어가 매니저 role + storeIds 검증, 매니저 storeIds 밖 직원 employeeId 거부
- **Phase 2 — Timesheets Team + Home 결합 위젯**:
  - Timesheets 탭 토글 (default My) — OWNER만 임금/페이 표시, MANAGER hours만
  - Home 탭은 토글 X, "Team on shift now" 카드 추가
  - 신규 엔드포인트: `/api/portal/team-history`, `/api/portal/team-today`
- **Phase 3 — MobileClock Team 모드**:
  - 별 플랜으로 분리 (공유 기기 위협 모델 — 가게 카운터 iPad 등). 어깨너머 보기 위험 별 검토
- **MobileRoster standalone 정리**: Schedule Team이 거의 대체. 제거 vs 어드민 전용 재배치 결정.
- **Plan 파일**: `/Users/peter/.claude/plans/peppy-splashing-thompson.md` (Phase 0 완료 상태로 보존)

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
- **Status:** Decided, deferred until after current AP cleanup stabilises. Next session will produce the fully detailed implementation plan before writing code.
- **Motivation:**
  - Cloudmailin silently drops inbound emails that exceed its size limit. First case observed 2026-04-23: Newline Beverages statement with `EStatement.pdf` was bounced by Gmail's forwarder with "Message too large" — the invoice never reached the webhook, and the app never knew the email had arrived.
  - Cloudmailin-size-dependent gaps mean manual reconciliation is required, which defeats the purpose of automation.
  - Pulling from Gmail directly eliminates the intermediate size ceiling and removes one external dependency.
- **Decision:** Replace Cloudmailin entirely (not run both). Dual ingestion complicates dedup for no reliability gain — Gmail's own 25MB receive limit covers every invoice we've seen in production.
- **Why this is possible on Railway (vs. the Replit era):** Gmail API works from anywhere, but Railway's always-on environment, durable env vars, stable HTTPS domain (for OAuth callbacks), and existing Postgres make 5-minute polling reliable. Replit free-tier sleep would have caused cold-start misses at every interval.
- **Phased plan:**
  - **Phase 1 — OAuth setup** (~2–3h). Google Cloud Console: create/reuse project, enable Gmail API, create OAuth 2.0 Client ID (Web application), register redirect URI `https://<railway-host>/api/gmail/oauth-callback`. Save `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` as Railway env vars. Server adds `GET /api/gmail/auth` (consent redirect) and `GET /api/gmail/oauth-callback` (code → refresh token → DB). One-time user consent with `gmail.readonly` scope.
  - **Phase 2 — Polling worker** (~4–6h). `node-cron` (or `setInterval`) every 5 minutes. Gmail API `users.messages.list` with `q=to:accounts@eatem.com.au newer_than:10m`. For each new message: `users.messages.get` with `format=full`, decode headers/body/attachments (base64url), dedup by `messageId`. Transform into a Cloudmailin-shaped payload and route through the SAME handler as the current webhook — preferably by refactoring the webhook body into a `processInboundEmail(payload)` helper shared by both paths.
  - **Phase 3 — Schema** (~1h). Two tables via Drizzle: `gmail_config(id, refresh_token, last_polled_at, last_history_id)` and `gmail_processed_messages(message_id PRIMARY KEY, processed_at)`. Run `db:push`, update §2.x of this plan.
  - **Phase 4 — Monitoring** (~2h). Settings page widget: last poll time, emails processed today, error count, "Re-authenticate" CTA when refresh token expires. Optional: daily summary email at 09:00 AEST listing new invoices pulled in last 24h.
  - **Testing & edges** (~3–4h). Token expiry path, malformed attachments, HTML-only emails, forwarded-bounce detection, Gmail API quota handling, restart resumption.
- **Total effort:** ~1.5–2 focused days.
- **Cost:** $0. Gmail API free within 1B quota units/day; we expect ≤5M/day. Railway bill unchanged.
- **Risks:**
  - Google Workspace admin consent may be required for organisation-owned `accounts@eatem.com.au`.
  - Scope is strictly `gmail.readonly` — no modification or delete permission requested.
  - 25MB Gmail receive limit still exists but is 5–10× higher than the Cloudmailin cap observed today.
- **Cut-over plan:**
  1. Deploy Gmail API integration alongside Cloudmailin for ≥3 days of dual observation (dedup by messageId).
  2. Verify Gmail poller captures 100% of the emails Cloudmailin captures + the previously-bounced ones.
  3. Disable Cloudmailin webhook (keep DNS/MX as-is for a week, just stop forwarding the alias into Cloudmailin).
  4. Remove Cloudmailin from Railway env + close the Cloudmailin account.
- **Prereq:** None blocking. Should follow once the current AP manual-cleanup backlog (store assignments, duplicate deletion, statement expansion) has settled and user has had 2–3 days of stable observation.

---

### 6.4 Architectural Principles (Maintained)

- **Automation Rules — no fully-automatic execution.** Every recurring task always requires a human "Execute" click on the Dashboard widget. Reminders only — never silent background mutations to payroll, finance, or rosters. Reuse existing storage/API methods inside `executeAutomationRule()` rather than building parallel logic paths.
- **Sydney timezone everywhere.** All "today" / "this week" / "this cycle" calculations use `Australia/Sydney` via `toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" })`. Never `toISOString()` for date strings.
- **Anchor-based cycles.** The fortnightly payroll grid is anchored to a fixed constant (§5) and must never drift. Adding new cycle-aware UI must validate against the anchor before treating any period as legitimate.
- **Session vs database boundary.** Drafts (payroll inputs, selected period, etc.) live in `sessionStorage` keyed by context. The DB only ever sees finalised, validated data. On commit, the matching session key is purged to prevent ghost re-hydration.
파일 분리 리팩토링 완료 이후 구현 예정