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
| Session (portal) | localStorage key `ep_session_v4` |

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
- **Standalone Add Shift button added to page header** — allows adding shifts for any employee (active or inactive) or free-text name, independent of the employee list. Searches all employees with active/inactive badge, supports free-text fallback for one-off workers.
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
- Session stored in localStorage as `ep_session_v4` (includes `selfieUrl` for avatar display, `role` field as of dynamic unit update).
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

---

## 6. Next Steps / Action Plan

### Phase 1: Accounts Payable Fine-Tuning — ✅ COMPLETE

- [x] **AI Parser Update (Statements & Routing):** `invoiceParser.ts` updated with OpenAI system prompt that handles both single invoices and statements. Always returns a JSON **array** of `ParsedInvoice[]`, never a lumped total. `storeCode` determined from "Bill To"/"Invoice To" text: `"SUSHI"` for Olitin/Sushime, `"SANDWICH"` for Eatem Pty Ltd/Eatem Sandwich, `"UNKNOWN"` otherwise. `max_tokens` set to 1000 to accommodate multi-invoice responses.

- [x] **Webhook DB Logic:** `POST /api/webhooks/inbound-invoices` iterates over the parsed array, resolves `storeCode` → `storeId` via store name matching, performs per-invoice duplicate check on `(supplierId, invoiceNumber)`, and inserts each invoice individually. Returns `{ created: N, skipped: N }`.

- [x] **AP Dashboard UI Upgrades:**
  - Store filter dropdown added alongside Status and Supplier filters.
  - Checkbox column added to invoice table; header checkbox selects all PENDING rows.
  - Real-time **Selected Total** display (`$X,XXX.XX selected (N)`) shown when items are checked.
  - Bulk **Mark N as Paid** button triggers parallel PATCH requests, invalidates cache, clears selection.

---

### Phase 2: Data & Reporting — Upcoming (High Priority)

- [ ] **Manager Dashboard:** Combine payroll totals (labor cost) and AP invoice data (COGS) against daily sales totals per store. Calculate and display:
  - Labor % = Total Payroll ÷ Total Sales × 100
  - COGS % = Total Supplier Invoices ÷ Total Sales × 100
  - Gross Profit % = (Sales − Labor − COGS) ÷ Sales × 100
  - Weekly and monthly trend charts per store.

---

### Phase 3.5: Shopping & Storage Module — IN PROGRESS

#### 3.5.1 Shopping List — Nearly Complete
- ShoppingListView component implemented in EmployeePortal.tsx
- Catalogue-based item selection, category grouping, search, clear all implemented
- `selectionCount` sort-by-popularity applied to catalogue — items sorted by `selectionCount` descending within each category (fixed in this session; `EmployeePortal.tsx` line 822)
- Admin shopping widget on Dashboard is separate and admin-only — correct as-is

#### 3.5.2 Storage List — ✅ COMPLETE
- `storageItems` + `activeStorageList` DB tables created; FK constraints on `lastCheckedBy`/`addedBy` removed (plain varchar for display name). `db:push` run.
- IStorage interface + MemStorage + DatabaseStorage: 9 methods (`getStorageItems`, `createStorageItem`, `updateStorageItem`, `deleteStorageItem`, `updateStorageItemStock`, `getActiveStorageList`, `addToActiveStorageList`, `removeFromActiveStorageList`, `clearActiveStorageList`).
- API routes in `server/routes.ts` (after line 6287): `GET/POST /api/storage/items`, `PATCH /api/storage/items/:id`, `DELETE /api/storage/items/:id`, `PATCH /api/storage/items/:id/stock`, `GET/POST /api/storage/active`, `DELETE /api/storage/active/:id`, `DELETE /api/storage/active`.
- Employee Portal: `StorageListView` component replaces "Coming soon" in storage HomeSubTab. Amber-500 accent. Catalogue drawer, "Log stock" drawer, clear-all.
- Shopping catalogue sort fixed: items now sorted by `selectionCount` descending within each category.
- Admin page `client/src/pages/admin/StorageInventory.tsx` at route `/admin/storage`: category-grouped table, CRUD dialog, stock/last-checked display. Registered in `App.tsx` + AdminLayout Operations nav.
- `storageUnits` table: dynamic unit management. Seeded with ea/pack/box/ctn on first `GET /api/storage/units` call. Admin can add/delete units via "Manage Units" collapsible panel in StorageInventory page (toggled by header button). Delete blocked with toast if unit is in use by any item. Unit Select in all item create/edit forms (both admin and portal) fetches dynamically from `GET /api/storage/units`. IStorage interface + MemStorage + DatabaseStorage implementations for 5 unit methods (`getStorageUnits`, `createStorageUnit`, `deleteStorageUnit`, `isStorageUnitInUse`, `seedStorageUnitsIfEmpty`).

