import assert from "node:assert";
import {
  classifyWeekSeason, dayCategory, resolveWeekCaps, sumByCategory, findBreaches, weekDates,
} from "../shared/rosterCaps";

// weekDates
assert.deepEqual(weekDates("2026-06-01").length, 7);
assert.equal(weekDates("2026-06-01")[6], "2026-06-07");

// season: a week fully inside a holiday range
const ranges = [{ startDate: "2026-07-06", endDate: "2026-07-17" }];
assert.equal(classifyWeekSeason("2026-07-06", ranges), "HOLIDAY");
// week with no overlap => TERM
assert.equal(classifyWeekSeason("2026-06-01", ranges), "TERM");
// straddle: holiday starts Thu 2026-07-02 .. so week 2026-06-29 has Thu,Fri,Sat,Sun = 4 => HOLIDAY
assert.equal(classifyWeekSeason("2026-06-29", [{ startDate: "2026-07-02", endDate: "2026-07-12" }]), "HOLIDAY");
// straddle minority: holiday starts Sat 2026-07-04 => week 2026-06-29 has Sat,Sun = 2 => TERM
assert.equal(classifyWeekSeason("2026-06-29", [{ startDate: "2026-07-04", endDate: "2026-07-12" }]), "TERM");

// dayCategory: PH precedence
assert.equal(dayCategory("2026-06-06", []), "SATURDAY");       // Sat
assert.equal(dayCategory("2026-06-07", []), "SUNDAY");         // Sun
assert.equal(dayCategory("2026-06-03", []), "WEEKDAY");        // Wed
assert.equal(dayCategory("2026-06-06", ["2026-06-06"]), "PUBLIC_HOLIDAY"); // Sat that is a PH

// resolve + breaches
const caps = resolveWeekCaps("TERM",
  { weeklyTotalHours: 38, saturdayHours: 8, sundayHours: 6, publicHolidayHours: 5 },
  ["2026-06-03"]); // one PH on a Wed
assert.equal(caps.publicHolidayCap, 5);
assert.equal(caps.weekdayPool, 38 - 8 - 6 - 5); // 19
const used = sumByCategory([
  { date: "2026-06-06", hours: 9 }, // Sat 9 > 8 cap
  { date: "2026-06-03", hours: 5 }, // PH 5 ok
  { date: "2026-06-01", hours: 10 }, // weekday
], caps.phDays);
const breaches = findBreaches(caps, used);
assert.ok(breaches.some(b => b.category === "SATURDAY"));
console.log("OK: roster-caps logic verified");
