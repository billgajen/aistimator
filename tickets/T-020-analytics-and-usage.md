# tickets/T-020-analytics-and-usage.md

## Goal
Dashboard analytics and usage tracking.

## In scope
- Analytics page with quote metrics (created, viewed, accepted, paid, conversion rate)
- Usage counter display (current month vs plan limit)
- Persist usage counters in database
- Quote funnel visualization

## Out of scope
- Historical analytics/charts over time
- Export/reporting features
- Advanced filtering (date ranges)

## Acceptance criteria
- [x] Analytics page shows real quote metrics
- [x] Usage counter increments on quote creation
- [x] Usage counter increments on quote sent
- [x] Monthly usage displayed vs plan limit

## Completed
**Date:** 2026-01-25

### Implementation Summary

**API Routes Created:**

1. `apps/web/src/app/api/analytics/route.ts`
   - `GET /api/analytics` - Get analytics for current tenant
   - Returns quote metrics (total, viewed, accepted, paid, conversion rate)
   - Returns usage data (current month estimates vs plan limit)
   - Fetches from quotes, usage_counters, subscriptions, and plans tables

**Types Added:**

`packages/shared/src/api.types.ts`:
- `AnalyticsMetrics` - Quote metric counts and conversion rate
- `UsageData` - Monthly usage and plan limit info
- `AnalyticsResponse` - Combined analytics response

**Usage Tracking:**

1. `apps/web/src/lib/usage.ts` - Web app usage counter helper
2. `apps/worker/src/usage.ts` - Worker usage counter helper

Both provide:
- `getCurrentPeriod()` - Get YYYYMM format period
- `incrementUsageCounter()` - Upsert usage counter record

**Integration Points:**

1. `apps/web/src/app/api/public/quotes/route.ts`
   - Increments `estimates_created` when quote is created

2. `apps/worker/src/quote-processor.ts`
   - Increments `estimates_sent` when quote processing completes

**Dashboard Page Updated:**

`apps/web/src/app/(dashboard)/app/analytics/page.tsx`:

**Features:**
- Stats cards: Total Quotes, Quotes Viewed, Quotes Accepted, Conversion Rate
- Monthly Usage section with progress bar
- Usage bar color coding (green/yellow/red based on percentage)
- Estimates created vs sent breakdown
- Quote funnel visualization showing progression

**UI States:**
- Loading spinner while fetching
- Error state display
- Dynamic data from API
