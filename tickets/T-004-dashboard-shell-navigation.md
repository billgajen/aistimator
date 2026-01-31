# tickets/T-004-dashboard-shell-navigation.md

## Goal
Create the dashboard shell with navigation and placeholder pages aligned to `/docs/04-frontend.md`.

## In scope
- Layout, nav, route structure for:
  - onboarding, services, pricing, widget, branding, quotes, analytics, billing, settings
- Empty state components
- Consistent UI scaffolding

## Out of scope
- Actual forms and business logic

## Acceptance criteria
- [x] All dashboard routes render without errors
- [x] Navigation works
- [x] Auth guard enforced

## Completed
**Date:** 2026-01-25

### Implementation Notes

**Layout and Navigation:**
- `apps/web/src/app/(dashboard)/layout.tsx` - Client-side sidebar navigation with mobile responsiveness
- Collapsible sidebar on mobile with hamburger menu
- Active state highlighting using `usePathname`
- Navigation sections: Overview, Configuration, Operations

**Shared Components:**
- `apps/web/src/components/dashboard/EmptyState.tsx` - Reusable empty state, page header, and "Coming Soon" badge

**Dashboard Pages Created:**
1. `/app` - Main dashboard with stats cards, quick actions, and setup reminder
2. `/app/onboarding` - 5-step setup checklist with progress bar
3. `/app/services` - Services placeholder with empty state
4. `/app/pricing` - Pricing rules placeholder with empty state
5. `/app/widget` - Widget configuration with embed code preview (functional)
6. `/app/branding` - Branding placeholder with empty state
7. `/app/quotes` - Quotes list placeholder with filters UI
8. `/app/analytics` - Analytics placeholder with stats cards
9. `/app/billing` - Billing placeholder with plan info and usage stats
10. `/app/settings` - Settings placeholder with form sections (business info, tax, service area, danger zone)

**Auth Guard:**
- Middleware at `apps/web/src/middleware.ts` enforces auth for `/app/*` routes
- Redirects unauthenticated users to `/login`