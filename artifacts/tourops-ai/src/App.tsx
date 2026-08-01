import { ClerkProvider, SignIn, SignUp, Show, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Switch, Route, Redirect, Router as WouterRouter } from 'wouter';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setAuthTokenGetter } from '@workspace/api-client-react';
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
  const { getToken, isLoaded } = useAuth();
  // Register synchronously every render — idempotent, always up-to-date.
  setAuthTokenGetter(() => getToken());
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

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/dashboard" /></Show>
      <Show when="signed-out"><LandingPage /></Show>
    </>
  );
}

function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} appearance={clerkAppearance} />
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
      <Route path="/dashboard" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/requests/new" component={() => <ProtectedRoute component={NewRequestPage} />} />
      <Route path="/customers" component={() => <ProtectedRoute component={CustomersPage} />} />
      <Route path="/customers/:id" component={() => <ProtectedRoute component={CustomerDetailPage} />} />
      <Route path="/suppliers" component={() => <ProtectedRoute component={SuppliersPage} />} />
      <Route path="/suppliers/:id" component={() => <ProtectedRoute component={SupplierDetailPage} />} />
      <Route path="/tours/new" component={() => <ProtectedRoute component={TourNewPage} />} />
      <Route path="/tours/:id" component={() => <ProtectedRoute component={TourDetailPage} />} />
      <Route path="/tours" component={() => <ProtectedRoute component={ToursPage} />} />
      <Route path="/quotations/new" component={() => <ProtectedRoute component={QuotationNewPage} />} />
      <Route path="/quotations/:id" component={() => <ProtectedRoute component={QuotationDetailPage} />} />
      <Route path="/quotations" component={() => <ProtectedRoute component={QuotationsPage} />} />
      <Route path="/operations/:id" component={() => <ProtectedRoute component={OperationDetailPage} />} />
      <Route path="/operations" component={() => <ProtectedRoute component={OperationsPage} />} />
      <Route path="/notifications" component={() => <ProtectedRoute component={NotificationsPage} />} />
      <Route path="/settings" component={() => <ProtectedRoute component={SettingsPage} />} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <ClerkProvider publishableKey={clerkPubKey!} proxyUrl={clerkProxyUrl} appearance={clerkAppearance}>
      <AuthGate>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <WouterRouter base={basePath}>
              <Router />
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </AuthGate>
    </ClerkProvider>
  );
}
