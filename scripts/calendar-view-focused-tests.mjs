import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Focused tests for Faz 4 (Günlük/Aylık takvim) - the operations calendar
// view: artifacts/tourops-ai/src/lib/calendar-grouping.ts,
// artifacts/tourops-ai/src/pages/calendar.tsx, and the two registration
// points that make the page reachable, artifacts/tourops-ai/src/App.tsx
// (route) and artifacts/tourops-ai/src/components/AppShell.tsx (nav entry).
// Same shape as the other suites here - source assertions against the real
// files, because calendar.tsx's data comes from a live React Query hook and
// is not usefully mirrored as a pure function, while calendar-grouping.ts
// (which is pure) is checked more directly below.

const GROUPING_SOURCE = readFileSync(
  new URL("../artifacts/tourops-ai/src/lib/calendar-grouping.ts", import.meta.url),
  "utf8",
);
const CALENDAR_PAGE_SOURCE = readFileSync(
  new URL("../artifacts/tourops-ai/src/pages/calendar.tsx", import.meta.url),
  "utf8",
);
const APP_SOURCE = readFileSync(
  new URL("../artifacts/tourops-ai/src/App.tsx", import.meta.url),
  "utf8",
);
const APP_SHELL_SOURCE = readFileSync(
  new URL("../artifacts/tourops-ai/src/components/AppShell.tsx", import.meta.url),
  "utf8",
);

