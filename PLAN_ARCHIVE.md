# MultiStoreManager — Completed Implementation Archive

> Completed implementation details archived from PLAN.md to reduce context size.
> Last archived: 2026-05-05. Do not edit active features here — only PLAN.md is the source of truth for live code.

---

## Sections 3.10–3.25: Completed Modules

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

## Section 6.1: Completed Phases — Detailed Breakdowns

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

## Sections 3.1–3.9: Core Implemented Modules

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
- **Standalone Add Shift button:** A global "Add Shift" button added to the Pending Approvals page header. Opens a modal that allows adding a shift for ANY employee — including INACTIVE employees and free-text names for one-off workers. Employee search covers all statuses.
- **Mark Absent**: reject/tombstone a shift so Auto-Fill won't recreate it (`PUT /api/admin/approvals/:id/reject`).
- **Bulk Revert**: revert all APPROVED timesheets for an employee back to PENDING (`POST /api/admin/approvals/bulk-revert`).
- **Responsive layout**: desktop shows employee table → click to open detail modal; mobile shows employee summary cards → tap to open bottom-sheet review modal.

### 3.5a Admin Timesheets History (`/admin/timesheets`)
- Separate read-only view showing **all approved timesheets** (APPROVED status only) across all stores, navigable by payroll cycle.
- Grouped by employee; shows scheduled vs actual hours, discrepancy delta, store name.
- **Revert to Pending**: individual approved shifts can be reverted back to PENDING from this page.
- Payroll cycle navigator (14-day periods); store filter.
- Shows payroll lock status.

### 3.6 Payroll (`/admin/payrolls`, `/admin/weekly-payroll`)
- **Generate payroll** for a period: pulls approved timesheets, calculates pay from hours × rate (or fixed amount) per employee.
- **ATO Schedule 1 FY2025-26** tax withholding calculation built in.
- Superannuation (11.5%) calculated automatically.
- Split payroll into **cash** and **bank deposit** amounts. Adjustment field (bonus/deduction) with reason.
- Mark bank transfer done with date stamp. **Pay slips** printable view per employee per period.
- **Draft Persistence & Ghost Prevention:** Payroll inputs saved to `sessionStorage` per store and period. Once saved to DB, draft is purged.
- **Intercompany Transfers:** Fixed-salary employee working at another store → Store B accrues debt to Store A. **Dual Role Exception**: if employee earns a direct hourly rate at Store B, the zero-override is bypassed.
- **Unified Bank Transfer Tracker:** Combines direct employee bank deposits + intercompany settlements into a single actionable list.
- **Fixed Fortnightly Pay Cycle (anchored):** `PAY_CYCLE_ANCHOR = new Date(2026, 2, 23)` (Monday March 23, 2026). `cycleIndex = floor(daysSinceAnchor / 14)`. Never drifts.
- **Period Persistence Across HMR / Reload:** Selected pay period mirrored to `sessionStorage` under `PERIOD_SS_KEY`. Restored only if `start` aligns with fixed-cycle grid.
- **Local-midnight date parsing:** All date math parses `YYYY-MM-DD` via `new Date(dateStr + "T00:00:00")`.
- **Draft Cash Balance (Real-time):** Top CashBalances widget shows "Draft: $X" line while editing payroll.

### 3.7 Finance / Cash (`/admin/finance`, `/admin/cash`)
- **Inter-store transactions**: Convert (float transfer), Remittance (store → HO), Manual entry.
- Track cash and bank amounts separately per transaction. **Bank settlement** toggle per transaction.
- **Store balances** summary view (running cash/bank totals per store).
- **Daily Closings** (`/admin/cash`): admin enters EOD reconciliation figures per store per day.
- Cash sales detail breakdown: denomination counts × 11 denominations ($100 → 5¢). Bulk cash sales entry and legacy import. Void a day's cash records.
- **Real-time Global Cash Widget:** Displays actual DB Cash Balance only. Does NOT subtract active payroll drafts.
- **Manual Cash Adjustment & Audit Trail:** Managers can record Cash In/Out with specific categories (Petty Cash, Till Shortage, Owner Deposit) — creates a permanent audit trail.

