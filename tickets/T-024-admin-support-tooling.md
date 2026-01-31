# tickets/T-024-admin-support-tooling.md

## Goal
Basic admin capabilities for support and debugging.

## In scope
- Protected admin routes (/admin/*)
- View quotes across all tenants (search by quote ID, email)
- View tenant details and subscription status
- Manually retry failed quote jobs
- Simple activity log viewer

## Out of scope
- Full admin dashboard with analytics
- Tenant impersonation (v2)
- Bulk operations

## Acceptance criteria
- [x] Admin routes protected by admin role check
- [x] Can search and view any quote by ID
- [x] Can trigger retry on failed quote
- [x] Basic audit trail visible

## Completed
**Date:** 2026-01-25

### Implementation Summary

**Middleware Updated:**

`apps/web/src/middleware.ts`:
- Added `/admin` routes to protected routes
- Admin routes require `role === 'admin'` in user_profiles
- Non-admin users redirected to /app

**Admin Helper Library:**

`apps/web/src/lib/admin.ts`:
- `verifyAdmin()` - Verify current user has admin role
- `logAdminActivity()` - Log admin actions for audit trail

**API Routes Created:**

1. `apps/web/src/app/api/admin/quotes/route.ts`
   - `GET /api/admin/quotes` - Search quotes across all tenants
   - Filter by status, tenant ID
   - Search by quote ID or customer email

2. `apps/web/src/app/api/admin/quotes/[quoteId]/route.ts`
   - `GET /api/admin/quotes/:quoteId` - Get quote details

3. `apps/web/src/app/api/admin/quotes/[quoteId]/retry/route.ts`
   - `POST /api/admin/quotes/:quoteId/retry` - Retry failed/stuck quote
   - Generates new token, updates to queued, enqueues job

4. `apps/web/src/app/api/admin/tenants/route.ts`
   - `GET /api/admin/tenants` - List/search tenants
   - Shows subscription status, quote counts

5. `apps/web/src/app/api/admin/tenants/[tenantId]/route.ts`
   - `GET /api/admin/tenants/:tenantId` - Tenant details
   - Shows stats, usage, users, services, sites

6. `apps/web/src/app/api/admin/activity/route.ts`
   - `GET /api/admin/activity` - Admin activity log
   - Filter by resource type

**Admin Dashboard Pages:**

1. `apps/web/src/app/admin/layout.tsx` - Admin layout with red header
2. `apps/web/src/app/admin/page.tsx` - Dashboard overview with quick links
3. `apps/web/src/app/admin/quotes/page.tsx` - Quotes search and retry
4. `apps/web/src/app/admin/tenants/page.tsx` - Tenants list
5. `apps/web/src/app/admin/activity/page.tsx` - Activity log viewer

**Features:**

- Search quotes by ID (qte_...) or customer email
- Filter quotes by status
- Retry failed/stuck quotes with one click
- Search tenants by ID (tnt_...) or name
- View tenant subscription status and quote counts
- Activity log shows all admin actions
- All admin actions logged for audit

**Database Requirements:**

- `user_profiles.role` must be 'admin' for admin access
- Optional: `admin_activity_logs` table for audit trail:
  ```sql
  CREATE TABLE admin_activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID REFERENCES auth.users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    details_json JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  );
  ```
