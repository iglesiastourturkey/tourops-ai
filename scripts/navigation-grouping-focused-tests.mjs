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

assert.deepEqual(
  [...groupsSource.matchAll(/title:\s*'([^']+)'/g)].map(([, title]) => title),
  ['Genel', 'Satış & Rezervasyon', 'Operasyon', 'Muhasebe', 'Yönetim'],
  'sidebar sections must keep the approved business grouping and order',
);

assert.equal(new Set(navHrefs).size, navHrefs.length, 'navItems hrefs must stay unique');
assert.equal(new Set(groupedHrefs).size, groupedHrefs.length, 'an href must not appear in more than one sidebar group');
assert.deepEqual(
  [...new Set(groupedHrefs)].sort(),
  [...new Set(navHrefs)].sort(),
  'every current nav item must be assigned to exactly one sidebar group',
);

assert.ok(
  /const visibleNavItems = navItems\.filter\(item => \{/.test(APP_SHELL_SOURCE),
  'permission and role filtering must happen before the sidebar is grouped',
);
assert.ok(
  /items:\s*g\.hrefs\s*\.map\(href => visibleNavItems\.find\(i => i\.href === href\)\)/.test(APP_SHELL_SOURCE),
  'groups must be built only from visibleNavItems so empty/unauthorized links cannot leak',
);
assert.ok(
  /\.filter\(section => section\.items\.length > 0\)/.test(APP_SHELL_SOURCE),
  'groups with no visible items must be omitted',
);

assert.ok(
  /const ungroupedItems = visibleNavItems\.filter\(i => !groupedHrefs\.has\(i\.href\)\)/.test(APP_SHELL_SOURCE)
    && /sections\.push\(\{ title: 'Diğer', items: ungroupedItems \}\)/.test(APP_SHELL_SOURCE),
  'future unassigned links must remain reachable through the Diğer fallback group',
);

assert.ok(
  /role="group" aria-label=\{section\.title\}/.test(APP_SHELL_SOURCE),
  'each rendered section must expose an accessible group label',
);
assert.ok(
  /onClick=\{\(\) => setSidebarOpen\(false\)\}/.test(APP_SHELL_SOURCE),
  'selecting a grouped link must still close the mobile sidebar',
);
assert.equal(
  (APP_SHELL_SOURCE.match(/<SidebarContent \/>/g) ?? []).length,
  2,
  'desktop and mobile sidebars must continue to share the same grouped SidebarContent',
);

console.log('navigation grouping focused tests: passed');