### 3.8 Accounts Payable Dashboard (`/admin/accounts-payable`)
- **Summary cards**: Total Payable + Selected Total (live sum of selected invoices). Overdue in red.
- **View Tabs**: `To Pay` (PENDING + OVERDUE) | `Paid History` (PAID, sorted by updatedAt desc).
- **Store Toggle Buttons**: All Stores | Sushi | Sandwich | Holdings | PYC.
- **To Pay view**: invoices grouped by supplier in collapsible Accordion cards (all open by default). Overdue rows sorted to top.
- **Paid History view**: grouped by payment date, then by supplier within each date group.
- **Bulk Pay**: parallel PATCH `/api/invoices/:id/status` → `{ status: "PAID" }`.
- **Add Invoice** (`+ Add Invoice` button): `AddInvoiceModal` with AI Scan tab (GPT-4o Vision / PDF) and Manual Entry tab.

### 3.9 Supplier Management (`/admin/suppliers`)
- List all suppliers with ABN, whitelisted contact emails (shown as tags), BSB/account number.
- Add / Edit supplier with full AP fields: name, ABN, contact name, contact emails (comma-separated → stored as array), BSB, account number, notes, active toggle.
- Whitelisted emails drive the webhook routing logic (see §3.10).

---

## Section 4: API Endpoints

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
| GET | `/api/rosters/week-caps` | Season + resolved hour caps + usage/breaches for a store+week (roster cap enforcement) |
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
| PUT | `/api/shift-presets/:storeId` | Upsert fixed preset for a store |
| GET | `/api/preset-buttons` | List custom quick-fill buttons (filter by ?storeId=) |
| POST | `/api/preset-buttons` | Create a new custom quick-fill button |
| PUT | `/api/preset-buttons/:id` | Update a custom quick-fill button |
| DELETE | `/api/preset-buttons/:id` | Delete a custom quick-fill button |
| GET | `/api/store-config/trading-hours` | Get trading hours for a store (?storeId=) |
| PUT | `/api/store-config/trading-hours` | Upsert one day's trading hours for a store |
| GET | `/api/store-config/school-holidays` | List all school holiday periods |
| POST | `/api/store-config/school-holidays` | Create school holiday period |
| POST | `/api/store-config/school-holidays/load-nsw` | Bulk-load bundled NSW holiday dataset (idempotent, ADMIN) |
| PUT | `/api/store-config/school-holidays/:id` | Update school holiday period |
| DELETE | `/api/store-config/school-holidays/:id` | Delete school holiday period |
| GET | `/api/store-config/public-holidays` | List all public holidays |
| POST | `/api/store-config/public-holidays` | Create public holiday |
| PUT | `/api/store-config/public-holidays/:id` | Update public holiday |
| DELETE | `/api/store-config/public-holidays/:id` | Delete public holiday |
| GET | `/api/store-config/recommended-hours` | List recommended weekly hours for all stores (LEGACY advisory) |
| PUT | `/api/store-config/recommended-hours` | Upsert recommended hours for a store (LEGACY advisory) |
| GET | `/api/store-config/hour-caps` | List enforced per-store/season roster hour caps |
| PUT | `/api/store-config/hour-caps` | Upsert a store+season hour cap (validates sat+sun+ph ≤ weekly) |
| GET | `/api/automation-rules` | All rules enriched with employeeName + storeName |
| POST | `/api/automation-rules` | Create rule |
| GET | `/api/automation-rules/due-today` | Active rules due today (Sydney TZ) |
| PUT | `/api/automation-rules/:id` | Update rule (partial) |
| DELETE | `/api/automation-rules/:id` | Delete rule |
| POST | `/api/automation-rules/:id/execute` | Execute rule |

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
| PUT | `/api/admin/approvals/:id/reject` | Reject / Mark Absent |
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
| PATCH | `/api/supplier-invoices/:id/soft-delete` | Soft-delete invoice |
| PATCH | `/api/supplier-invoices/:id/restore` | Restore from Trash |
| PATCH | `/api/supplier-invoices/:id/reassign` | Change supplier on invoice |
| POST | `/api/supplier-invoices/:id/reparse-pdf` | Re-run AI parse on stored PDF |
| DELETE | `/api/supplier-invoices/:id` | Permanently delete invoice |
| GET | `/api/supplier-invoices/:id/pdf` | Stream PDF file for viewing |
| GET | `/api/invoices` | AP dashboard invoices (enriched, filterable) |
| PATCH | `/api/invoices/:id/status` | Update invoice status |
| POST | `/api/invoices/:id/revert` | Revert PAID invoice back to PENDING |
| GET | `/api/invoices/review` | List all REVIEW-status invoices |
| POST | `/api/invoices/review/approve-group` | Create supplier + sweep REVIEW → PENDING |
| POST | `/api/invoices/parse-upload` | Parse uploaded file (image/PDF) via AI |
| POST | `/api/invoices/bulk-reclassify` | Re-run parser + 4-way classifier on REVIEW/QUARANTINE rows |
| POST | `/api/invoices/backfill-from-inbox` | Walk legacy universal_inbox rows, recover orphan REVIEW invoices |
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

