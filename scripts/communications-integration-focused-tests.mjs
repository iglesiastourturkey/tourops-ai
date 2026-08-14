import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const route = await readFile(resolve(root, 'artifacts/api-server/src/routes/communications.ts'), 'utf8');
const schema = await readFile(resolve(root, 'lib/db/src/schema/communications.ts'), 'utf8');
const migration = await readFile(resolve(root, 'lib/db/migrations/0010_communication_integration_events.sql'), 'utf8');
const page = await readFile(resolve(root, 'artifacts/tourops-ai/src/pages/communications.tsx'), 'utf8');
const client = await readFile(resolve(root, 'artifacts/tourops-ai/src/lib/communications-api.ts'), 'utf8');
const env = await readFile(resolve(root, 'artifacts/api-server/.env.example'), 'utf8');

const checks = [
  [route.includes('createHmac("sha256", secret)'), 'webhook must use HMAC-SHA256'],
  [route.includes('timingSafeEqual'), 'signature comparison must be timing safe'],
  [route.includes('MAX_SIGNATURE_AGE_SECONDS = 300'), 'signature timestamp must expire'],
  [route.includes('statusEventSchema') && route.includes('}).strict()'), 'payload must be strict and allowlisted'],
  [route.includes('event.tenantId !== tenantId'), 'tenant must be enforced server-side'],
  [route.includes('.onConflictDoNothing'), 'duplicate events must be idempotent'],
  [schema.includes('uniqueIndex("communication_events_tenant_event_uidx")'), 'schema must declare tenant/event uniqueness'],
  [migration.includes('NOT APPLIED BY THIS COMMIT'), 'migration must not imply automatic production application'],
  [route.includes('router.use(requireAuth, requireRole("admin", "operations"))'), 'read endpoint must enforce roles server-side'],
  [client.includes("customFetch<CommunicationsStatus>"), 'frontend must reuse the authenticated shared client'],
  [page.includes('useCommunicationsStatus'), 'page must consume the readonly status endpoint'],
  [!page.includes('useMutation') && !page.includes('method: \'POST\''), 'page must expose no outbound mutation'],
  [env.includes('COMMUNICATIONS_INTEGRATION_ENABLED=false'), 'integration must be documented as disabled by default'],
];

const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('communications integration focused checks passed');
