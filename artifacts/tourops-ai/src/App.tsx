import { ClerkProvider, SignUp, Show, useAuth, useClerk } from '@clerk/react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { clerkAppearance } from '@/lib/clerk-appearance';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Switch, Route, Redirect, Router as WouterRouter, useLocation } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { ProfileProvider, useProfile, type UserRole } from '@/contexts/ProfileContext';
import { OfflineQueueProvider } from '@/contexts/OfflineQueueContext';
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt';
import { useNotificationSync } from '@/hooks/useNotificationSync';

// ── Eagerly loaded: needed on first paint for unauthenticated + core flows ─────
import SignInSelectPage from '@/pages/sign-in-select';
import SignInStaffPage from '@/pages/sign-in-staff';
import SignInAdminPage from '@/pages/sign-in-admin';
import LandingPage from '@/pages/landing';
import Dashboard from '@/pages/dashboard';
import CustomersPage from '@/pages/customers';
import CustomerDetailPage from '@/pages/customer-detail';
import SuppliersPage from '@/pages/suppliers';
import SupplierDetailPage from '@/pages/supplier-detail';
import ToursPage from '@/pages/tours';
import TourNewPage from '@/pages/tour-new';
import TourDetailPage from '@/pages/tour-detail';
import QuotationsPage from '@/pages/quotations';
import QuotationNewPage from '@/pages/quotation-new';
import QuotationDetailPage from '@/pages/quotation-detail';
import OperationsPage from '@/pages/operations';
import OperationDetailPage from '@/pages/operation-detail';
import GuideDashboardPage from '@/pages/guide-dashboard';
import NotificationsPage from '@/pages/notifications';
import SettingsPage from '@/pages/settings';
import NewRequestPage from '@/pages/new-request';
import NotFound from '@/pages/not-found';
import ForbiddenPage from '@/pages/forbidden';
import ForgotPasswordPage from '@/pages/forgot-password';

// ── Lazy loaded: heavy role-specific pages not needed on first paint ───────────
const GuideOperationDetailPage     = lazy(() => import('@/pages/guide-operation-detail'));
const FieldDashboardPage           = lazy(() => import('@/pages/field-dashboard'));
const FieldOperationDetailPage     = lazy(() => import('@/pages/field-operation-detail'));
const FieldIncidentsPage           = lazy(() => import('@/pages/field-incidents'));
const FieldIncidentDetailPage      = lazy(() => import('@/pages/field-incident-detail'));
const AccountingDashboardPage      = lazy(() => import('@/pages/accounting'));
const AccountingTransactionsPage   = lazy(() => import('@/pages/accounting-transactions'));
const AccountingDocumentsPage      = lazy(() => import('@/pages/accounting-documents'));
const AccountingReportsPage        = lazy(() => import('@/pages/accounting-reports'));
const AccountingOperationPage      = lazy(() => import('@/pages/accounting-operation'));
const AccountingSettingsPage       = lazy(() => import('@/pages/accounting-settings'));
const AccountingDocumentDetailPage = lazy(() => import('@/pages/accounting-document-detail'));
const UsersPage                    = lazy(() => import('@/pages/users'));
const RolesPage                    = lazy(() => import('@/pages/roles'));
const SystemControlPage            = lazy(() => import('@/pages/system-control'));
const AuditLogPage                 = lazy(() => import('@/pages/audit'));
const ChangePasswordPage           = lazy(() => import('@/pages/change-password'));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

/** Minimal full-screen spinner shown while a lazy page chunk is loading. */
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

/**
 * Gates the entire QueryClientProvider (and therefore all React-Query hooks)
 * behind Clerk's initialization.  Renders null until `isLoaded` is true,
 * guaranteeing that `setAuthTokenGetter` is wired BEFORE any query fires.
 *
 * Must live inside ClerkProvider (needs useAuth context).
 * Cookies alone are unreliable in Replit's proxied-iframe environment.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, userId } = useAuth();
  // Register synchronously every render — idempotent, always up-to-date.
  setAuthTokenGetter(() => getToken());

  // When user identity changes (sign-in / sign-out / account switch) clear the
  // entire React Query cache so a new user never receives a stale profile from
  // the previous session. queryClient lives at module scope so it's accessible here.
  const prevUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevUserId.current !== undefined && prevUserId.current !== userId) {
      queryClient.clear();
    }
    prevUserId.current = userId;
  }, [userId]);

  // Block children until Clerk has finished initialising to prevent the
  // race where stale React-Query cache triggers a refetch before the
  // Bearer token getter is ready.
  if (!isLoaded) return null;
  return <>{children}</>;
}

/**
 * Redirects to /change-password when the user has a temporary password that
 * needs to be changed before they can access the application.
 * Must live inside ProfileProvider and WouterRouter.
 */
