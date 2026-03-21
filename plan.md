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
| `suppliers` | `name`, `abn`, `contactEmails[]`, `bsb`, `accountNumber`, `contactName`, `address`, `notes`, `active` | `contactEmails` is a text array; ABN + banking for AP |
| `supplierInvoices` | `supplierId`, `storeId`, `invoiceNumber`, `invoiceDate`, `dueDate`, `amount`, `status`, `pdfUrl` | Status: PENDING / PAID / OVERDUE / QUARANTINE. Unique on `(supplierId, invoiceNumber)` |
| `supplierPayments` | `supplierId`, `invoiceId`, `paymentDate`, `amount`, `method` | Payment records per invoice |
| `quarantinedEmails` | `senderEmail`, `subject`, `hasAttachment`, `rawPayload` | Emails from non-whitelisted senders |

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
- **Copy previous week** to clone an existing roster week.
- **Publish roster**: marks a `(storeId, weekStart)` as published, making it visible to employees in the portal.
- Roster publication status shown in grid.

### 3.5 Timesheet Approvals (`/admin/timesheet-approvals`)
- Admin view of all `shiftTimesheets` submitted by employees via portal.
- Filter by store and date range.
- **Approve** individual submissions or **bulk approve** multiple.
- **Edit + Approve**: adjust the actual times before approval.
- Shows scheduled vs actual times; highlights discrepancies and unscheduled shifts.

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

### 3.7 Finance / Cash (`/admin/finance`, `/admin/cash`)
- **Inter-store transactions**: Convert (float transfer), Remittance (store → HO), Manual entry.
- Track cash and bank amounts separately per transaction.
- **Bank settlement** toggle per transaction.
- **Store balances** summary view (running cash/bank totals per store).
- **Daily Closings** (`/admin/cash`): admin enters EOD reconciliation figures per store per day.
- Cash sales detail breakdown: denomination counts × 11 denominations ($100 → 5¢).
- Bulk cash sales entry and legacy import.
- Void a day's cash records.

### 3.8 Accounts Payable Dashboard (`/admin/accounts-payable`)
- **Summary cards**: Total Invoices, Pending, Overdue, Paid (amounts).
- **Filter bar**: Status (All/Pending/Paid/Overdue/Quarantine), Supplier dropdown, Store dropdown.
- **Invoice table**: Supplier, Invoice #, Store, Issue Date, Due Date (overdue highlighted in red), Amount, Status badge.
- **Checkbox multi-select**: select one or more PENDING invoices.
- **Selected Total** display: live running total + count of selected invoices.
- **Bulk "Mark N as Paid"** action: sends parallel PATCH requests, refreshes list, clears selection.
- PDF icon link to original invoice file where available.

### 3.9 Supplier Management (`/admin/suppliers`)
- List all suppliers with ABN, whitelisted contact emails (shown as tags), BSB/account number.
- Add / Edit supplier with full AP fields: name, ABN, contact name, contact emails (comma-separated → stored as array), BSB, account number, notes, active toggle.
- Whitelisted emails drive the webhook routing logic (see §3.10).

### 3.10 Invoice Inbound Pipeline (Webhook / Cloudmailin)
- **Email flow**: Supplier sends invoice PDF to a dedicated email address → Gmail forwards to Cloudmailin → Cloudmailin POSTs multipart payload to `POST /api/webhooks/inbound-invoices`.
- **Sender extraction**: from `req.body.headers.from` only (`envelope.from` is skipped as it contains Gmail forwarding artifacts).
- **Routing logic**:
  1. Extract sender email from `From` header.
  2. Check against all `suppliers.contactEmails` arrays in DB.
  3. **Whitelisted**: proceed to PDF extraction + AI parsing.
  4. **Unknown sender**: save to `quarantined_emails` for manager review.
  5. **No attachment**: silently ignored.