### Rejected Emails
| Method | Path | Description |
|---|---|---|
| GET | `/api/rejected-emails` | List rejected emails |
| POST | `/api/rejected-emails/:id/promote` | Promote: append sender to supplier's contactEmails |
| DELETE | `/api/rejected-emails/:id` | Permanently delete a rejected email row |

### Webhooks & Email Inbound
| Method | Path | Description |
|---|---|---|
| POST | `/api/webhooks/inbound-invoices` | Cloudmailin inbound email handler |
| GET | `/api/webhooks/quarantined-emails` | List quarantined emails |

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
| PATCH | `/api/todos/:id` | Update todo |
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
| GET | `/api/dashboard/summary` | Summary: payroll totals, sales, cash balances. Labor date filter uses `periodStart > endDate`. |

### Shopping List
| Method | Path | Description |
|---|---|---|
| GET | `/api/shopping/items` | Get item catalogue for a store |
| POST | `/api/shopping/items` | Add item to catalogue |
| GET | `/api/shopping/active` | Get active shopping list for a store |
| POST | `/api/shopping/active` | Add item to active list |
| DELETE | `/api/shopping/active/:id` | Remove item from active list |
| DELETE | `/api/shopping/active` | Clear entire active list for a store |

### Storage
| Method | Path | Description |
|---|---|---|
| GET | `/api/storage/items` | List storage item catalogue (filter by ?storeId=) |
| POST | `/api/storage/items` | Create storage item |
| PATCH | `/api/storage/items/:id` | Update storage item fields |
| DELETE | `/api/storage/items/:id` | Delete storage item |
| PATCH | `/api/storage/items/:id/stock` | Update stock count |
| GET | `/api/storage/active` | Get active fetch list (filter by ?storeId=) |
| POST | `/api/storage/active` | Add item to active fetch list |
| DELETE | `/api/storage/active/:id` | Remove single item from fetch list |
| DELETE | `/api/storage/active` | Clear entire fetch list for a store |
| GET | `/api/storage/units` | List all units |
| POST | `/api/storage/units` | Create new unit |
| DELETE | `/api/storage/units/:id` | Delete unit |

### Intercompany Settlements
| Method | Path | Description |
|---|---|---|
| PATCH | `/api/settlements/:id/settle` | Mark settlement as settled |
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
| POST | `/api/portal/login-pin` | Portal PIN login |
| POST | `/api/portal/change-pin` | Employee changes their own PIN |
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

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Admin login (email + password) |
| POST | `/api/auth/logout` | Admin logout |
| GET | `/api/auth/me` | Get current admin session |
| POST | `/api/auth/change-password` | Change admin password |

### Misc
| Method | Path | Description |
|---|---|---|
| POST | `/api/upload` | General file upload (returns URL) |

---

## Section 6.0: Resolved Bugs

