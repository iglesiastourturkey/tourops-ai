import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const app = await readFile(resolve(root, 'artifacts/tourops-ai/src/App.tsx'), 'utf8');
const shell = await readFile(resolve(root, 'artifacts/tourops-ai/src/components/AppShell.tsx'), 'utf8');
const page = await readFile(resolve(root, 'artifacts/tourops-ai/src/pages/communications.tsx'), 'utf8');

const checks = [
  [app.includes("import('@/pages/communications')"), 'communications page must be lazy loaded'],
  [app.includes('path="/communications"') && app.includes("roles={['admin', 'operations']}"), 'communications route must be restricted to admin and operations'],
  [shell.includes("label: 'İletişim & Otomasyonlar'") && shell.includes("allowedRoles: ['admin', 'operations']"), 'navigation must be restricted to admin and operations'],
  [page.includes('Mesaj gönderimi') && page.includes('kapalıdır'), 'page must state that outbound messaging is disabled'],
  [!page.includes('fetch(') && !page.includes('useMutation') && !page.includes('useQuery'), 'page must not make integration or mutation requests'],
];

const failures = checks.filter(([, passed]) => !passed).map(([message]) => message);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('communications readonly hub focused checks passed');
