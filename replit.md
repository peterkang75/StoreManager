# Staff Manager - Multi-Store Business Management System

## Overview
A comprehensive full-stack web application for multi-store businesses to manage hiring, employee onboarding, rostering, time tracking, payroll, cash management, and supplier invoices. Features separate admin PC interface and mobile interface for on-site data entry.

## Tech Stack
- **Frontend**: React (Vite) with TypeScript, TailwindCSS, Shadcn UI components
- **Backend**: Node.js with Express
- **Database**: PostgreSQL (Drizzle ORM)
- **Routing**: Wouter for client-side routing
- **State Management**: TanStack Query for server state
- **File Uploads**: Multer for handling employee document uploads

## Application Structure

### Two Distinct UI Groups

#### Admin Web (`/admin/*`) - PC-first desktop interface
- `/admin` - Dashboard with stats and quick actions
- `/admin/stores` - Store management (CRUD)
- `/admin/candidates` - Candidate interview management with detail panels
- `/admin/employees` - Employee list with filters
- `/admin/employees/:id` - Employee detail/edit page
- `/admin/rosters` - Weekly roster management per store
- `/admin/timesheets` - Timesheet generation and approval
- `/admin/payrolls` - Payroll generation and editing
- `/admin/cash` - Daily closing records and cash sales details
- `/admin/suppliers` - Supplier management
- `/admin/suppliers/invoices` - Supplier invoice and payment management

#### Mobile Web (`/m/*`) - Smartphone-optimized interface  
- `/m/interview` - On-site candidate interview form
- `/m/onboarding/:token` - Employee onboarding form with file uploads
- `/m/roster` - View personal shifts for the week
- `/m/clock` - Clock in/out functionality
- `/m/daily-close` - Submit daily closing and cash count

### Data Models (shared/schema.ts)
- `stores` - Store locations
- `candidates` - Interview records
- `employees` - Employee records
- `employeeOnboardingTokens` - Secure onboarding links
- `employeeDocuments` - Document storage references
- `rosterPeriods` - Weekly roster periods per store
- `shifts` - Individual shift assignments
- `timeLogs` - Clock in/out records
- `timesheets` - Aggregated time records for payroll
- `payrolls` - Payroll calculations and adjustments
- `dailyClosings` - Daily sales closing records
- `cashSalesDetails` - Cash counting details
- `suppliers` - Supplier information
- `supplierInvoices` - Invoice records from suppliers
- `supplierPayments` - Payment records for invoices

### API Endpoints

#### Stores API
- `GET /api/stores` - List all stores
- `POST /api/stores` - Create store
- `PUT /api/stores/:id` - Update store

#### Candidates API
- `GET /api/candidates` - List all candidates
- `GET /api/candidates/:id` - Get candidate
- `POST /api/candidates` - Create interview entry
- `PUT /api/candidates/:id` - Update candidate
- `POST /api/candidates/:id/hire` - Mark as hired, generate onboarding token

#### Employees API
- `GET /api/employees` - List with filters (?store_id, ?status, ?keyword)
- `GET /api/employees/:id` - Get employee details
- `PUT /api/employees/:id` - Update employee

#### Roster API
- `GET /api/roster-periods` - List roster periods
- `POST /api/roster-periods` - Create roster period
- `GET /api/shifts` - List shifts (filter by period, employee, date range)
- `POST /api/shifts` - Create shift
- `DELETE /api/shifts/:id` - Delete shift

#### Time Tracking API
- `GET /api/time-logs` - List time logs with filters
- `POST /api/time-logs/clock-in` - Clock in
- `POST /api/time-logs/clock-out` - Clock out
- `GET /api/timesheets` - List timesheets
- `POST /api/timesheets/generate` - Generate timesheets from time logs
- `PUT /api/timesheets/:id/approve` - Approve timesheet
- `PUT /api/timesheets/:id/reject` - Reject timesheet

#### Payroll API
- `GET /api/payrolls` - List payroll records
- `POST /api/payrolls/generate` - Generate payrolls from approved timesheets
- `PUT /api/payrolls/:id` - Update payroll (adjustments, cash/bank split, etc.)

#### Cash Management API
- `GET /api/daily-closings` - List daily closing records
- `POST /api/daily-closings` - Create daily closing
- `GET /api/cash-sales` - List cash sales details
- `POST /api/cash-sales` - Create cash sales detail

#### Supplier API
- `GET /api/suppliers` - List suppliers
- `POST /api/suppliers` - Create supplier
- `PUT /api/suppliers/:id` - Update supplier
- `GET /api/supplier-invoices` - List invoices
- `POST /api/supplier-invoices` - Create invoice
- `GET /api/supplier-payments` - List payments
- `POST /api/supplier-payments` - Record payment

## Key Workflows

### Hiring Flow
1. Manager conducts interview using mobile form (`/m/interview`)
2. Admin reviews candidates and marks decision as "HIRE"
3. System generates secure onboarding link (14-day expiry)
4. Candidate completes onboarding form (`/m/onboarding/:token`)
5. Employee record created with uploaded documents

### Roster Management
1. Admin selects store and week
2. Creates roster period for the week
3. Adds shifts for employees with start/end times and roles
4. Employees view their shifts on mobile

### Time Tracking
1. Employees clock in/out via mobile app
2. Admin generates timesheets for a period
3. Admin reviews and approves/rejects timesheets
4. Approved timesheets feed into payroll

### Payroll Processing
1. Admin generates payrolls from approved timesheets
2. System calculates based on hours × rate
3. Admin can add adjustments (bonus, deductions)
4. Split amounts between cash and bank deposit

### Daily Closing
1. Staff submits daily closing via mobile with:
   - POS sales, delivery platform amounts
   - Float and credit amounts
   - Cash count (notes breakdown)
2. System calculates differences automatically
3. Admin reviews all closings in cash management

### Supplier Invoice Management
1. Admin creates supplier and records invoices
2. Records payments against invoices
3. System updates invoice status (UNPAID → PARTIAL → PAID)

## Development Notes
- Frontend port: 5000
- Uses PostgreSQL database
- Follows Material Design principles for business productivity
- Admin sidebar organized into: Hiring, Operations, Finance sections
