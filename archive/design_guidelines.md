# Design Guidelines: Multi-Store Staff Management System

## Design Approach

**Selected System:** Material Design principles adapted for business productivity
**Rationale:** Information-dense internal tool requiring clear data hierarchy, strong form patterns, and table layouts. Two distinct interface modes require consistent component logic with divergent layout strategies.

---

## Typography System

**Font Stack:** Inter (primary), system-ui fallback
- **Headings:** 
  - H1: 2rem/32px, font-weight-700 (page titles)
  - H2: 1.5rem/24px, font-weight-600 (section headers)
  - H3: 1.25rem/20px, font-weight-600 (card/panel titles)
- **Body:** 0.875rem/14px, font-weight-400 (table text, form labels)
- **UI Labels:** 0.75rem/12px, font-weight-500, uppercase tracking-wide (column headers, badges)
- **Buttons:** 0.875rem/14px, font-weight-500

---

## Layout System

**Spacing Primitives:** Tailwind units of **2, 4, 6, 8, 12, 16**
- Tight spacing: p-2, gap-2 (within form groups)
- Standard spacing: p-4, gap-4 (card padding, form field spacing)
- Section spacing: p-6, py-8 (page containers, major sections)
- Large spacing: p-12, py-16 (page top/bottom padding on admin)

**Admin Layout (Desktop):**
- Max-width: max-w-7xl (1280px container)
- Sidebar navigation: w-64 fixed left
- Main content: ml-64 with p-8
- Multi-column grids: grid-cols-2 to grid-cols-3 for forms
- Table containers: w-full with horizontal scroll

**Mobile Layout:**
- Full-width: w-full, no max-width constraints
- Single column: all content stacked vertically
- Page padding: p-4
- Large touch targets: min-h-12 for buttons, min-h-10 for inputs

---

## Component Library

### Admin Components

**Data Tables:**
- Bordered design with alternating row treatment
- Fixed header row with sticky positioning
- Column headers: font-weight-600, uppercase text-xs
- Row height: h-12 to h-14
- Hover state for rows
- Action buttons (edit, view) aligned right in row

**Filter Bars:**
- Fixed to top of table container
- Horizontal layout with gap-4
- Dropdown selects + search input + action buttons
- Height: h-12 to h-14

**Detail Panels/Drawers:**
- Slide from right: fixed right-0, w-96 to w-1/3
- Header with close button: h-16
- Scrollable content area
- Footer with action buttons: h-16, border-top

**Forms (Admin):**
- Two-column layout on desktop: grid-cols-2, gap-6
- Label above input pattern
- Input height: h-10
- Required field indicators: asterisk suffix on labels

### Mobile Components

**Large Button Pattern:**
- Full-width: w-full
- Height: h-14 to h-16
- Rounded: rounded-lg
- Text: font-weight-600, text-base
- Margin between buttons: mt-4

**Mobile Forms:**
- Single-column stack
- Large input fields: h-12
- Labels: mb-2, font-weight-500
- Section dividers: border-top with py-6
- File upload areas: border-2 border-dashed, p-8, text-center

**Success/Confirmation Screens:**
- Centered content: flex items-center justify-center min-h-screen
- Icon (checkmark): text-6xl mb-4
- Heading: text-2xl font-bold mb-2
- Message: text-base mb-8
- Action button: standard mobile button

### Shared Components

**Navigation (Admin Sidebar):**
- Vertical list of links
- Icon + label pattern
- Active state indication
- Grouped by section with dividers

**Status Badges:**
- Inline-flex items-center
- Padding: px-3 py-1
- Rounded: rounded-full
- Font: text-xs font-medium uppercase

**Form Inputs (All):**
- Border: border-2
- Rounded: rounded-md
- Focus: ring-2 outline-none
- Disabled state: reduced opacity

**Select Dropdowns:**
- Match input styling
- Chevron icon indicator
- Dropdown menu: elevated shadow

**File Upload Areas:**
- Dashed border on default state
- Drag-and-drop zone styling
- Preview thumbnails when file selected
- Remove button overlay on preview

---

## Page-Specific Patterns

### Admin: Store Management
- Header with "Add Store" button (top-right)
- Table with columns: Name, Code, Address, Active, Actions
- Inline edit capability or modal form

### Admin: Candidate List
- Filter bar with hire_decision dropdown + search
- Table with expandable row detail or right-side panel
- "Generate Onboarding Link" button reveals copyable URL input

### Admin: Employee List
- Filter bar: Store dropdown, Status dropdown, Keyword search
- Table columns: Name, Nickname, Store, Status, Rate, Visa Expiry
- Click row → navigate to detail page

### Admin: Employee Detail
- Two-column form layout
- Grouped sections with section headings: Personal Info, Contact, Employment, Banking, Superannuation
- Save button (sticky footer or top-right)

### Mobile: Interview Form
- Single-column vertical form
- Field groups with visible spacing (py-6)
- Large submit button at bottom: "Submit Interview"

### Mobile: Onboarding Form
- Multi-step feel using scrollable single page
- Progress indication at top (optional step counter)
- File upload sections with camera icon placeholders
- Large "Complete Onboarding" button at bottom
- Success screen with checkmark icon

---

## Validation & Feedback

**Form Validation:**
- Inline error messages below inputs: text-sm, appear on blur
- Required field indicators visible before submission
- Submit button disabled until valid

**Loading States:**
- Spinner overlay on tables during fetch
- Button loading state: spinner replacing text
- Skeleton loaders for detail panels

**Toast Notifications:**
- Fixed top-right position
- Auto-dismiss after 4 seconds
- Success, error, info variants

---

## Images

**Not Applicable:** This is an internal business tool with no marketing content. No hero images or decorative photography required. The application is purely functional with form inputs, data tables, and document uploads.