### [x] Payroll: 신규 Approve된 shift Hours 0 표시 버그 (2026-04-21 해결)
- **증상**: Pending Approval에서 shift Approve 후 Payroll 화면에서 Hours가 0으로 유지.
- **근본 원인**: `client/src/pages/admin/Payrolls.tsx` draft hydration 로직이 `if (!merged[employee.id])` 패턴으로 작동 — sessionStorage draft가 있으면 재계산 스킵. approve 전에 저장된 `hours:0` draft가 이후 승인 데이터를 덮어씀.
- **수정**: `mergeDraftOverManagerInputs()` 헬퍼 추가. API 출처 필드(hours, rate, fixedAmount)는 항상 최신 데이터로 재계산. 매니저 타이핑 필드(adjustment, memo, tax override)만 sessionStorage에서 보존 후 `recalcRow` 재실행.

### [x] Admin/non-portal API routes not authenticated (2026-04-30 해결 — Phase B)
- **Phase 0**: 모바일 portal 라우트만 Bearer 토큰 게이트.
- **임시방편**: URL 노출 사고로 사이트 전체 HTTP Basic Auth 임시 적용.
- **Phase B 정공법 완료**:
  - Schema: employees에 `password_hash` + `last_login_at`, portal_sessions에 `login_type`.
  - Storage: `findEmployeeByEmail`, `setEmployeePassword`, `verifyEmployeePassword`, `getEmployeeAllowedStoreIds`, `getRoleAllowedRoutes`, `deleteAllSessionsForEmployee`.
  - Middleware (`server/middleware/auth.ts`): `requireAuth`, `requireRole`, `requirePermission` (4-tier), `validateStoreScope`.
  - Routes: `POST /api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/change-password`.
  - Frontend: `Login.tsx`, `AuthContext.tsx`, `RequireAuth.tsx`, Bearer 자동 주입.
  - **커밋**: d6534c6 → d0440de → 1d452f5 + f6cc011 + ed1b022 → efd82c9 → a62af61 + 7028c79 → 1288677.
- **Phase B.1 남은 follow-up**: 매니저 매장 스코핑, 직원 PII 추가 마스킹, PIN brute-force rate-limit 강화, 비번 리셋 UI.

### [x] Statement vs Invoice reconciliation stability (2026-04-23 해결 — §3.22)
- **조치**: 화이트리스트 전용 파이프라인 + 4-way classifier(INVOICE/STATEMENT/REMITTANCE/OTHER). Statement은 per-row PENDING으로 확장. `post.xero.com` Xero 송신자 해석 버그 수정.
- **Stuck-invoice 회복**: `POST /api/invoices/bulk-reclassify` + `POST /api/invoices/backfill-from-inbox`로 74건 대다수 PENDING 승격.
- **남은 v2 과제**: fuzzy-dedup 규칙, reconciliation 리포트.

---

## Section 7.1–7.4: Xero Initiative — Background & Decisions

### 7.1 배경 및 동기 (Origin)

**최초 사용자 요청 (verbatim, 2026-05-05):**
> "우리사이트에 있는 Payroll 기능을 Xero 와 연동해서 작업이 가능할까? 예를들어 Cash 부분을 제외하고 Bank deposit 액수는 그대로 제로에 Single Touch Payroll 기능을 사용해서 입력하고, superannuation 페이하고 하는 반복작업들을 하는데, 그걸 더 쉽게 할수있는 방법이 있을까"

**스코프 확장 이유:**
1. Crew의 `cashAmount`, AP 데이터가 절세·BAS에 활용되지 않음
2. AP 인보이스에 GST 분리 없어 회계사가 매번 수동 분리
3. 운영 P&L (실시간 수익) 화면 없음
4. "Pay Run 푸시"만 하면 회계사 비용 절감 불충분 — COGS·Cash Expense까지 함께 처리해야 함

**통합 비전:** Crew = 운영용, Xero = 회계신고용. 두 시스템이 같은 데이터를 이중 저장하지 않음.

### 7.2 핵심 분담 원칙

회계사에게 남기는 3가지: **조정** (감가상각, accruals) / **검토** (선택적) / **신고** (BAS, EOFY, Income Tax — 전문 자격 필요)

### 7.3 확정 결정 사항 (D1~D21, 2026-05-05)