- **PDF extraction**: attachment decoded from base64 (`content` field), written to `/tmp`, `pdftotext` CLI extracts text, temp file deleted.
- **AI parsing** (`server/invoiceParser.ts`):
  - System prompt instructs GPT-4o to return a **JSON array** of `ParsedInvoice` objects.
  - Each object: `{ invoiceNumber, invoiceDate, dueDate, amount, notes, storeCode }`.
  - `storeCode`: `"SUSHI"` (Olitin/Sushime), `"SANDWICH"` (Eatem Pty Ltd/Eatem Sandwich), or `"UNKNOWN"`.
  - Handles both **single invoices** and **statements** listing multiple invoices.
  - `max_tokens: 1000` to accommodate multiple invoice responses.
- **Webhook loop**: for each parsed invoice:
  - Resolve `storeCode` → actual `storeId` via store name matching.
  - Duplicate check: skip if `(supplierId, invoiceNumber)` already exists.
  - Insert new `supplierInvoice` record with `status: "PENDING"`.
- **Response**: `{ created: N, skipped: N }`.
- **Quarantine review**: `GET /api/webhooks/quarantined-emails` returns all quarantined emails for admin inspection.

### 3.11 Employee Portal (Mobile)
- **Login**: `/mobile/portal` — employee selects store, finds their name, enters PIN.
- **PIN login**: alternative numeric PIN entry.
- **Today view**: shows today's scheduled shift (from published roster), with clock-in/out via time logs.
- **Roster view**: `/mobile/roster` — weekly schedule view for the employee's store.
- **Timesheet submission**: `/mobile/portal` → submit actual start/end times for each shift day.
  - Unscheduled shifts (employee worked but not rostered) can also be submitted.
  - Submissions go to `shiftTimesheets` as PENDING for admin approval.
- **Daily Close Form**: `/mobile/daily-close` — employee submits EOD cash denomination count + receipt count.
  - Only visible to employees with `canSubmitCloseForm = true`.
- Session stored in localStorage as `ep_session_v4` (includes `selfieUrl` for avatar display).

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
| POST | `/api/admin/approvals/bulk-approve` | Bulk approve shift timesheets |

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
| GET | `/api/supplier-invoices` | List invoices (with supplier join) |
| POST | `/api/supplier-invoices` | Create invoice manually |
| PUT | `/api/supplier-invoices/:id` | Update invoice |
| GET | `/api/invoices` | AP dashboard invoices (enriched, filterable by status/supplierId/storeId) |
| PATCH | `/api/invoices/:id/status` | Update invoice status (e.g. PENDING → PAID) |
| GET | `/api/supplier-payments` | List payments |
| POST | `/api/supplier-payments` | Record payment |

### Webhooks & Email Inbound
| Method | Path | Description |
|---|---|---|
| POST | `/api/webhooks/inbound-invoices` | Cloudmailin inbound email handler |
| GET | `/api/webhooks/quarantined-emails` | List quarantined (unknown sender) emails |

### Employee Portal
| Method | Path | Description |
|---|---|---|
| POST | `/api/mobile/auth` | Validate employee by store + name |
| POST | `/api/portal/login` | Portal login (returns session) |
| POST | `/api/portal/login-pin` | Portal PIN login |
| GET | `/api/portal/employees` | Employees for a store (for login picker) |
| GET | `/api/portal/stores` | Active stores for portal |
| GET | `/api/portal/today` | Today's shift for employee |
| GET | `/api/portal/shift` | Current week shifts |
| GET | `/api/portal/week` | Published roster for week |
| GET | `/api/portal/timesheet` | Employee's timesheet submissions |
| POST | `/api/portal/timesheet` | Submit shift timesheet |
| POST | `/api/portal/unscheduled-timesheet` | Submit unscheduled shift |

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

### Phase 3: Communication & Mobile — Upcoming (Medium Priority)

- [ ] **Notice Board / Messaging:** In-app announcement system to replace external chat apps (LINE/WhatsApp). Admin creates notices with store targeting; employees see notices on portal home screen. Persist in DB with read receipts.

- [ ] **PWA / Mobile Optimization:** Convert Employee Portal to a Progressive Web App:
  - `manifest.json` for home-screen installation on iOS/Android.
  - Service worker for offline support (view last-fetched roster offline).
  - Push notifications for new roster publications and timesheet decisions.
