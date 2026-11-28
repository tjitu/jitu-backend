# Free registration & growth

Free registration now always starts with WhatsApp number, contact email and school, followed by Instagram username and social declarations. The campaign URL determines the requirements automatically:

- Empty campaign URL: follow @jituptn and join Komunitas JITU are required.
- Campaign URL present: follow @jituptn plus the configured like/tag/Story/mention requirements.

Follow and Instagram username are mandatory in both modes, including when manual review is disabled. The UI says ?Ceklis jika sudah.? Community mode reminds participants to use the same phone number as their bio. Existing paid registrations and sandbox preview retain their previous behavior; already registered attempts are grandfathered.

## Data and invariants

`TryoutRegistrationVerification.contactDetails` stores normalized WhatsApp, contact email and school for each submission. WhatsApp/school also update the existing user profile atomically on successful submission. Contact email never rewrites the login email. Submission/resubmission snapshots remain in `TryoutVerificationHistory`; retries cannot overwrite submitted personal data. Own status is private, and administrators see registration contact details for manual review.

Manual submissions remain PENDING_VERIFICATION with no attempt. Owner/Admin checks are independent from participant claims. Partial progress never grants access, rejection requires reasons, resubmission retains history, and approval creates one NOT_STARTED attempt. Existing schedule/question-release checks still apply. Checklist-only and real paid access never claim verified Instagram engagement.

## Global community destination

`TryoutGrowthSettings` is a singleton Main DB setting: communityUrl, revision, updatedBy and updatedAt. Initial URL is the WhatsApp invitation supplied by the owner on 28 November 2026. Owner/Admin can change it in Team ? Control Center ? Edit/Create Tryout ? Registration & Growth ? **Link Komunitas JITU (global)** ? **Simpan link global**.

There are no per-tryout URL overrides or environment-variable defaults. Every tryout resolves the current global destination dynamically, including pending outcomes. Required checklists retain their submission snapshot, while their community destination remains current. Stale community forms are rejected by the global revision check and must reload; browser drafts clear the old community declaration when the destination changes. Global edits use optimistic concurrency and fresh administrator authorization.

## Migrations and deployment

The original four `20261128000100`?`20261128000400` migrations introduced verification/history/events and privileged shared registration/review functions. They are immutable and were already applied.

The revised flow adds three migrations, applied in order in one transaction:

1. `20261128000500_free_registration_configuration`: private global settings, current URL resolution, contactDetails column and automatic configuration rules.
2. `20261128000600_free_registration_details`: personal-data validation/persistence, mandatory Instagram, community assertions and stale-link protection.
3. `20261128000700_community_registration_review`: independent community review, community telemetry link type, existing tryout normalization and server-only privileges.

These three migrations were applied to the configured Main database on 28 November 2026, preserving 27 tryouts, 155 attempts and 21 payments.

The third migration enables the new requirements on existing tryouts and increments their configuration revisions; existing attempts/payments and pending snapshots remain intact. Deploy the database functions before enabling the updated applications. The configured database has no public Prisma migration baseline: do not run reset/blind deploy or invent baseline records. Use reviewed additive SQL and reconcile migration history separately.

All four feature tables use RLS and revoke PUBLIC/anon/authenticated privileges. All growth_* functions revoke browser/public execution. Only authenticated application servers with appropriate database permissions call them. Do not grant privileged functions to browser Supabase roles.

Core `POST /tryout/:id/register`, own GET `/growth`, client POST `/growth/events` and student Next equivalents share the same database rules. Transactions, unique user/tryout records, request IDs and revision checks protect concurrent submit/review/payment operations. Core exam start and question delivery enforce approval and map real Prisma 7 driver errors to safe HTTP responses.

## Analytics and verification

Server decisions/submissions and bounded, deduplicated client events provide conversion, abandonment, decision rates, review turnaround and community CTR. Declarations/clicks do not prove Instagram engagement or community membership. Instagram/community review is manual; private accounts and expired Stories require judgment and never trigger automatic rejection. Participant notifications use visible-page polling and in-app messages; no outbound notification integration was available.

`npm run test:growth` builds and tests isolated localhost PostgreSQL with real Prisma 7: lifecycle/concurrency, profile validation, contact snapshots, automatic modes, mandatory follow/username, global URL propagation/revisions, authorization boundaries, private tables/functions, analytics and exam gates. Tests reject remote database URLs, create/drop temporary databases, and never create shared Supabase users. The Core Tryout/Exam Jest suites additionally cover existing registration and scheduling behavior. Frontend/admin suites and an isolated Chromium harness cover actual components, Next handlers and Team services through profile ? requirements ? pending ? reject/resubmit ? approve, global link editing, Save & Next, external tabs, mobile/dark mode and keyboard/Escape. Real Firebase/Supabase identity was substituted only in the local browser harness; external engagement is manual.

See `registration-growth-files.md` for implementation files.