| # | 결정 | 근거 |
|---|---|---|
| D1 | `cashAmount`는 STP 보고 X | 별도 현금 지출 |
| D2 | Pay Run 푸시는 `bankDepositAmount > 0` 행만 | 사용자 명시 |
| D3 | 매장별 별도 ABN/Xero 조직 | 사용자 명시 |
| D4 | Xero 구독에 AU Payroll 모듈 포함 | 사용자 확인 |
| D5 | Phase 1: Draft Pay Run까지만 (Post/Auto Super는 사장이 Xero에서) | 안전 마진 |
| D6 | Daily Sales는 Xero 푸시 X — bank feed가 정답 | 직원 입력 오차 방지 |
| D7 | Cash Expense도 Xero 직접 푸시 X (Phase 1) | Crew=운영/Xero=신고 원칙 |
| D8 | 영수증 사진 강제 X — 측정만 | 직원 부담 vs 데이터 가치 |
| D9 | GST 비율은 supplier 단위 수동 1회 설정 | 사용자 명시 |
| D10 | GST 비율 변경 시 과거 데이터 안 바뀜 | BAS 무결성 |
| D11 | Vendor/Supplier 글로벌 풀 (매장별 오버라이드 X) | 사용자 명시 |
| D12 | Cash expense 입력은 Daily Close form 안에 통합 | 사용자 명시 |
| D13 | 직원 입력 시 vendor는 select-only | 오타 방지 |
| D14 | "Other"/신규 vendor → 직원 메모 → 사장 검토 시 GST 비율 설정 | 사용자 명시 |
| D15 | BAS 작업은 회계사 유지 (Phase 1 자동화 X) | 사용자 명시 |
| D16 | 분기 BAS Export는 PDF 우선 | 사용자 명시 |
| D17 | Petty Cash 잔액 조정은 분기 BAS 시점 회계사 1회 처리 | 운영 단순성 |
| D18 | 운영 P&L은 기존 Dashboard 그래프 활용 | 사용자 명시 |
| D19 | 운영 P&L 기간 단위: 주간/월간/분기 토글 | 사용자 명시 |
| D20 | 출시 전략: Wave 1 → 2 → 3 순차 | 사용자 명시 |
| D21 | Phase 2+에 보류: 자동 Post, OCR, Cash Expense 푸시, COGS 푸시, Bank Rules API | – |

#### STP 필수 누락 데이터 (Wave 3 전 employees 테이블에 추가 필요)
- `employmentStartDate`, `superFundAbnOrUsi`, `residencyStatus`, `tfnDeclarationStatus`, `helpStslDebt`

### 7.4 Wave 구성 및 출시 전략

| Wave | 묶음 | 작업량 |
|---|---|---|
| Wave 1 | Supplier GST + Cash Expense 시스템 (D9~D14) | ~6일 |
| Wave 2 | 운영 P&L Dashboard (D18, D19) | ~3일 |
| Wave 3 | Xero OAuth + Pay Run 푸시 + BAS Export (D1~D5, D16) | ~8일 |

원칙: Wave N 완료 후 1~2주 운영 검증 후 Wave N+1 시작.

---

## Section 7.8–7.11: Xero Phase 2+ Backlog & Operational Notes

### 7.8 Phase 2+ Backlog (Wave 3 완료 후 우선순위 평가)

#### 7.8.1 자동 Post Pay Run + Auto Super
- Prereq: Wave 3 안정 3개월 이상 운영

#### 7.8.2 영수증 OCR (Cash Expense)
- Claude Vision으로 금액/공급자 추출 → 직원 입력값 검증
- 인식률: 펼친 영수증 90~95% / 살짝 구겨짐 70~85% / 심하게 구겨짐 30~60%
- 권장: OCR 결과 자동 입력 X, 사장 검토 시 표시 → 판단

#### 7.8.3 Cash Expense를 Xero에 직접 푸시 (Spend Money)
- 옵션 A: vendor별 분기 1건 Spend Money / 옵션 B: Manual Journal 1건

#### 7.8.4 COGS 인보이스 Xero 직접 푸시
- AP 모듈 `supplier_invoices` 결제 시 Xero에 Bill 생성

#### 7.8.5 Bank Rules API 자동 셋업
- Xero API의 BankRule CRUD 지원 여부 확인 필요