// ── 1. calendar-grouping.ts: pure helpers, no external dependencies ─────────
assert.ok(
  !/from\s+['"]@\//.test(GROUPING_SOURCE) && !/from\s+['"]@workspace\//.test(GROUPING_SOURCE),
  "calendar-grouping.ts must stay free of @/ and @workspace/ imports so it remains trivially testable in isolation",
);
assert.ok(
  /export function groupOperationsByDate</.test(GROUPING_SOURCE),
  "calendar-grouping.ts must export groupOperationsByDate",
);
assert.ok(
  /export function toDateKey\(/.test(GROUPING_SOURCE),
  "calendar-grouping.ts must export toDateKey",
);
assert.ok(
  /export function getMonthGrid\(/.test(GROUPING_SOURCE),
  "calendar-grouping.ts must export getMonthGrid",
);
assert.ok(
  /export function sortOperations</.test(GROUPING_SOURCE),
  "calendar-grouping.ts must export sortOperations",
);

// ── 2. groupOperationsByDate never silently drops unscheduled operations - ──
// it must skip them explicitly, so the caller can still account for them.
assert.ok(
  /if\s*\(!op\.startDate\)\s*continue;/.test(GROUPING_SOURCE),
  "groupOperationsByDate must explicitly skip operations with no startDate (via `if (!op.startDate) continue;`), not implicitly drop them",
);

// ── 3. toDateKey uses local date parts, not toISOString (which shifts the ──
// date across a UTC day boundary for timezones behind UTC, e.g. Istanbul at
// certain offsets vs UTC edge cases) - this is the whole point of the helper.
assert.ok(
  !/toDateKey[\s\S]{0,200}toISOString/.test(GROUPING_SOURCE),
  "toDateKey must not derive its key via toISOString(), which can shift the calendar date across a UTC day boundary",
);
assert.ok(
  /getFullYear\(\)/.test(GROUPING_SOURCE) && /getMonth\(\)\s*\+\s*1/.test(GROUPING_SOURCE) && /getDate\(\)/.test(GROUPING_SOURCE),
  "toDateKey must build its key from local getFullYear/getMonth/getDate",
);

// ── 4. getMonthGrid always returns a full 6-week (42-cell) grid ─────────────
assert.ok(
  /length:\s*42/.test(GROUPING_SOURCE),
  "getMonthGrid must return a fixed 42-cell (6-week) grid so every month renders a consistent-height calendar",
);

// ── 5. sortOperations: stable id-ascending order, does not mutate its input ──
// array. The operations list API exposes no pickup-time field to sort by
// (confirmed against the generated Operation type - see App.tsx/CI history),
// so this deliberately sorts by id rather than implying a time ordering the
// data doesn't have.
assert.ok(
  /export function sortOperations<T extends \{ id: number \}>\(operations: T\[\]\): T\[\]\s*\{\s*return \[\.\.\.operations\]\.sort\(\(a, b\) => a\.id - b\.id\);/.test(GROUPING_SOURCE),
  "sortOperations must sort a shallow copy ([...operations]) by id ascending, never mutate the caller's original array in place",
);
assert.ok(
  !/pickupTime/.test(GROUPING_SOURCE),
  "calendar-grouping.ts must not reference pickupTime - the generated Operation type used by useListOperations() does not expose that field",
);

// ── 6. calendar.tsx reuses existing data/layout infrastructure - no parallel ──
// fetch or bespoke shell was built for this page.
assert.ok(
  /import \{ useListOperations \} from '@workspace\/api-client-react';/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must reuse the existing useListOperations() hook, not a new/duplicated fetch",
);
assert.ok(
  /import \{ AppShell \} from '@\/components\/AppShell';/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must reuse the shared AppShell layout, same as every other authenticated page",
);
assert.ok(
  /import \{ groupOperationsByDate, getMonthGrid, toDateKey, sortOperations \} from '@\/lib\/calendar-grouping';/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must import its grouping/grid helpers from the new calendar-grouping.ts module",
);
assert.ok(
  /import \{ OPERATION_STATUS_LABELS, OPERATION_STATUS_COLORS, formatDate \} from '@\/lib\/labels';/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must reuse the existing status label/color maps from lib/labels, not redeclare them",
);

// ── 7. month/day view-mode toggle exists and both views are wired ───────────
assert.ok(
  /type ViewMode = 'month' \| 'day';/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must define a ViewMode of 'month' | 'day'",
);
assert.ok(
  /data-testid="button-calendar-view-month"/.test(CALENDAR_PAGE_SOURCE) && /data-testid="button-calendar-view-day"/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must expose distinct month/day view-toggle buttons",
);

// ── 8. unscheduled operations are surfaced, not silently hidden ─────────────
// (operations with no startDate cannot appear in the grid at all, since
// groupOperationsByDate skips them - the page must at least tell the viewer
// how many are missing and where to find them.)
assert.ok(
  /const unscheduledCount = useMemo\(\(\) => scheduled\.filter\(op => !op\.startDate\)\.length, \[scheduled\]\);/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must compute unscheduledCount from operations with no startDate",
);
assert.ok(
  /\{unscheduledCount > 0 && \(/.test(CALENDAR_PAGE_SOURCE) && /operasyonun tarihi belirlenmemiş/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must render a visible notice when unscheduledCount is greater than 0, so unscheduled operations are never silently invisible",
);

// ── 9. each day cell links through to the operation detail page ─────────────
assert.ok(
  /href=\{`\/operations\/\$\{op\.id\}`\}/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx's day view must link each operation to /operations/:id, reusing the existing detail page",
);
assert.ok(
  !/pickupTime/.test(CALENDAR_PAGE_SOURCE),
  "calendar.tsx must not reference pickupTime - the generated Operation type from useListOperations() does not expose that field, and referencing it broke the typecheck CI step",
);

// ── 10. App.tsx: /calendar is lazy-loaded and registered with the same ──────
// roles as /operations (operations/day-to-day planning access).
assert.ok(
  /const CalendarPage = lazy\(\(\) => import\('@\/pages\/calendar'\)\);/.test(APP_SOURCE),
  "App.tsx must lazy-load the calendar page, not eagerly import it",
);
assert.ok(
  /<Route path="\/calendar" component=\{\(\) => <ProtectedRoleRoute component=\{CalendarPage\} roles=\{\['admin', 'operations', 'accounting'\]\} \/>\} \/>/.test(APP_SOURCE),
  "App.tsx must register /calendar with the same roles as /operations (admin, operations, accounting)",
);

// ── 11. AppShell.tsx: the "Takvim" nav entry exists, gated by the same ──────
// permission as the Operations list it complements.
assert.ok(
  /CalendarDays,?\s*\}\s*from\s*'lucide-react';/.test(APP_SHELL_SOURCE),
  "AppShell.tsx must import the CalendarDays icon from lucide-react",
);
assert.ok(
  /\{\s*icon:\s*CalendarDays,\s*label:\s*'Takvim',\s*href:\s*'\/calendar',\s*permission:\s*\['operations',\s*'view'\]\s*\}/.test(APP_SHELL_SOURCE),
  "AppShell.tsx must register a 'Takvim' nav item pointing at /calendar, gated by the same ['operations','view'] permission as Operasyon Planlama",
);

console.log("calendar view focused tests: passed");
