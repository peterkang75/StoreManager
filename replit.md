# Staff Manager - Multi-Store Business Management System

## Overview
A full-stack web application for multi-store businesses to manage hiring, employee details, and internal workflows. This is Phase 1 of the system, structured for future expansion.

## Tech Stack
- **Frontend**: React (Vite) with TypeScript, TailwindCSS, Shadcn UI components
- **Backend**: Node.js with Express
- **Storage**: In-memory storage (MemStorage) - ready for database migration
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

#### Mobile Web (`/m/*`) - Smartphone-optimized interface  
- `/m/interview` - On-site candidate interview form
- `/m/onboarding/:token` - Employee onboarding form with file uploads

### Data Models (shared/schema.ts)
- `stores` - Store locations
- `candidates` - Interview records
- `employees` - Employee records
- `employeeOnboardingTokens` - Secure onboarding links
- `employeeDocuments` - Document storage references

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

#### Onboarding API
- `GET /api/onboarding/:token` - Validate token, get candidate data
- `POST /api/onboarding/:token` - Complete onboarding with file uploads

#### Employees API
- `GET /api/employees` - List with filters (?store_id, ?status, ?keyword)
- `GET /api/employees/:id` - Get employee details
- `PUT /api/employees/:id` - Update employee

## Key Workflows

### Hiring Flow
1. Manager conducts interview using mobile form (`/m/interview`)
2. Admin reviews candidates and marks decision as "HIRE"
3. System generates secure onboarding link (14-day expiry)
4. Candidate completes onboarding form (`/m/onboarding/:token`)
5. Employee record created with uploaded documents

### File Storage
- Uploads stored in `/uploads` directory
- Documents: selfie, passport cover, signature
- References stored in `employee_documents` table

## Future Phases (Planned)
- Roster management
- Time tracking / clock-in/out
- Payroll calculation
- Cash sales tracking
- Supplier invoice management

## Development Notes
- Frontend port: 5000
- Uses in-memory storage for development
- Ready for PostgreSQL migration
- Follows Material Design principles for business productivity