#### 7.8.6 Daily Sales Xero 자동 푸시
- **현재 결정: 하지 않음** (D6) — bank feed가 정답. 사장이 명시적으로 요청할 때만 재논의.

### 7.9 운영 패턴 권장 (코드 변경 아님)

- **영수증 봉투 패턴**: 매장에 일자별 봉투 두기 → 직원 종이 영수증 보관 → 사장 주말 일괄 촬영
- **비즈니스 데빗카드**: 장기 권장 (현재 카드 분실 위험으로 미사용). Wave 3 후 재검토.
- **ATO 컴플라이언스**: $82.50 이상 매입은 tax invoice 필요. 현재 영수증 없이 bank reconcile만 처리 중 — ATO audit 시 잠재 리스크 (사장 인지, 의식적 선택).

### 7.10 사장 vs 회계사 최종 분담표 (Wave 3 완료 시 목표)

| 영역 | Crew가 자동 | 사장 1-click | 회계사 |
|---|:---:|:---:|:---:|
| 시간/근태/로스터·Payroll 계산·Pay slip | ✅ | – | – |
| Pay Run 작성 | ✅ Crew→Xero | Push to Xero | – |
| STP 제출(ATO)·Super·EOFY Finalisation | – | ✅ Xero | – |
| 매출 집계·운영 P&L·현금 지출 기록 | ✅ | – | – |
| Bank reconciliation | – | ✅ Xero | – or 검토 |
| BAS 작성·제출 | – | – | ✅ |
| 감가상각·accruals·소득세·FBT·EOFY 결산 | – | – | ✅ |

예상 절감: 회계사 시간 연 8~12h → 2~4h → **연 $1,500~$2,500 절감**.

### 7.11 PLAN.md 업데이트 규칙 (Wave 완료 시)

- **Wave 1 완료 시**: §2.5 `suppliers`에 `defaultGstRate` 추가, §2.4/§2.8에 `cash_expenses` 테이블, §3.x에 Cash Expense 모듈, §4에 신규 endpoint, §7.5에 ✅ COMPLETE 마킹
- **Wave 2 완료 시**: §3.x에 P&L 모듈, §4 Dashboard에 `/api/operational-pnl`, §6.2.1 ✅ 마킹
- **Wave 3 완료 시**: §2에 4개 테이블(xero_connections, xero_oauth_states, employee_xero_links, xero_pay_runs), §2.2 employees에 5개 STP 필드, §2.5 supplier_invoices에 `gstAmount`/`gstRateSnapshot`, §3.x·§4·§5에 Xero Integration 내용

---

## Section 7.5.1–7.5.4: Wave 1 DB/Storage/API 구현 스펙 (Day 1~2 완료)

> Wave 1 Day 1~2 커밋으로 이미 구현됨. 코드가 진실의 소스 — 이 스펙은 참고용.

### DB 마이그레이션 (`server/bootstrap-migrations.ts`)

```sql
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS default_gst_rate INTEGER NOT NULL DEFAULT 0;
-- 0=GST 없음, 50=혼합(Woolworths 등), 100=전액 GST

CREATE TABLE IF NOT EXISTS cash_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id),
  amount NUMERIC(10,2) NOT NULL,
  gst_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  gst_rate_snapshot INTEGER NOT NULL DEFAULT 0,
  expense_date DATE NOT NULL,
  memo TEXT,
  entered_by UUID NOT NULL REFERENCES users(id),
  review_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_store_date
  ON cash_expenses(store_id, expense_date DESC);
```

**핵심 설계 (D10):** GST는 입력 시점 `gst_rate_snapshot` + `gst_amount`로 freeze — supplier rate 변경이 과거 레코드에 영향 없음.

### Schema (`shared/schema.ts`)
- `suppliers`에 `defaultGstRate: integer("default_gst_rate").notNull().default(0)` 추가
- `cashExpenses` 테이블 정의 + `insertCashExpenseSchema` / `selectCashExpenseSchema` Zod 스키마

### Storage (`server/storage.ts`)
- `createCashExpense`, `listCashExpenses({ storeId, from, to })`, `updateCashExpense`, `deleteCashExpense`, `getCashExpenseSummary` (total, gstTotal, byVendor, pendingCount)

