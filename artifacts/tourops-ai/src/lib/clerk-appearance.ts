/**
 * Shared Clerk appearance config and app-level URL helpers.
 * Imported by all custom sign-in/sign-up pages so appearance stays consistent.
 */
import { shadcn } from '@clerk/themes';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const base     = import.meta.env.BASE_URL ?? '/';

export const VITE_BASE = basePath;

export const API_BASE = base.endsWith('/') ? `${base}api` : `${base}/api`;

export const clerkAppearance = {
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
} as const;
