import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const APP_SHELL_SOURCE = readFileSync(
  new URL('../artifacts/tourops-ai/src/components/AppShell.tsx', import.meta.url),
  'utf8',
);

const navStart = APP_SHELL_SOURCE.indexOf('const navItems: NavItem[] = [');
const navEnd = APP_SHELL_SOURCE.indexOf('];', navStart);
const groupsStart = APP_SHELL_SOURCE.indexOf('const NAV_GROUPS:');
const groupsEnd = APP_SHELL_SOURCE.indexOf('];', groupsStart);

assert.ok(navStart >= 0 && navEnd > navStart, 'navItems definition must remain available');
assert.ok(groupsStart >= 0 && groupsEnd > groupsStart, 'NAV_GROUPS definition must remain available');

const navSource = APP_SHELL_SOURCE.slice(navStart, navEnd);
const groupsSource = APP_SHELL_SOURCE.slice(groupsStart, groupsEnd);
const navHrefs = [...navSource.matchAll(/href:\s*'([^']+)'/g)].map(([, href]) => href);
const groupedHrefs = [...groupsSource.matchAll(/'\/(?:[^']*)'/g)].map(match => match[0].slice(1, -1));
const groupLabels = [...groupsSource.matchAll(/label:\s*'([^']+)'/g)].map(([, label]) => label);

assert.deepEqual(
  groupLabels,
  ['Rezervasyonlar', 'Operasyon', 'Müşteri & İş Ortakları', 'Ürünler', 'Finans', 'Yönetim'],
  'sidebar domain groups must keep the approved scalable business grouping and order',
);

assert.equal(new Set(navHrefs).size, navHrefs.length, 'navItems hrefs must stay unique');
assert.equal(new Set(groupedHrefs).size, groupedHrefs.length, 'an href must not appear in more than one sidebar domain group');

assert.ok(
  /const STANDALONE_HREFS = \['\/dashboard', '\/guide'\] as const;/.test(APP_SHELL_SOURCE),
  'dashboard and role-specific guide workspace must remain direct sidebar entries',
);
assert.ok(
  /const HEADER_ONLY_HREFS = new Set\(\['\/notifications'\]\);/.test(APP_SHELL_SOURCE),
  'notifications must stay reachable from the persistent header without being duplicated as a primary sidebar item',
);

const standaloneHrefs = ['/dashboard', '/guide'];
const headerOnlyHrefs = ['/notifications'];
const accountedFor = [...groupedHrefs, ...standaloneHrefs, ...headerOnlyHrefs];
assert.equal(new Set(accountedFor).size, accountedFor.length, 'a route must not be assigned to multiple navigation surfaces');
assert.deepEqual(
  [...new Set(accountedFor)].sort(),
  [...new Set(navHrefs)].sort(),
  'every current nav item must be assigned to a domain group, a direct entry, or the header-only notification surface',
);

assert.ok(
  /const visibleNavItems = navItems\.filter\(item => \{/.test(APP_SHELL_SOURCE),
  'permission and role filtering must happen before the sidebar is grouped',
);
assert.ok(
  /const visibleByHref = new Map\(visibleNavItems\.map\(item => \[item\.href, item\]\)\);/.test(APP_SHELL_SOURCE),
  'group construction must use permission-filtered visibleNavItems',
);
assert.ok(
  /items:\s*group\.hrefs\s*\.map\(href => visibleByHref\.get\(href\)\)/.test(APP_SHELL_SOURCE),
  'domain groups must resolve children only from visibleByHref so unauthorized links cannot leak',
);
assert.ok(
  /\.filter\(group => group\.items\.length > 0\)/.test(APP_SHELL_SOURCE),
  'parent groups with no visible child routes must be omitted',
);

assert.ok(
  /const ungroupedItems = visibleNavItems\.filter\(item => \(/.test(APP_SHELL_SOURCE)
    && /!groupedHrefs\.has\(item\.href\)/.test(APP_SHELL_SOURCE)
    && /!HEADER_ONLY_HREFS\.has\(item\.href\)/.test(APP_SHELL_SOURCE),
  'future unassigned links must remain reachable through the defensive Diğer fallback instead of silently disappearing',
);

assert.ok(
  /aria-expanded=\{isOpen\}/.test(APP_SHELL_SOURCE)
    && /aria-controls=\{regionId\}/.test(APP_SHELL_SOURCE),
  'collapsible parent groups must expose accessible expanded/collapsed state',
);
assert.ok(
  /role="group" aria-label=\{group\.label\}/.test(APP_SHELL_SOURCE),
  'expanded child navigation must expose an accessible group label',
);
assert.ok(
  /onClick=\{\(\) => setSidebarOpen\(false\)\}/.test(APP_SHELL_SOURCE),
  'selecting a child link must still close the mobile sidebar',
);
assert.equal(
  (APP_SHELL_SOURCE.match(/<SidebarContent \/>/g) ?? []).length,
  2,
  'desktop and mobile sidebars must continue to share the same SidebarContent',
);

assert.ok(
  /const activeGroup = NAV_GROUPS\.find\(group => group\.hrefs\.some\(href => isRouteActive\(location, href\)\)\);/.test(APP_SHELL_SOURCE),
  'the currently active route must determine which parent group opens initially',
);
assert.ok(
  /setOpenGroups\(current => \{/.test(APP_SHELL_SOURCE),
  'collapsible domain state must be managed explicitly rather than by mutating navigation definitions',
);

console.log('navigation grouping focused tests: passed');
