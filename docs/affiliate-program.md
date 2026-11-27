# Affiliate program: implementation and release

Runtime update, 27 November 2026: the configured databases have now received the
five Main feature SQL migrations and the Team role/username migration to repair
the running dashboard's missing-column error. See Team Backend's
`docs/affiliate-runtime-migrations-20261127.md`. Existing Prisma history is not
baselined; do not blindly rerun migration deployment against these databases.
The "not run against production" statements below describe the earlier isolated
implementation verification, before this subsequent runtime repair.

## Architecture

Affiliate accounts use the existing Team Supabase session and `TeamMember` role.
There is no public signup or separate authentication system. Financial data lives
in Main DB, alongside `Voucher` and `Payment`. Team Backend uses its existing Main
DB bridge pattern to administer these records; both Nest checkout and student
Next server routes invoke the same PostgreSQL pricing functions.

`AffiliateProfile.id` is the Team member ID; `userId` identifies its Supabase Auth
user. These are external identities in a separate database, so a cross-database
foreign key is unavailable. All Main DB affiliate relationships have restrictive
foreign keys. Member lifecycle writes synchronize the profile; uncertain failed
Team transactions disable the mirror. An administrator can retry the status
update with its authoritative current value to reconcile it. Check logs for
`Affiliate identity reconciliation required` after a database outage.

## Data changes

| Entity | Purpose |
| --- | --- |
| AffiliateDefaults | Central initial commercial defaults, in basis points |
| AffiliateProfile | External Team identity and active state |
| AffiliateTerms | Immutable, effective-dated per-affiliate configuration |
| AffiliateQuota | One allocation per affiliate / Jakarta month / boost type |
| AffiliateBoost | Immutable activation with frozen rates, duration and cap |
| AffiliateAgreement | Owner-managed draft or immutable published version |
| AffiliateAcceptance | Personalized immutable content, identity, SHA-256 and server timestamp |
| AffiliateCheckout | Immutable price, attribution, rates, boosts and expiry |
| AffiliateLedger | Commission and cumulative refund adjustment journal |
| AffiliatePayout | Manual payout, reservation and settlement tracking |
| AffiliateAudit | Immutable administrative and financial events |

`Voucher.affiliateId` is optional. `affiliateAssignedBy` identifies the Team actor.
`Payment.affiliateCheckoutId` is optional and unique. Existing unassigned vouchers
and historical payments keep their behavior and receive no retroactive attribution.
Prisma now reads the `prisma/` schema directory; affiliate models are separated in
`prisma/affiliate.prisma`.

## Business rules

- Initial discount is 1,500 bps (15%); commission is 1,000 bps (10%). Defaults exist
  only in the database seed. Admin UI reads configuration rather than duplicating defaults.
- Existing campaign pricing is applied first. This resulting amount is the
  eligible original amount for referral calculations. Existing minimum purchase,
  positive discount cap, expiry, usage limit and active status continue to apply.
- All amounts use the existing whole-IDR representation. Discount and commission
  use PostgreSQL `round` for nonnegative amounts. Rp11,000 gives Rp1,650 discount,
  Rp9,350 payment, Rp935 commission and Rp8,415 retained revenue before expenses.
  Retained revenue is not net profit.
- Boost additions are percentage points. Defaults are +500 / +500 / +1,000 bps,
  with monthly allocations 10 / 10 / 5, each lasting 24 server-timed hours.
- One commission and one discount boost can coexist. Discount variants share a
  category. Profile row locks serialize activation, quota deduction and checkout
  reservations. Stable request keys make retried activations idempotent.
- An active boost freezes its base rate, addition, expiry and optional transaction
  cap. Configuration changes cannot rewrite that benefit.
- Quotas are allocated lazily, exactly once per Jakarta calendar month. The
  allocation uses terms at month start, or account creation for a new affiliate.
  Unused and bonus quota do not carry over. Active boosts survive the boundary.
  No cron, automatic renewal, cancellation, pause or extension is needed.
- Commercial configuration revisions require a published agreement that the
  affiliate has not already accepted. They take effect after their configured
  timestamp and acceptance. Existing monthly allocation stays fixed; bonus quota
  is the explicit way to add activations this month.
- A checkout freezes attribution and rates for its existing 15-minute window.
  Gateway expiry is derived from the snapshot for affiliate purchases. A new
  checkout obtains current rates. Reassignment never changes an existing snapshot.
- Transaction caps reserve slots while a gateway outcome remains uncertain.
  A local cancellation or local clock expiry alone does not free an existing
  payment's slot; verified terminal gateway status releases it. Orphan reservations
  without a payment expire with the checkout. This favors honoring paid snapshots
  and preventing concurrent cap abuse.
- Commission is journaled by the payment-confirmation trigger in the same
  transaction. A unique event key prevents duplicate callbacks from earning twice.
- Refunds use the verified cumulative Midtrans refund total. Repeated and older
  notifications cannot reverse twice. The ledger retains cumulative refund amounts,
  including zero-value commission adjustments caused by rounding.