### API Endpoints
| Method | Path | 설명 |
|---|---|---|
| `PATCH /api/suppliers/:id` | 기존 확장 — `defaultGstRate` (0~100) |
| `POST /api/cash-expenses` | 직원 입력 |
| `GET /api/cash-expenses` | storeId/from/to 필터 |
| `GET /api/cash-expenses/summary` | 사장 검토용 합계 + vendor 그룹 |
| `PATCH /api/cash-expenses/:id` | 수정 + review_status 변경 |
| `DELETE /api/cash-expenses/:id` | 삭제 |

---

## Section 7.7: Wave 3 — Xero Pay Run 푸시 + BAS Export (상세 구현)

**범위:** 매장별 Xero OAuth + Employee 매핑 + STP 데이터 보완 + Pay Run Draft 푸시 + BAS Export PDF
**기간:** ~8일 | **위험도:** 중 (OAuth + STP 컴플라이언스) | **의존성:** Wave 1 완료

### NPM 패키지
- `xero-node` (공식 SDK)

### 환경 변수 (Railway)
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`
- `XERO_REDIRECT_URI` = `https://<railway-host>/api/xero/oauth-callback`
- `XERO_TOKEN_ENCRYPTION_KEY` (AES-256-GCM, refresh token 암호화)

### DB 마이그레이션

```sql
CREATE TABLE IF NOT EXISTS xero_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL UNIQUE REFERENCES stores(id),
  xero_tenant_id TEXT NOT NULL,
  xero_tenant_name TEXT,
  status TEXT NOT NULL DEFAULT 'CONNECTED', -- CONNECTED | NEEDS_REAUTH | ERROR | DISCONNECTED
  refresh_token_enc TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TIMESTAMP,
  scopes TEXT,
  pay_calendar_id TEXT, pay_calendar_name TEXT, pay_calendar_start_date DATE,
  default_hourly_earnings_rate_id TEXT, default_super_fund_id TEXT,
  last_error TEXT, last_connected_at TIMESTAMP, last_synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS xero_oauth_states (
  state TEXT PRIMARY KEY,
  store_id UUID NOT NULL REFERENCES stores(id),
  code_verifier TEXT NOT NULL, csrf_nonce TEXT NOT NULL, return_to TEXT,
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_xero_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  xero_tenant_id TEXT NOT NULL, xero_employee_id TEXT NOT NULL,
  matched_by TEXT NOT NULL, -- EMAIL_AUTO | MANUAL | CREATED
  created_at TIMESTAMP NOT NULL DEFAULT now(), updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(employee_id, xero_tenant_id)
);

CREATE TABLE IF NOT EXISTS xero_pay_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  period_start DATE NOT NULL, period_end DATE NOT NULL,
  xero_pay_run_id TEXT, xero_pay_run_status TEXT,
  pushed_at TIMESTAMP NOT NULL DEFAULT now(), pushed_by UUID REFERENCES users(id),
  payload_summary JSONB, delta_vs_xero JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employment_start_date DATE,
  ADD COLUMN IF NOT EXISTS super_fund_abn_or_usi TEXT,
  ADD COLUMN IF NOT EXISTS residency_status TEXT,
  ADD COLUMN IF NOT EXISTS tfn_declaration_status BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS help_stsl_debt BOOLEAN DEFAULT false;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS gst_rate_snapshot INTEGER;
```

### 폴더 구조

```
server/integrations/xero/
├── crypto.ts       # AES-256-GCM 토큰 암복호화
├── tokens.ts       # getValidAccessToken(storeId), refresh-token rotation, per-store mutex
├── oauth.ts        # PKCE-S256 authorize URL, code 교환, refresh
├── client.ts       # XeroClient + payrollAUApi 팩토리
├── service.ts      # list calendars/rates/super funds/employees, autoMatchByEmail, pushDraftPayRun
├── payslipBuilder.ts  # 순수 함수: (payrollRows, links, mapping) → earningsLines
├── errors.ts       # XeroAuthError / XeroValidationError / MappingMissingError / XeroRejection
├── routes.ts       # Express 라우터, registerXeroRoutes(app) export
├── basExport.ts    # 분기 BAS PDF 생성
└── invoiceZip.ts   # 인보이스 PDF zip 생성
```