function MustChangePasswordGuard({ children }: { children: React.ReactNode }) {
  const { mustChangePassword, isLoading } = useProfile();
  const [location] = useLocation();

  // Allow: still loading, already on the change-password page, flag not set
  if (isLoading || !mustChangePassword || location === '/change-password') {
    return <>{children}</>;
  }
  return <Redirect to="/change-password" />;
}

function ProtectedRoute({ component: Comp }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <MustChangePasswordGuard><Comp /></MustChangePasswordGuard>
      </Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

/**
 * Route guard that checks the user's role before rendering the component.
 * Redirects to /forbidden if the user's role is not in the allowed set.
 * Falls back gracefully while the profile is still loading.
 */
function RoleRoute({ component: Comp, roles }: { component: React.ComponentType; roles: UserRole[] }) {
  // super_admin is a universal-pass role — can access everything
  const { role, isLoading } = useProfile();

  // Show nothing while loading to avoid flash
  if (isLoading) return null;

  // Not signed in — let ProtectedRoute handle this, but gate by role too
  if (role === null) return <Redirect to="/" />;

  // super_admin bypasses all role restrictions
  if (role !== 'super_admin' && !roles.includes(role)) return <Redirect to="/forbidden" />;

  return <Comp />;
}

function ProtectedRoleRoute({ component: Comp, roles }: { component: React.ComponentType; roles: UserRole[] }) {
  return (
    <>
      <Show when="signed-in">
        <MustChangePasswordGuard>
          <RoleRoute component={Comp} roles={roles} />
        </MustChangePasswordGuard>
      </Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

/**
 * Post-sign-in landing redirect, role-aware.
 * Waits for the profile to load before redirecting so the correct
 * role is used (avoids forbidden-loop for guides).
 *
 *   guide             → /guide
 *   field_operations  → /field
 *   everyone else     → /dashboard
 *   still loading     → render nothing (Clerk Show handles signed-out → landing)
 *   role=null (error) → render nothing (ProfileError overlay handles the UI)
 */
function HomeRedirect() {
  const { role, isLoading } = useProfile();

  let signedInContent: React.ReactNode = null;
  // Only redirect when we have a definitive role — guards against an infinite
  // redirect loop when role=null due to a profile fetch error.
  if (!isLoading && role !== null) {
    if (role === 'guide') {
      signedInContent = <Redirect to="/guide" />;
    } else if (role === 'field_operations') {
      signedInContent = <Redirect to="/field" />;
    } else {
      signedInContent = <Redirect to="/dashboard" />;
    }
  }

  return (
    <>
      <Show when="signed-in">{signedInContent}</Show>
      <Show when="signed-out"><LandingPage /></Show>
    </>
  );
}

/**
 * Full-screen error overlay shown when the profile fetch permanently fails
 * for a signed-in user. Offers Retry, Sign Out, and Go Home.
 * Must be rendered inside both ProfileProvider and WouterRouter.
 */
function ProfileError() {
  const { isError, isLoading, refetchProfile } = useProfile();
  const { userId } = useAuth();
  const clerk = useClerk();
  const [, navigate] = useLocation();

  // Only show for authenticated users after the query has definitively failed.
  if (!userId || !isError || isLoading) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-5 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-destructive" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground">Profil Yüklenemedi</h2>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            Sunucuya bağlanırken bir hata oluştu.
            İnternet bağlantınızı kontrol edip tekrar deneyin.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 w-full">
          <Button className="w-full" onClick={() => refetchProfile()}>
            Yeniden Dene
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => clerk.signOut().catch(() => {})}
          >
            Çıkış Yap
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={async () => {
              await clerk.signOut().catch(() => {});
              navigate('/');
            }}
          >
            Ana Sayfaya Dön
          </Button>
        </div>
      </div>
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} appearance={clerkAppearance} />
    </div>
  );
}

