# BankGuard — Milestone 2: Database Design & Backend Architecture

**Document version:** 1.0
**Status:** Deliverable for review — do not proceed to Milestone 3 (Git remote setup will happen once you push this locally-initialized repo to GitHub) until approved

---

## 1. Deliverables in this milestone

1. ERD explanation and diagrams (see chat — three diagrams: Auth/RBAC, Banking Core, Fraud Detection)
2. Complete MySQL schema — `schema.sql` (also copied into the backend skeleton at `backend/database/schema.sql`)
3. Backend folder structure — scaffolded and zipped (`backend_skeleton.zip`), explained folder-by-folder in `backend/README.md`
4. Git repository — initialized locally with `main` and `develop` branches and the requested initial commit
5. Environment configuration — `.env.example` in the skeleton
6. This document
7. Interview questions (section 6 below)

---

## 2. Database design decisions worth understanding, not memorizing

**Why DECIMAL(18,2) for money, never FLOAT or DOUBLE.** Floating-point types use base-2 representation and cannot exactly represent most base-10 decimals — `0.1 + 0.2` literally does not equal `0.3` in IEEE 754 arithmetic. In a ledger, that rounding error compounds across millions of transactions into real, unexplainable discrepancies. `DECIMAL` stores an exact base-10 value. This is one of the most common interview questions for any backend-with-money role — you should be able to explain it without notes.

**Why every foreign key defaults to `ON DELETE RESTRICT`, not `CASCADE`.** In most CRUD apps, cascading deletes are convenient. In a banking system, they're dangerous: deleting a customer should never be able to silently delete their transaction history — that history has to survive for audit and compliance purposes even after an account is closed. `RESTRICT` forces the application to make deletion an explicit, deliberate, usually soft (`status = 'closed'`) operation rather than something that happens as a side effect. The only place `CASCADE` is used is `role_permissions`, a pure join table with no independent meaning.

**Why `risk_scores` uses two nullable FKs plus a CHECK constraint instead of a polymorphic reference.** A common shortcut is a single `reference_type` + `reference_id` pair that can point at either a login attempt or a transaction. MySQL can't enforce a real foreign key against a "sometimes this table, sometimes that table" reference — so integrity would depend entirely on application code getting it right, forever. Two nullable, real foreign keys plus a `CHECK` that exactly one is set gives up a small amount of schema elegance in exchange for the database itself guaranteeing you can never have an orphaned or ambiguous risk score.

**Why `triggered_rules` on `risk_scores` is JSON instead of a join table.** This is the one deliberate denormalization in the schema, and it's worth being able to defend *as* a deliberate choice, not an oversight. The rules that fired for a given score are written once at creation time and read back as a whole for display — there's no MVP requirement to query "every score where rule X fired" relationally. A join table that's always read as a unit and never queried by its parts is a case where JSON is the more honest model of how the data is actually used. If that query need shows up later, it's a straightforward migration to split it out — which is itself worth mentioning: this is not a permanent decision, it's a reversible one made because reversing it later is cheap and over-normalizing now has a real cost (extra joins on a table that's read on every fraud dashboard load).

**Why `reference_code` on `transactions` is unique.** This is an idempotency key. If a transfer request is retried — a customer double-taps "confirm," a mobile network blips and the client retries — the service layer checks this constraint before inserting, so a network hiccup can never become a double transfer. This is how real payment systems (Stripe, most banking APIs) prevent duplicate charges, and it's a detail that signals you've thought about failure modes, not just the happy path.

**Why `audit_logs` has no application-level UPDATE/DELETE path, enforced ideally at the database user-privilege level too.** FR-AUDIT-02 required append-only logs. Enforcing that only in application code (e.g., "the audit controller just doesn't have an update endpoint") is one layer of defense; a bug or a compromised admin credential could still issue a raw `UPDATE audit_logs`. When you provision the actual MySQL user for the app in Milestone 4, granting it `SELECT, INSERT` only on `audit_logs` — no `UPDATE`, no `DELETE` — makes the append-only guarantee true at the database engine level, which is a much stronger claim to be able to make in an interview than "the API doesn't expose it."