### API Endpoints
| Method | Path | 설명 |
|---|---|---|
| GET | `/api/xero/auth?storeId=X` | OAuth 시작 |
| GET | `/api/xero/oauth-callback` | OAuth code 교환 → refresh token 저장 |
| GET | `/api/xero/connections` | 매장별 연결 상태 |
| DELETE | `/api/xero/connections/:storeId` | 연결 끊기 |
| GET | `/api/xero/setup/:storeId` | pay calendar/earnings rate/super fund 옵션 |
| POST | `/api/xero/setup/:storeId` | 셋업 저장 |
| GET | `/api/xero/employees/:storeId` | Xero 직원 list (매핑 UI) |
| POST | `/api/xero/employees/match/:storeId` | 자동 매칭 (이메일 기반) |
| PATCH | `/api/xero/employees/link/:linkId` | 수동 매핑 수정 |
| POST | `/api/xero/pay-runs/draft/:storeId` | Pay Run Draft 푸시 |
| GET | `/api/xero/pay-runs/:storeId` | 푸시 기록 list |
| POST | `/api/xero/pay-runs/:id/refresh-status` | Xero status 갱신 |
| GET | `/api/bas-export/:storeId` | 분기 BAS Export PDF 다운로드 |

### Frontend 컴포넌트
```
client/src/pages/admin/IntegrationsXero.tsx
client/src/components/admin/XeroConnectionCard.tsx
client/src/components/admin/XeroSetupWizard.tsx
client/src/components/admin/XeroEmployeeLinkPanel.tsx
client/src/components/admin/PushToXeroDialog.tsx
client/src/components/admin/BasExportPanel.tsx
client/src/lib/xeroApi.ts
```

### Pay Run 푸시 흐름 (D2, D5)
1. 사장이 Payroll 화면에서 fortnight period 확정
2. "Push to Xero" → `PushToXeroDialog`
3. Dialog: 매장 선택, 푸시 대상(`bankDepositAmount > 0`만), cash-only 직원 제외 명시, STP 누락 시 차단
4. 사장 확인 → `POST /api/xero/pay-runs/draft/:storeId`
5. 서버: `payslipBuilder` → Xero Pay Run 생성 → `xero_pay_runs` 기록
6. 응답: 성공 수, 실패 목록, Xero 재계산 delta
7. 사장이 Xero에서 검토 → Post(STP 자동 ATO 제출) → Auto Super 1-click

### BAS Export (D16) — 분기 PDF 패키지
Summary.pdf (매출/COGS/Cash Expenses/Payroll 합계 + GST 분리) + Invoices/ ZIP

### 작업 순서 (8일)
| Day | 작업 |
|---|---|
| 1 | xero-node + 환경변수 + crypto.ts + tokens.ts |
| 2 | OAuth 라우트 + xero_connections/states 테이블 + IntegrationsXero 페이지 |
| 3 | Xero setup wizard (pay calendar/earnings rate/super fund) |
| 4 | STP 필수 데이터 폼 (employees 5개 필드) |
| 5 | Employee 매핑 (자동+수동) + employee_xero_links |
| 6 | Pay Run 푸시 service + payslipBuilder + PushToXeroDialog + xero_pay_runs |
| 7 | 분기 BAS Export PDF + invoice ZIP + BasExportPanel |
| 8 | end-to-end 테스트 + 사장 시범 + 버그 fix |

### 위험 관리
- **OAuth refresh 동시성:** per-store mutex (tokens.ts)
- **Refresh token rotation:** Xero 발급 즉시 DB 업데이트 (트랜잭션 안)
- **Token 암호화:** AES-256-GCM, key 분실 시 전 매장 재인증
- **STP 컴플라이언스:** Phase 1은 Draft만 — 사장이 Xero에서 Post. 자동 Post는 Phase 2+
- **Delta 처리:** Xero 재계산 후 Crew `bankDepositAmount`와 차이 → UI Δ 표시 + 사장 검토 후 Post