function AppServices() {
  useNotificationSync();
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/staff/*?" component={SignInStaffPage} />
      <Route path="/sign-in/admin" component={SignInAdminPage} />
      <Route path="/sign-in" component={SignInSelectPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/forbidden" component={ForbiddenPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/change-password" component={() => (
        <>
          <Show when="signed-in"><ChangePasswordPage /></Show>
          <Show when="signed-out"><Redirect to="/" /></Show>
        </>
      )} />
      <Route path="/dashboard" component={() => <ProtectedRoleRoute component={Dashboard} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/requests/new" component={() => <ProtectedRoleRoute component={NewRequestPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/customers" component={() => <ProtectedRoleRoute component={CustomersPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/customers/:id" component={() => <ProtectedRoleRoute component={CustomerDetailPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/suppliers" component={() => <ProtectedRoleRoute component={SuppliersPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/suppliers/:id" component={() => <ProtectedRoleRoute component={SupplierDetailPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/tours/new" component={() => <ProtectedRoleRoute component={TourNewPage} roles={['admin', 'operations']} />} />
      <Route path="/tours/:id" component={() => <ProtectedRoleRoute component={TourDetailPage} roles={['admin', 'operations', 'guide', 'accounting']} />} />
      <Route path="/tours" component={() => <ProtectedRoleRoute component={ToursPage} roles={['admin', 'operations', 'guide', 'accounting']} />} />
      <Route path="/quotations/new" component={() => <ProtectedRoleRoute component={QuotationNewPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/quotations/:id" component={() => <ProtectedRoleRoute component={QuotationDetailPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/quotations" component={() => <ProtectedRoleRoute component={QuotationsPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/guide/:id" component={() => <ProtectedRoleRoute component={GuideOperationDetailPage} roles={['guide', 'admin', 'super_admin']} />} />
      <Route path="/guide" component={() => <ProtectedRoleRoute component={GuideDashboardPage} roles={['guide', 'admin', 'super_admin']} />} />
      <Route path="/field/incidents/:id" component={() => <ProtectedRoleRoute component={FieldIncidentDetailPage} roles={['field_operations', 'operations', 'admin']} />} />
      <Route path="/field/incidents" component={() => <ProtectedRoleRoute component={FieldIncidentsPage} roles={['field_operations', 'operations', 'admin']} />} />
      <Route path="/field/operations/:id" component={() => <ProtectedRoleRoute component={FieldOperationDetailPage} roles={['field_operations', 'operations', 'admin']} />} />
      <Route path="/field/operations" component={() => <Redirect to="/field" />} />
      <Route path="/field" component={() => <ProtectedRoleRoute component={FieldDashboardPage} roles={['field_operations', 'operations', 'admin']} />} />
      <Route path="/operations/:id" component={() => <ProtectedRoleRoute component={OperationDetailPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/operations" component={() => <ProtectedRoleRoute component={OperationsPage} roles={['admin', 'operations', 'accounting']} />} />
      <Route path="/notifications" component={() => <ProtectedRoute component={NotificationsPage} />} />
      <Route path="/accounting/operations/:id" component={() => <ProtectedRoleRoute component={AccountingOperationPage} roles={['admin', 'accounting', 'operations']} />} />
      <Route path="/accounting/transactions" component={() => <ProtectedRoleRoute component={AccountingTransactionsPage} roles={['admin', 'accounting', 'operations']} />} />
      <Route path="/accounting/documents/:type/:id" component={() => <ProtectedRoleRoute component={AccountingDocumentDetailPage} roles={['admin', 'accounting']} />} />
      <Route path="/accounting/documents" component={() => <ProtectedRoleRoute component={AccountingDocumentsPage} roles={['admin', 'accounting']} />} />
      <Route path="/accounting/reports" component={() => <ProtectedRoleRoute component={AccountingReportsPage} roles={['admin', 'accounting']} />} />
      <Route path="/accounting/settings" component={() => <ProtectedRoleRoute component={AccountingSettingsPage} roles={['admin', 'accounting']} />} />
      <Route path="/accounting" component={() => <ProtectedRoleRoute component={AccountingDashboardPage} roles={['admin', 'accounting']} />} />
      <Route path="/settings" component={() => <ProtectedRoleRoute component={SettingsPage} roles={['admin', 'operations']} />} />
      <Route path="/users" component={() => <ProtectedRoleRoute component={UsersPage} roles={['super_admin']} />} />
      <Route path="/roles" component={() => <ProtectedRoleRoute component={RolesPage} roles={['super_admin']} />} />
      <Route path="/system-control" component={() => <ProtectedRoleRoute component={SystemControlPage} roles={['super_admin']} />} />
      <Route path="/audit" component={() => <ProtectedRoleRoute component={AuditLogPage} roles={['super_admin']} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ClerkProvider publishableKey={clerkPubKey!} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}>
      <AuthGate>
        <QueryClientProvider client={queryClient}>
          <OfflineQueueProvider>
            <ProfileProvider>
              <TooltipProvider>
                <WouterRouter base={basePath}>
                  <Suspense fallback={<PageLoader />}>
                    <Router />
                  </Suspense>
                  <ProfileError />
                </WouterRouter>
                <AppServices />
                <Toaster />
                <PwaInstallPrompt />
              </TooltipProvider>
            </ProfileProvider>
          </OfflineQueueProvider>
        </QueryClientProvider>
      </AuthGate>
    </ClerkProvider>
  );
}