**Why fraud case linking uses join tables (`fraud_case_alerts`, `fraud_case_transactions`) instead of a foreign key on the case.** A single fraud investigation often spans multiple suspicious events and multiple transactions — that's a many-to-many relationship by nature, and a single FK column can't express it. This also means a security alert *could* theoretically belong to more than one case in edge scenarios (rare, but the schema doesn't artificially forbid it), which is more honest than forcing a one-case-per-alert constraint that reality doesn't respect.

---

## 3. Backend folder structure — summary

Full explanation lives in `backend/README.md` inside the skeleton. In short: `routes → controllers → services → repositories`, strictly one-directional, matching Phase 1 §7.1. The `fraud-engine/` folder is where the `IScoringEngine`-style abstraction from Phase 1 §7.4 physically lives — `rules/` will hold one file per fraud rule, each implementing the same interface, which is what makes a future `ai-engine.js` a drop-in addition rather than a rewrite. `notifications/channels/` follows the same pattern for FR-NOTIF-04.

Nothing in the skeleton contains business logic yet — every source folder currently holds only a `.gitkeep` placeholder, `app.js` and `server.js` are stubs with comments describing what gets wired in at Milestone 4, and the only "real" files are configuration (`package.json`, `.env.example`, `.gitignore`) and the database schema. This matches the milestone's explicit instruction not to write logic yet.

---

## 4. Git workflow — what's already done, what's next

The skeleton has a local Git repository initialized with:
- `main` branch (production-ready, never committed to directly going forward)
- `develop` branch (integration branch — this is where Milestone 3+ feature branches will merge)
- Initial commit: `chore: initialize BankGuard project structure`

**What you'll do once you download this:** create a GitHub repository, then from inside the extracted `backend/` folder:

```bash
git remote add origin https://github.com/<your-username>/bankguard.git
git push -u origin main
git push -u origin develop
```

From Milestone 3 onward, every new piece of work branches from `develop` as `feature/<name>` (e.g. `feature/jwt-authentication`), following the convention documented in Phase 1 §9.

---

## 5. Environment configuration — why secrets never go in Git

`.env.example` is committed; `.env` is git-ignored and never committed. The reason isn't just convention:

- A JWT signing secret committed to a public (or even private-but-later-public) repo means anyone with repo access — including anyone who ever forks or clones it, forever, since Git history doesn't truly delete — can forge valid authentication tokens for your entire system.
- Database credentials committed to Git mean anyone with repo access can connect directly to your database, bypassing every application-layer control (RBAC, validation, audit logging) you built.
- GitHub and other platforms actively scan public commits for leaked credentials, and leaked cloud/database credentials get exploited within minutes of being pushed — this is not a theoretical risk.

`.env.example` solves the real problem (a new developer, or you six months from now, needs to know *what* variables exist) without creating the actual risk (their real values existing in version control).

---

## 6. Interview questions this milestone should prepare you to answer

1. *"Walk me through what happens in the database when a transfer is submitted."* — Answer using the `transactions` table's dual FKs, the `DECIMAL` type choice, and the `reference_code` idempotency constraint.
2. *"Why did you choose RESTRICT over CASCADE on most foreign keys?"* — Answer using the "deletions should be deliberate, not a side effect" reasoning in section 2.
3. *"How does your schema support adding an AI fraud model later without a redesign?"* — Answer using `risk_scores.triggered_rules` being engine-agnostic and `fraud_rules.weight` being data, not code.
4. *"How do you guarantee audit logs can't be tampered with, not just that the UI doesn't offer an edit button?"* — Answer using database-level privilege restriction, not just application routing.
5. *"Why is `risk_scores` linked to either a login attempt or a transaction, but never both, and never neither?"* — Answer using the CHECK constraint and why a polymorphic FK was rejected.
6. *"What would break if you'd used FLOAT for account balances, and after how long would you likely notice?"* — Answer using floating-point rounding accumulation; the honest answer is "it would look fine for a while, then someone's cent-level reconciliation would never balance."

---

## 8. What's next — Milestone 3 preview

Once you approve this milestone, Milestone 3 is the first milestone with real code: setting up the Express application skeleton for real (dotenv loading, the MySQL connection pool in `src/config/`, centralized error handling middleware, and the correlation-ID/audit logging middleware) — still no feature logic, but the plumbing every feature after it depends on. Milestone 4 after that is Authentication, the first feature module.

---

## 9. Architecture review addendum (post-review, pre-approval)

A formal review was run against 8 enterprise criteria before sign-off. Full findings:

| # | Criterion | Result |
|---|---|---|
| 1 | snake_case naming throughout | Pass — no changes needed |
| 2 | created_at/updated_at on mutable entities | 3 gaps found and fixed: `beneficiaries`, `security_alerts`, `notifications` |
| 3 | Soft deletion (`deleted_at`) on users/customers/accounts | Already present, correctly scoped (absent from `transactions`/logs, where it must never appear) |
| 4 | Transaction lifecycle states incl. FLAGGED | Already correct — `flagged` modeled as a genuine settlement hold, not a cosmetic flag |
| 5 | Currency support | Already present — `CHAR(3)` + `CHECK`, not `ENUM`, so adding a currency is a data change, not a migration |
| 6 | FK/index/constraint review | 2 gaps found and fixed: reverse-lookup indexes on `fraud_case_alerts`/`fraud_case_transactions` |
| 7 | Compatibility with JWT, RBAC, fraud detection, audit, future AI scoring, reporting | Confirmed — see below |

**Compatibility confirmation (criterion 7), reasoned through explicitly rather than asserted:**

- **JWT authentication:** `refresh_tokens.token_hash` and `sessions` give the server-side revocation JWTs alone can't provide (NFR-SEC-13). Nothing in the schema assumes JWTs — it stores what the auth *service* needs, independent of token format.
- **RBAC:** `roles` → `permissions` → `role_permissions` → `user_roles` is a standard normalized RBAC shape, extensible to fine-grained permissions beyond the four current roles without a schema change — just new rows.
- **Fraud detection:** `fraud_rules.weight` is data, not code, so tuning doesn't require a deploy; `risk_scores` cleanly separates login-triggered from transaction-triggered scoring via the `CHECK`-enforced exclusive FK pair.
- **Audit logging:** `audit_logs` is structurally append-only (see section 2's note on database-level privilege enforcement), separate from `security_logs` per NFR-LOG-02.
- **Future AI fraud scoring:** nothing in `risk_scores` or `fraud_rules` assumes a rule-based origin — a future AI Engine writes to the same `risk_scores` table with its own `triggered_rules` payload (e.g. feature importances instead of rule codes), no migration required. This is the schema half of the Phase 1 §7.4 abstraction.
- **Reporting:** `reports` records what was generated and by whom; the actual data reporting draws from is already relationally queryable (transactions, cases, audit logs) — no reporting-specific denormalization was added because none is needed yet, and adding one speculatively would violate "don't redesign unnecessarily."

## 10. Final Milestone 2 approval checklist

- [x] ERD explained and diagrammed (3 diagrams: Auth/RBAC, Banking Core, Fraud Detection)
- [x] Full MySQL schema — 26 tables, normalized, with documented deliberate denormalization (`risk_scores.triggered_rules`)
- [x] Every FK has an explicit `ON DELETE` policy (`RESTRICT` default, `CASCADE` only on pure join/owned-child tables, `SET NULL` on logs)
- [x] Money stored as `DECIMAL(18,2)`, never floating point
- [x] Transaction idempotency via unique `reference_code`
- [x] Soft delete where appropriate; hard-delete-never on financial/audit records
- [x] Currency support present, scoped correctly (no premature conversion logic)
- [x] Backend folder structure scaffolded, zero business logic present (per milestone scope)
- [x] Git repo initialized, `main` + `develop` branches, correct initial commit message
- [x] `.env.example` documents required config without exposing secrets; `.gitignore` excludes `.env`
- [x] Architecture review completed against 8 enterprise criteria — 5 gaps found, all fixed, changes committed
- [ ] **Your sign-off** — reply "approved" (or flag anything else) to begin Milestone 3
