# Affiliate verification results

Verified locally on 27 November 2026. No production migration or live financial
transaction was executed.

| Target | Verification | Result |
| --- | --- | --- |
| Main Backend | `npm run build` | Pass, including multi-file Prisma generation |
| Main Backend | `npm run test:affiliate` | 22 PostgreSQL integration/race tests pass |
| Main Backend | `npm test -- --runInBand src/modules/shop` | 15 Jest unit/regression tests pass |
| Team Backend | `npm run build` | Pass |
| Team Backend | `npm run test:affiliate` | 13 service/access/lifecycle/database tests pass |
| Team Backend | `node --test test/tryouts-controller.test.cjs` | 2 existing authorization/regression tests pass |
| Team Frontend | `npm run build` | Pass with Turbopack |
| Team Frontend | `npm run test:affiliate` | 2 renderer/rate tests pass |
| Student Frontend | `npm run build -- --webpack` | Pass |
| Student Frontend | `npm run test:affiliate` | 5 real-database checkout/refund tests pass |
| Student Frontend | `node tests/payment-status.test.cjs` | Existing ownership, fraud and concurrent confirmation assertions pass |
| Browser QA | Actual component code, local DB fixtures, headless Chrome | Desktop/mobile/dark layouts, contained table scrolling, boost confirmation, and initially unchecked acknowledgment pass |

The 59 named automated tests above are targeted suites, not a claim that every
unrelated repository test was run. Test databases use random names on localhost
and are dropped by the test runner. Both Main financial migrations and the Team
role/username/throttle migration were exercised there. Supabase sign-in forwarding
and gateway checkout use isolated test adapters; real credentials and live gateway
behavior still require the target-environment smoke test in the release runbook.

Student Turbopack could not resolve the shared dependency junction outside the
isolated worktree's root. Its TypeScript check and Webpack production build passed;
the regular production dependency installation is unchanged.

Browser QA corrected scoped primary-button contrast and mobile sidebar/grid
conflicts with existing global styles. Agreement raw HTML remains escaped text.
Each repository's `docs/affiliate-files.md` lists its modified and new files.
