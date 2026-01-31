# tickets/T-003-auth-tenant-creation.md

## Goal
Implement signup/login and tenant creation flow (single admin user per tenant for v1).

## In scope
- Supabase Auth integration in `apps/web`
- Signup and login pages
- On first login, create tenant + link user to tenant
- Simple `/api/me` endpoint in Worker to return user context
- Basic dashboard route guard

## Out of scope
- Roles beyond admin
- Team invites

## Acceptance criteria
- [x] User can sign up and log in
- [x] On first login, tenant is created and linked
- [x] Visiting `/app` without auth redirects to `/login`
- [x] `GET /api/me` returns `{ userId, tenantId, role }` for authenticated user

## Completed
- 2026-01-25: Initial implementation complete
  - Created migration for `tenants` and `user_profiles` tables with RLS policies
  - Implemented `/login` page with email/password auth
  - Implemented `/signup` page that creates user and tenant
  - Implemented `/setup` page for OAuth users who need to complete tenant setup
  - Implemented `/auth/callback` route for OAuth/magic link handling
  - Implemented `/api/auth/setup-tenant` for tenant creation
  - Implemented `/api/auth/signout` for logout
  - Implemented `/api/me` endpoint returning user context
  - Created dashboard layout with auth guard and nav
  - Created `/app` dashboard page with welcome message
  - Middleware protects `/app/*` routes and redirects to `/login`
  - Middleware redirects authenticated users from `/login`/`/signup` to `/app`