#### Design Notes
- Storage UI accent color: amber-500 (consistent with unscheduled shift indicator already in portal)
- Admin storage page: Card-based grouped table (consistent with rest of admin UI)

---

### Phase 3: Communication & Mobile — ✅ COMPLETE

- [x] **Notice Board / Messaging:** In-app announcement system. `notices` DB table (title, content, targetStoreId, authorId, isActive, createdAt). Admin `/admin/notices` page — create/edit/delete with store targeting & active toggle. Employee Portal home tab shows active notices filtered by employee's store + global notices. API: `GET/POST /api/notices`, `PUT/DELETE /api/notices/:id`.

- [x] **PWA / Mobile Optimization:** Employee Portal installable as Progressive Web App:
  - `client/public/manifest.json` — name, start_url `/m/portal`, display standalone, theme_color green.
  - `client/index.html` — linked manifest, `apple-mobile-web-app-capable`, `theme-color` meta tags.
  - (Service worker / offline + push notifications deferred to Phase 5.)

---

### Phase 5: Executive Cockpit + RBAC ✅ COMPLETE

**Phase 5.0 — AI Email Reply Workflow**
- `todos` table: 3 new columns — `originalSubject` (varchar), `originalBody` (text), `senderEmail` (varchar)
- DB pushed successfully
- Webhook handler updated to store raw English email content (`originalSubject`, `originalBody`, `senderEmail`) when creating a task from inbound email
- `server/mailer.ts` created: nodemailer Gmail SMTP transporter utility
- `POST /api/todos/:id/draft-reply` — accepts `koreanDraft`, uses GPT-4o to translate to professional English, returns `englishReply`
- `POST /api/todos/:id/send-reply` — accepts `finalEnglishReply`, sends via nodemailer to `senderEmail || sourceEmail`, marks todo as DONE
- `POST /api/todos/:id/korean-summary` — generates Korean AI summary of the original English email body via GPT-4o; cached per task.
- `POST /api/ai/email-translate-summarize` — standalone endpoint: accepts `{ subject, body }`, returns `{ koreanSummary, translatedBody }`. Used by Triage Inbox to show Korean previews of incoming emails.
- `ExecutiveDashboard.tsx` updated:
  - `TaskCard`: "View & Reply" button shown for email-originated tasks (has `sourceEmail`, `senderEmail`, or `originalSubject`)
  - Email badge pill on cards with email context
  - `EmailReplyModal`: Left panel — original English email (subject + body) + Korean AI summary. Right panel — Korean input → Translate button (calls draft API) → English textarea (editable) → Send button (calls send API, closes modal, marks done)
  - Fallback: tasks without email context show no "View & Reply" button

**Phase 5.1 — Dashboard Cockpit**
- AI Smart Inbox widget added to main Dashboard (`/admin`)
- Fetches `/api/todos`, filters TODO+IN_PROGRESS, sorts by urgency (overdue first, then due date), shows top 5
- Each task card: title, sender email, due date, overdue badge, "Mark Done" quick-action button
- "View All Tasks" button links to `/admin/executive`
- **Shopping List widget** on Dashboard: per-store shopping cart for items that need purchasing. Catalogue of items (`shoppingItems`) + active list (`activeShoppingList`). Add items with quantity, tick off when purchased (deletes from active list), clear entire list. Accessible via ShoppingCart icon on Dashboard.

**Phase 5.2 — Role-Based Access Control (RBAC)**
- `admin_permissions` DB table: composite PK (role, route, label, allowed)
- `GET /api/permissions` — returns full matrix; seeds defaults on first load
- `PATCH /api/permissions` — bulk replace permissions
- Default permissions: ADMIN=all, MANAGER=most ops, STAFF=Dashboard+Rosters
- `AdminRoleContext` — React context storing current role in localStorage (`admin_role_v1`)
- Role selector dropdown in sidebar header (Global Admin / Manager / Staff)
- Sidebar nav groups filtered dynamically by role permissions
- Header badge shows current role
- `/admin/settings/access-control` — full-page permissions matrix with checkboxes; Save Changes / Reset buttons; ADMIN-only access enforced
- App.tsx wrapped with `AdminRoleProvider`

### Phase 4: AI Executive Assistant — Future (Logged for Later)

- [ ] **Smart Inbox:** AI reads all incoming emails, categorizes them (Action Required / FYI / Spam), translates body to Korean, and presents a concise summary per email. CEO can respond with one click.
- [ ] **Auto To-Do & Reminders:** AI extracts actionable tasks and due dates from emails, populates a centralized To-Do list, and fires a background scheduler for time-based notifications (e.g. "Invoice from X due in 3 days").