- Pending commission means an estimate for an unexpired pending checkout; it is
  not earned. Generated sales show successful payment amounts before refunds;
  earned commission includes refund adjustments. Paid and outstanding balances
  are lifetime figures, while date filters scope performance and journal trends.
- Manual PENDING payouts reserve balance. PAID payouts settle it. Only PENDING
  can transition to PAID or CANCELLED. Unique references and request keys prevent
  duplicate settlement; a profile lock prevents concurrent overspending.
- A refund after payout may leave a negative outstanding balance. History remains
  intact and further payouts are blocked; recovery policy awaits Owner approval.

## Agreement and authorization

Only System Owner manages drafts, versions and publishing. The supplied draft
contains all 16 requested sections and explicit `OWNER_REVIEW` placeholders.
Publishing rejects unresolved placeholders, a missing contracting party or a
missing effective date. No legal identity or final payout/legal clauses are invented.

The editor supports safe Markdown headings, bold and lists with document preview.
Raw HTML remains escaped React text; it is never rendered through an HTML sink.
Acceptance verifies a hash of the preview again inside a transaction, then stores
the personalized content with the actual database timestamp and SHA-256 hash.
An unchecked acknowledgment is mandatory. Historical acceptances are immutable.
New required versions gate relevant features from their effective date without
deleting prior earnings. No IP address or user agent is collected.

Team Backend's global boundary denies Affiliator access to operational APIs.
Self endpoints derive identity from the session, never a client-supplied affiliate
ID. Agreement acceptance is checked by both services and financial database
functions. Next's server proxy also enforces the affiliate page boundary.
Existing internal role permissions and System Owner bootstrap restrictions remain.
Username login is an alias for existing Supabase password verification, with a
shared database throttle; passwords are neither stored by Team nor returned.

New tables have RLS enabled and no browser policies. Affiliate functions revoke
PUBLIC, anon and authenticated execution. Runtime DB connections must use the
existing trusted server role with appropriate table/function access and RLS bypass
or server-only policies. Never grant these operations to browser roles.

## Migration and deployment

1. Review backups and `prisma migrate status` for each target database. Confirm
   that the existing migration history is correctly baselined. Do not use reset,
   destructive `db push`, or recreate an existing production database.
2. Apply Main DB migrations `20261127000100_affiliate_tables` through
   `20261127000500_affiliate_integrity` through the established migration pipeline.
   The normal command is `npx prisma migrate deploy` in `jitu-backend` once the
   existing history has been verified. These migrations add nullable integration
   columns, new tables/functions/indexes/triggers, defaults and an unpublished draft.
3. Apply Team DB `20261127000100_affiliator_role` in `team-backend` using
   `npm run db:deploy`. It adds the enum value, optional unique username and a
   server-only sign-in throttle table. Run `npm run db:generate` before its build.
4. Deploy both backends and both frontends. Team Backend's
   `JITU_CONTROL_CENTER_DATABASE_URL` (or purchases fallback) must point to the
   same Main DB used by both payment implementations. Retain existing Supabase,
   trusted origin, Team API and Midtrans configuration.
5. Do not assign affiliate codes until all four services support snapshots. Owner
   reviews and publishes the agreement, creates an affiliate through Team, and
   completes an authenticated acceptance and a Midtrans sandbox purchase/refund.
6. Verify gateway callback routing, duplicate callback behavior and manual payout
   tracking in the target environment before general rollout.

Migrations were tested only against freshly created, isolated localhost databases.
They have **not** been run against production. Real Supabase credential creation
and live Midtrans payment/refund calls have not been exercised. Test adapters use
local fixtures and never install production mock financial data.

For rollback, stop new affiliate assignments and disable affiliate access while
keeping financial tables, snapshots, published agreements and ledgers. Do not drop
these migrations or delete historical records. Keep a payment implementation that
understands snapshots and refunds available for existing orders.

## Verification

Run `npm run test:affiliate` in Main Backend for real PostgreSQL rule, expiry,
monthly allocation, refund, race-condition and payout tests. The runner only
accepts localhost and creates/drops its own random test database. It defaults to
`postgresql://postgres@127.0.0.1:5432/postgres`; set
`AFFILIATE_TEST_DATABASE_URL` to a local administrative test connection if needed.

Run the existing Jest shop suite with
`npm test -- --runInBand src/modules/shop`. Team service tests and student
checkout tests reuse the Main Backend test fixture; their individual runbooks
describe the sibling-repository path override. All new source files are modular.

## Owner decisions still required

- Authorized contracting party identity and review of all final legal clauses.
- Payout schedule, minimum amount, tax/withholding, financial settlement/hold
  policy, and treatment of a negative balance after already-paid commission.
- Marketing, fraud, dispute, termination, confidentiality and retention policy.
- Whether System Owner account creation should ever move beyond the existing
  bootstrap-only policy. This implementation preserves that permission boundary.

Protocol references: [Midtrans cumulative refunds](https://docs.midtrans.com/docs/get-status-api-requests),
[Core expiry](https://docs.midtrans.com/reference/custom-expiry-object),
[Snap expiry](https://docs.midtrans.com/reference/json-objects), and
[Prisma multi-file configuration](https://docs.prisma.io/docs/orm/reference/prisma-config-reference).
