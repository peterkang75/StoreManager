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

### Feature Specifications
- **Admin Pages (11)**: Dashboard, Stores, Candidates, Employees, EmployeeDetail, Rosters, Timesheets, Payrolls, Cash, Suppliers, SupplierInvoices.
- **Mobile Pages (5)**: Interview, Onboarding, Roster, Clock, DailyClose.
- **Employee Management**: Comprehensive employee records, including personal, address, visa, employment, and payroll details.
- **Roster & Time Management**: Weekly roster creation, shift assignments, and accurate clock-in/out logging.
- **Payroll**: Automated payroll calculation based on approved timesheets, with adjustments and split payments (cash/bank).
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