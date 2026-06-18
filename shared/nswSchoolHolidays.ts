// Official NSW (statewide government-school) school-holiday break periods.
// Source: education.nsw.gov.au school calendars (Eastern division / Sydney metro).
//   2025: https://education.nsw.gov.au/content/dam/main-education/schooling/calendars/2025/2025_Calendar_Eastern_division_schools.pdf
//   2026: https://education.nsw.gov.au/schooling/calendars/2026
//   2027: https://education.nsw.gov.au/schooling/calendars/future-and-past-nsw-term-and-vacation-dates
//
// Dates are INCLUSIVE (first to last non-school day for students).
// Eastern division (metropolitan/Sydney) dates used throughout.
// The Summer break spans the year boundary and is listed as ONE range.
// Update this list as NSW publishes new years.
import type { DateRange } from "./rosterCaps";

export interface NswHolidayPeriod extends DateRange { name: string }

export const NSW_SCHOOL_HOLIDAYS: NswHolidayPeriod[] = [
  // ── 2025 ──────────────────────────────────────────────────────────────────
  // Summer 2024-25 is included so queries starting in early 2025 work correctly.
  { name: "Summer Holidays 2024-25",  startDate: "2024-12-22", endDate: "2025-01-30" },
  { name: "Autumn Holidays 2025",     startDate: "2025-04-14", endDate: "2025-04-24" },
  { name: "Winter Holidays 2025",     startDate: "2025-07-07", endDate: "2025-07-18" },
  { name: "Spring Holidays 2025",     startDate: "2025-09-29", endDate: "2025-10-10" },
  // Summer 2025-26 spans the year boundary (one continuous break).
  { name: "Summer Holidays 2025-26",  startDate: "2025-12-22", endDate: "2026-01-26" },

  // ── 2026 ──────────────────────────────────────────────────────────────────
  // Term 1: 2 Feb – 2 Apr 2026  |  Term 2: 22 Apr – 3 Jul  |
  // Term 3: 21 Jul – 25 Sep     |  Term 4: 13 Oct – 17 Dec
  { name: "Autumn Holidays 2026",     startDate: "2026-04-07", endDate: "2026-04-17" },
  { name: "Winter Holidays 2026",     startDate: "2026-07-06", endDate: "2026-07-17" },
  { name: "Spring Holidays 2026",     startDate: "2026-09-28", endDate: "2026-10-09" },
  // Summer 2026-27 spans the year boundary.
  { name: "Summer Holidays 2026-27",  startDate: "2026-12-18", endDate: "2027-01-27" },

  // ── 2027 ──────────────────────────────────────────────────────────────────
  // Term 1: 28 Jan – 9 Apr 2027  |  Term 2: 27 Apr – 2 Jul  |
  // Term 3: 19 Jul – 24 Sep      |  Term 4: 11 Oct – 20 Dec
  { name: "Autumn Holidays 2027",     startDate: "2027-04-12", endDate: "2027-04-23" },
  { name: "Winter Holidays 2027",     startDate: "2027-07-05", endDate: "2027-07-16" },
  { name: "Spring Holidays 2027",     startDate: "2027-09-27", endDate: "2027-10-08" },
  // Summer 2027-28 spans the year boundary.
  { name: "Summer Holidays 2027-28",  startDate: "2027-12-21", endDate: "2028-01-28" },
];
