# /docs/05-acceptance-tests.md

## Acceptance tests are written as user outcomes
These are the v1 definition of done checks.

### Signup and onboarding
- [ ] User can sign up and create a tenant
- [ ] User can complete onboarding checklist
- [ ] User can enter a domain and generate an embed snippet
- [ ] User can run a test submission and receive a quote link

### Pricing config
- [ ] User can create a service
- [ ] User can set base fee, minimum, add ons, multipliers
- [ ] User can set currency and tax label and rate
- [ ] User can configure service area restriction (postcode or zip, county or state)
- [ ] Quote generation respects restriction rules

### Widget
- [ ] Widget can be embedded via JS snippet
- [ ] Widget can be embedded via iframe mode
- [ ] Widget collects answers plus photos and documents
- [ ] Widget blocks submission if required fields missing
- [ ] Uploads succeed and files are attached to the quote

### Quote generation and delivery
- [ ] Quote request enqueues job and returns a quote view URL
- [ ] Hosted quote page renders correctly with mandatory sections
- [ ] Optional sections can be toggled on or off
- [ ] PDF can be generated and downloaded if enabled
- [ ] Customer and business receive email with quote link

### Customer actions
- [ ] Customer can open hosted quote page without login
- [ ] Customer can accept quote
- [ ] If Stripe enabled, customer can initiate payment and paid status updates

### Analytics and usage
- [ ] Dashboard shows counts: created, viewed, accepted, paid
- [ ] Dashboard shows plan usage against monthly limit

### Security
- [ ] Public endpoints are rate limited
- [ ] Tenant data isolation is enforced
- [ ] File access is private by default