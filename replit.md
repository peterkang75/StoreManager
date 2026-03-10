# Staff Manager - Multi-Store Business Management System

## Overview
This project aims to develop an integrated staff management system for multi-store food and retail businesses based in Australia. It digitalizes the entire operational process, from recruitment and onboarding to work schedules, timekeeping, payroll, daily cash reconciliation, and supplier invoice management. Administrators will use a desktop interface, while on-site staff will utilize a mobile interface for tasks like interviews, clocking in/out, and daily closing procedures. The vision is to streamline operations, reduce manual errors, and provide real-time insights into store performance and staff management, enhancing efficiency and scalability for businesses.

## User Preferences
I prefer clear and concise communication. For coding tasks, I appreciate an iterative development approach where major changes are discussed before implementation. Please ensure that all new features or modifications align with the existing architectural patterns and coding conventions. Do not modify the `vite.ts`, `drizzle.config.ts`, and `package.json` files. For all other files, I want you to make necessary changes to implement the requested features.

## System Architecture
The system is built as a Single Page Application (SPA) using React 18 with Vite and TypeScript for the frontend, and Node.js with Express for the backend API. PostgreSQL, backed by Neon, serves as the primary database, with Drizzle ORM for type-safe query building.

### UI/UX Decisions
- **Admin Web (`/admin/*`)**: Designed for PC desktops, featuring a fixed left sidebar based on Shadcn UI, with three navigation sections (Hiring, Operations, Finance). The main content area has a `max-width 7xl` and `p-6` padding.
- **Mobile Web (`/m/*`)**: Optimized for smartphones, utilizing a `MobileLayout` with a simple header and back button. It features a `p-4` padded full-height layout, large touch targets, and single-column forms.
- **Component Library**: Shadcn UI with TailwindCSS is used for consistent and responsive UI components.
- **Icons**: `lucide-react` is used for all icons.

### Technical Implementations
- **Frontend**: React 18, Vite, TypeScript, Shadcn UI, TailwindCSS, Wouter for routing, TanStack Query v5 for server state management.
- **Backend**: Node.js, Express for REST API endpoints.
- **Database Interaction**: Drizzle ORM for database operations with Zod for schema validation.
- **File Uploads**: Multer is used for handling file uploads, storing them in the `/uploads` directory.
- **API Request Handling**: A centralized `apiRequest` function manages all HTTP requests, including JSON serialization, header settings, and error handling.
- **State Management**: Local component state is managed with `useState`, while server state is managed with `TanStack Query`.
- **Core Workflows**:
    - **Hiring Flow**: From mobile interview forms to admin review, token-based onboarding, and employee registration with document uploads.
    - **Work-to-Pay Flow**: Involves roster creation, mobile clock-in/out, timesheet generation and approval, leading to payroll calculation.
    - **Daily Close Flow**: Mobile submission of daily sales data and cash reconciliation, followed by admin review.
    - **Supplier Flow**: Registration of suppliers, invoice entry, and payment recording with automatic status updates.
    - **Finance / Cash Flow**: Inter-store cash exchanges (Convert), one-way remittance to HO, and manual income/expense entries with reference note tracking.

