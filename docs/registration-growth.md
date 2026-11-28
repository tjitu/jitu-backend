# Registration & Growth

Free registrations can require participant social declarations followed by manual Team review. Verification is separate from payment and attempt status. Pending/rejected submissions create no exam attempt; approval creates one `NOT_STARTED` attempt and existing scheduling/question-release checks still apply. Existing registrations are grandfathered. Disabled growth and paid registration preserve the previous flow.

## Database and rollout

The Main database owns `TryOut.growthConfig/growthVersion/growthUpdatedBy`, `TryoutRegistrationVerification`, `TryoutVerificationHistory`, and `TryoutGrowthEvent`. Schema declarations are in `prisma/schema.prisma` and `prisma/growth.prisma`.

Apply these additive SQL migrations in order before deploying any of the four applications:

1. `20261128000100_registration_growth`: configuration, private records, validation, audit.
2. `20261128000200_growth_registration`: own state, idempotent submit/resubmit, admission, access gate, paid reconciliation.
3. `20261128000300_growth_review`: administrator decisions, telemetry, metrics, privilege restrictions.
4. `20261128000400_growth_configuration_guard`: normalized configuration and strict string validation on writes.

These four migrations were applied to the configured Main Supabase database on 28 November 2026. Before/after counts remained 27 tryouts, 143 attempts and 21 payments; zero existing tryouts had growth enabled. The database has no existing public Prisma migration baseline. Do not run a blind reset/deploy or invent a baseline; reconcile migration history separately before adopting Prisma deployment automation. Applied SQL must remain immutable.

All three new tables use RLS and revoke public/anonymous/authenticated access. Functions are server-only operations with public/anonymous/authenticated execution revoked. Application server database roles must be permitted to execute them and access their tables; browser Supabase keys must never receive these privileges.

## API and invariants

- Authenticated `POST /tryout/:id/register` accepts existing mode/expected price plus optional `growth`: normalized Instagram username, checklist, UUID requestKey/sessionId, configVersion and resubmission version.
- `GET /tryout/:id/growth` returns only the session user's submission and participant-safe history. `POST /tryout/:id/growth/events` accepts only client event types.
- Both Core Nest and student Next registration use the same PostgreSQL functions. User-row locking, uniqueness and compare-and-swap revisions serialize retries, concurrent admin decisions, and free/paid registration.
- Admin identity comes from fresh Team Owner/Admin membership. Participant and admin checklists remain separate; required admin checks must be confirmed. Rejection requires reasons. Partial progress and every resubmission/decision are audited.
- Pending requirements retain a configuration snapshot. Later edits apply to new submissions/resubmissions, preserving what an existing pending participant agreed to.
- Real paid entitlement can resolve an existing pending submission, with method `PAID`; it never claims verified Instagram activity. A zero-price request named `PREMIUM` cannot bypass verification.
- `assertGrowthAccess` blocks Core exam start/question delivery. Sandbox and existing QC governance remain intact. Prisma 7 adapter errors are mapped to safe 400/403/404/409 responses.

## Configuration

Use Team Control Center → create/edit tryout → **Registration & Growth**. Configure Social Engagement, manual review, profile/campaign URLs, each enabled/required checklist item and mention requirement. URLs must be valid HTTPS Instagram profile/post URLs. Prize announcement and community invitation are independent toggles; both default off. Winner count defaults to 5 and prize type to Saldo E-Wallet. Community URLs must use HTTPS. Saving validates the complete configuration and its revision atomically with the tryout edit. Participants fetch current settings when opening registration; no redeployment is needed.

The Team API optionally accepts server-only `JITU_COMMUNITY_URL` as the initial community URL for new configurations. It does not enable the invitation automatically. All persisted tryout overrides remain authoritative.

## Analytics and limits

Server events: `registration_submitted`, `registration_approved`, `registration_rejected`, `registration_resubmitted`. Client events: `registration_button_clicked`, `social_engagement_modal_viewed`, `social_engagement_link_clicked`, `social_engagement_modal_abandoned`, `community_invitation_clicked`, plus `community_invitation_viewed` for the CTR denominator. Client events are bounded and deduplicated; clients cannot submit canonical decision events.

Conversion/abandonment use registration sessions, approval/rejection use current decided submissions, turnaround uses decision timestamps, and community CTR uses invitation-view sessions. These are measurements of application behavior. Participant declarations are not independently verified engagement; community clicks are not confirmed membership.

Instagram review is manual. Private accounts and unavailable Stories need administrator judgment; elapsed Story time never automatically rejects a registration. No Instagram credentials, screenshot uploads, scraping, or Instagram API automation are introduced. No existing outbound registration notification service was available; student status polling and in-app notifications are used while relevant UI is open.

## Verification

`npm run test:growth` builds production code and runs 20 localhost PostgreSQL/Prisma tests covering lifecycle, snapshots, concurrency, access, roles at the database boundary, invalid configuration, analytics and real Prisma 7 error mapping. `GROWTH_TEST_DATABASE_URL` defaults to localhost PostgreSQL and is explicitly forbidden from pointing to a remote host. Tests create and drop isolated databases; they never create accounts in shared Supabase.

The existing Tryout/Exam Jest suites pass 32 cases. Main FE adds 13 API/render tests; Team BE adds 7 authenticated-administrator service tests; Team FE adds 4 configuration-derived UI tests. A separate isolated Chromium harness exercised actual student components/Next handlers, Team components/admin services and PostgreSQL through submission → rejection → correction → resubmission → approval, Save & Next, external-tab preservation, optional flags, mobile/dark mode and keyboard interaction. Only session identity was substituted in that local harness; live Supabase login and Instagram checks were not automated.

See `registration-growth-files.md` for the implementation inventory and the corresponding documentation in the other three repositories.
