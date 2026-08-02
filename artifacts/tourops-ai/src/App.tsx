import { ClerkProvider, SignIn, SignUp, Show, useAuth } from '@clerk/react';
import { useEffect, useRef } from 'react';
import { Link } from 'wouter';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Switch, Route, Redirect, Router as WouterRouter } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import { ProfileProvider, useProfile, type UserRole } from '@/contexts/ProfileContext';
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
import NotificationsPage from '@/pages/notifications';
import SettingsPage from '@/pages/settings';
import NewRequestPage from '@/pages/new-request';
import NotFound from '@/pages/not-found';
import ForbiddenPage from '@/pages/forbidden';
import UsersPage from '@/pages/users';
import ForgotPasswordPage from '@/pages/forgot-password';
import AccountingDashboardPage from '@/pages/accounting';
import AccountingTransactionsPage from '@/pages/accounting-transactions';
import AccountingDocumentsPage from '@/pages/accounting-documents';
import AccountingReportsPage from '@/pages/accounting-reports';
import AccountingOperationPage from '@/pages/accounting-operation';
import AccountingSettingsPage from '@/pages/accounting-settings';
import AccountingDocumentDetailPage from '@/pages/accounting-document-detail';;

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const clerkAppearance = {
  baseTheme: shadcn,
  layout: {
    logoImageUrl: `${basePath}/logo.svg`,
    logoPlacement: 'inside' as const,
    socialButtonsPlacement: 'bottom' as const,
  },
  variables: {
    colorPrimary: '#0d7377',
    colorBackground: '#f8fafc',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '8px',
  },
  elements: {
    card: { boxShadow: '0 4px 24px rgba(13,115,119,0.08)', border: '1px solid #e2e8f0' },
    formButtonPrimary: { backgroundColor: '#0d7377' },
  },
};

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

function ProtectedRoute({ component: Comp }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in"><Comp /></Show>
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
      <Show when="signed-in"><RoleRoute component={Comp} roles={roles} /></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

/**
 * Post-sign-in landing redirect, role-aware.
 * Waits for the profile to load before redirecting so the correct
 * role is used (avoids forbidden-loop for guides).
 *
 *   guide                      → /operations
 *   admin / operations / accounting / super_admin → /dashboard
 *   profile still loading      → render nothing (Clerk Show handles
 *                                 the signed-out → landing page case)
 */
function HomeRedirect() {
  const { role, isLoading } = useProfile();

  let signedInContent: React.ReactNode = null;
  if (!isLoading) {
    signedInContent = role === 'guide'
      ? <Redirect to="/operations" />
      : <Redirect to="/dashboard" />;
  }

  return (
    <>
      <Show when="signed-in">{signedInContent}</Show>
      <Show when="signed-out"><LandingPage /></Show>
    </>
  );
}

function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={clerkAppearance} />
        <Link href="/forgot-password" className="text-sm text-muted-foreground hover:text-primary transition-colors">
          Şifremi Unuttum?
        </Link>
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

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/forbidden" component={ForbiddenPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
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
      <Route path="/operations/:id" component={() => <ProtectedRoleRoute component={OperationDetailPage} roles={['admin', 'operations', 'accounting', 'guide']} />} />
      <Route path="/operations" component={() => <ProtectedRoleRoute component={OperationsPage} roles={['admin', 'operations', 'accounting', 'guide']} />} />
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
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ClerkProvider publishableKey={clerkPubKey!} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}>
      <AuthGate>
        <QueryClientProvider client={queryClient}>
          <ProfileProvider>
            <TooltipProvider>
              <WouterRouter base={basePath}>
                <Router />
              </WouterRouter>
              <Toaster />
            </TooltipProvider>
          </ProfileProvider>
        </QueryClientProvider>
      </AuthGate>
    </ClerkProvider>
  );
}