### Feature Specifications
- **Admin Pages (12)**: Dashboard, Stores, Candidates, Employees, EmployeeDetail, Rosters, Timesheets, Payrolls, Cash, Finance, Suppliers, SupplierInvoices.
- **Mobile Pages (6)**: Interview, Onboarding, Roster, Clock, DailyClose, DirectRegister.
- **Employee Management**: Comprehensive employee records, including personal, address, visa, employment, and payroll details.
- **Roster & Time Management**: Weekly roster creation, shift assignments, and accurate clock-in/out logging.
- **Payroll**: Two-column master-detail layout replacing the old wide spreadsheet grid. Left column (38%): searchable employee list with name/hours/total summary. Right column (62%): detail editing card with grouped sections (Basis: rate/fixed; Inputs: hours/adjustment/reason; Payment Split: gross/cash/tax editable; Results: calculated/total/super/bank read-only; Memo). Sticky footer bar shows running store grand totals. Arrow key navigation in employee list. Quick Convert is collapsible (default collapsed). All real-time calculations preserved (Gross/Cash reciprocal, PAYG tax via ATO Schedule 1 fortnightly coefficients, Super 11.5%, Bank Deposit). Supports fortnightly period auto-detection, bulk save, CSV/TSV employee import, persistent employee memos, and global store payroll notes.
- **Multi-Store Employees**: `employeeStoreAssignments` junction table is the sole source of truth for employee-store membership (employees.storeId is deprecated). Import de-duplicates by first+last name and creates per-store assignments with store-specific rate/fixedAmount. Payroll grid and latest-period endpoint use only `getEmployeesByStoreAssignment()`. Employee list shows all stores from the join table. Employee detail page uses a checkbox group for multi-store assignment (PUT /api/employees/:id/store-assignments syncs the join table). Payroll records include `storeId` to track which store a payroll entry belongs to.
- **Payroll Archive Import**: `POST /api/payrolls/import-archive` endpoint processes legacy TSV files (tab-separated). Resolves employees by nickname/firstName (case-insensitive), stores by name/code/alias. Parses DD/MM/YYYY dates to YYYY-MM-DD. Strips `$` and commas from numeric fields, rejects non-numeric tokens. Duplicate guard uses composite key (employeeId + storeId + periodStart + periodEnd + hours + rate + grossAmount + cashAmount) to allow legitimate split/adjustment rows while preventing exact re-imports.
- **Envelope Slip Consolidation**: `GET /api/payrolls/envelope-slips` groups all payroll records by employee for a given period, listing multi-store breakdowns and a grand total per employee for unified pay slips.
- **Pay Slip Printing**: `/admin/payslips?period_start=X&period_end=Y&store_id=Z` standalone print-optimized page. Black/white high-contrast layout with employee name (large bold, top-left), pay period (bold, top-right), table (Store, Hours, Gross, Adjustment, Reason, Cash Env, Bank Deposit), and a summary box (Total Cash for Envelope / Total Bank Transfer). Auto-triggers print dialog. Page-break-after per slip for A4 printing. Accessible via "Print Pay Slips" button on Payrolls page.
- **Store Aliases in Import**: TSV store names are resolved using aliases: "Eatem Sandwiches"→Sandwich, "Butcher Shop"→Meat, "Head Office"→HO, "Sushime"→Sushi, "Cafe"/"CK"→Trading.
- **Cash Sales Entry**: Integrated as first tab in Finance page (`/admin/finance`). Spreadsheet-like grid for bulk-inputting 2-week cash denomination counts per store, auto-calculates counted amounts from denominations $100-5c, shows discrepancy vs envelope amounts in red. Period navigation (prev/next) for loading history. Creates a CASH_SALES financial transaction on save. CASH_SALES detail modal accessible via eye icon in Recent Transactions. Component: `CashSalesEntry.tsx`. Standalone `/admin/cash-sales` route removed.
- **Cash Wage Auto-Deduction**: When payroll is saved via `/api/payrolls/bulk`, a `CASH_WAGE` financial transaction is automatically created (fromStoreId = store, cashAmount = total cash wages for the period). This deducts cash wages from the store's cash balance immediately. Re-saving the same store+period replaces the previous CASH_WAGE transaction (keyed by `referenceNote` pattern `CASH_WAGE:{storeId}:{periodStart}~{periodEnd}`). The Payrolls page "Cash Balance" in store totals now shows the actual balance (already reflecting the wage deduction) instead of computing a manual difference.
- **Financial Tracking**: Daily closing reports, detailed cash sales records, and supplier invoice/payment management.

## External Dependencies
- **Database**: PostgreSQL (Neon-backed)
- **Frontend Framework**: React 18
- **Build Tool**: Vite
- **Language**: TypeScript
- **UI Library**: Shadcn UI (with Radix primitives)
- **Styling**: TailwindCSS
- **Routing**: Wouter
- **Server State Management**: TanStack Query v5
- **Backend Framework**: Node.js, Express
- **ORM**: Drizzle ORM
- **Schema Validation**: Zod, drizzle-zod
- **File Upload Middleware**: Multer
- **Icons**: Lucide-react