---

### Phase 5: External Ecosystem & Integrations — Separate Project (Future)

- [ ] **B2B Catering & Delivery App:** Build a standalone, separate web application (reusing existing Stripe e-commerce code) dedicated to catering and large orders for the Sushi and Sandwich stores. Supports menu browsing, quote requests, and advance ordering for corporate clients.
- [ ] **DoorDash Drive Integration:** Integrate the DoorDash Drive API into the Catering App for flat-fee, white-label last-mile delivery of large catering orders. Replaces consumer-facing DoorDash and gives full brand control.
- [ ] **Sales Sync (Webhook):** Build a webhook pipeline so the separate Catering App posts completed order and sales data back to this Management System's `/api/dashboard/summary` in real-time, keeping the Manager Dashboard accurate without manual entry.
---

## Section 6: Automation Rules (Reminder + One-Click Execute) — 🔄 PLANNED

### 목적
직원별 반복 예외 작업(로스터, 페이롤 adjustment, 재무 거래 등)을 시스템이 기억하고,
실행 시점에 대시보드 알림으로 표시. 관리자가 확인 후 원클릭으로 실행.

### 핵심 설계 원칙
- 완전 자동 실행 없음 — 항상 사람이 확인 후 실행
- 리마인더 중심 — 대시보드 로드 시 오늘 실행할 규칙 체크
- 기존 API 재활용 — 실행 로직은 이미 있는 API 호출만

### 6.1 DB 테이블 — automation_rules

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| title | varchar | 규칙 제목 |
| actionType | varchar | ROSTER / PAYROLL_ADJUSTMENT / FINANCE_TRANSFER |
| frequency | varchar | WEEKLY / MONTHLY_FIRST_WEEK / MONTHLY |
| dayOfWeek | int[] | 요일 (0=일~6=토), WEEKLY일 때 사용 |
| targetEmployeeId | uuid FK | 대상 직원 (nullable) |
| targetStoreId | uuid FK | 대상 매장 (nullable) |
| payload | jsonb | 실행에 필요한 값 (시간, 금액, 이유 등) |
| description | text | 관리자용 메모 |
| isActive | boolean | 활성/비활성 |
| lastExecutedAt | timestamp | 마지막 실행 시각 |
| createdAt | timestamp | |

### payload 구조 예시
- ROSTER: { "storeId": "xxx", "startTime": "08:30", "endTime": "15:30" }
- PAYROLL_ADJUSTMENT: { "amount": -401, "reason": "Car Finance" }
- FINANCE_TRANSFER: { "fromStoreId": "xxx", "toStoreId": "yyy", "amount": 300 }

### 6.2 API 엔드포인트
- GET    /api/automation-rules            전체 규칙 목록
- POST   /api/automation-rules            규칙 생성
- PUT    /api/automation-rules/:id        규칙 수정
- DELETE /api/automation-rules/:id        규칙 삭제
- GET    /api/automation-rules/due-today  오늘 실행할 규칙 목록
- POST   /api/automation-rules/:id/execute 원클릭 실행

### 6.3 실행 로직 (기존 API 재활용)
- ROSTER: POST /api/rosters — dayOfWeek 기준 이번주 날짜 계산 후 입력
- PAYROLL_ADJUSTMENT: PUT /api/payrolls/:id — 현재 사이클 페이롤에 adjustment 주입
- FINANCE_TRANSFER: POST /api/finance/convert 또는 /api/finance/remittance

### 6.4 대시보드 위젯
- /admin 대시보드에 "오늘의 반복 작업" 위젯 추가
- 대시보드 로드 시 /api/automation-rules/due-today 호출
- 각 규칙 카드: 제목, 설명, 대상, [실행] [건너뜀] 버튼
- [실행] 클릭 → execute API 호출 → 성공 토스트 → 카드 사라짐
- [건너뜀] 클릭 → 오늘 하루만 숨김 (lastExecutedAt 갱신 없음)
- 실행할 규칙 없으면 위젯 미표시

### 6.5 설정 페이지 (/admin/automations)
- 전체 규칙 리스트 (활성/비활성 토글)
- 새 규칙 추가 폼: 제목, 유형, 주기, 대상, payload 값
- 수정 / 삭제

### 작업 순서
1. DB: automation_rules 테이블 생성 + schema.ts 추가 + db:push
2. storage.ts: CRUD + due-today 로직 + execute 로직 3종
3. routes.ts: API 엔드포인트 6개
4. /admin/automations 설정 페이지 신규
5. Dashboard.tsx: 위젯 추가

### 우선순위
파일 분리 리팩토링 완료 이후 구현 예정