# TourPilot Architecture

## Production

Frontend:
Vercel

Backend:
Render

Database:
Neon PostgreSQL

Authentication:
Clerk

Repository:
GitHub monorepo

## Current Monorepo

artifacts/
- tourops-ai
- api-server

lib/
scripts/

Preserve the monorepo unless a strong architectural reason requires otherwise.

## Environment Separation

Development
Staging
Production

Never test destructive integrations against production.

## PWA

TourPilot is PWA-first.

Every user-facing module must support:
- desktop
- tablet
- mobile
- installability
- existing offline behavior where applicable