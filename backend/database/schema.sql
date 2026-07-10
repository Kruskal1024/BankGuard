-- ============================================================================
-- BankGuard — MySQL Database Schema
-- Milestone 2 deliverable
--
-- Conventions used throughout:
--   - snake_case for tables/columns (NFR-MAINT-01 naming convention)
--   - Every table has created_at; mutable tables also have updated_at
--   - InnoDB engine everywhere (required for foreign keys + transactions)
--   - utf8mb4 for full Unicode support (emoji, non-Latin names, etc.)
--   - Sensitive columns never store plaintext (password_hash, token_hash)
--   - ON DELETE RESTRICT is the default on financial/audit FKs — we never
--     want a customer or transaction to vanish because of a cascading
--     delete; deletions in a banking system should almost always be
--     soft (status = 'deleted') not physical.
-- ============================================================================

CREATE DATABASE IF NOT EXISTS bankguard
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE bankguard;

-- ============================================================================
-- SECTION 1: AUTHENTICATION & RBAC
-- ============================================================================

CREATE TABLE users (
  user_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,           -- Argon2 hash, never plaintext
  status          ENUM('active','suspended','locked') NOT NULL DEFAULT 'active',
  failed_login_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until    DATETIME NULL,                    -- NFR-SEC-18 brute-force lockout
  password_changed_at DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,                    -- soft delete; NULL = active record
  CONSTRAINT uq_users_email UNIQUE (email),
  INDEX idx_users_deleted (deleted_at)
) ENGINE=InnoDB;
-- Soft delete note: uq_users_email stays a full-table unique constraint, so
-- a soft-deleted user's email is NOT immediately free for re-registration.
-- This is a deliberate tradeoff, not an oversight: banking/KYC records are
-- rarely re-issued to a new identity anyway, and solving "email reuse after
-- soft delete" would require either a generated/computed unique key or
-- rewriting the email on delete (e.g. appending +deleted-<id>) — added
-- complexity with no real MVP requirement driving it. Documented here so
-- it's a known, chosen limitation rather than a surprise later.
-- Index note: uq_users_email doubles as the lookup index for login — every
-- login query filters on email, so this unique constraint isn't just for
-- integrity, it's the query's index too.

CREATE TABLE roles (
  role_id     SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(50) NOT NULL,   -- 'admin' | 'security_analyst' | 'auditor' | 'customer'
  description VARCHAR(255) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_roles_name UNIQUE (name)
) ENGINE=InnoDB;

CREATE TABLE permissions (
  permission_id SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(100) NOT NULL,   -- e.g. 'fraud_case:reassign', 'audit_log:read'
  description   VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_permissions_code UNIQUE (code)
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
  role_id       SMALLINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(permission_id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- CASCADE is safe here specifically because this is a pure join table with
-- no independent meaning of its own — deleting a role should drop its
-- permission grants. This is the one place in the schema CASCADE is used.

CREATE TABLE user_roles (
  user_id  BIGINT UNSIGNED NOT NULL,
  role_id  SMALLINT UNSIGNED NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE devices (
  device_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  device_name   VARCHAR(150) NULL,
  browser       VARCHAR(100) NULL,
  operating_system VARCHAR(100) NULL,
  device_type   ENUM('desktop','mobile','tablet','unknown') NOT NULL DEFAULT 'unknown',
  ip_address    VARCHAR(45) NOT NULL,      -- VARCHAR(45) fits IPv6
  location      VARCHAR(150) NULL,          -- city-level, IP-derived (FR-DEVICE-01)
  trust_status  ENUM('trusted','unknown','flagged') NOT NULL DEFAULT 'unknown',
  first_seen    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_devices_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  session_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  device_id    BIGINT UNSIGNED NULL,
  ip_address   VARCHAR(45) NOT NULL,
  issued_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME NULL,               -- NFR-SEC-12 session revocation
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_sessions_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expiry (expires_at)
) ENGINE=InnoDB;

CREATE TABLE refresh_tokens (
  token_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  session_id   BIGINT UNSIGNED NOT NULL,
  token_hash   VARCHAR(255) NOT NULL,       -- token stored hashed, never raw (NFR-SEC-13)
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_refresh_tokens_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_refresh_tokens_session FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
  INDEX idx_refresh_tokens_user (user_id)
) ENGINE=InnoDB;

CREATE TABLE login_attempts (
  attempt_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         BIGINT UNSIGNED NULL,     -- NULL if email doesn't match any user
  email_attempted VARCHAR(255) NOT NULL,
  success         BOOLEAN NOT NULL,
  device_id       BIGINT UNSIGNED NULL,
  ip_address      VARCHAR(45) NOT NULL,
  attempted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_attempts_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  CONSTRAINT fk_login_attempts_device FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE SET NULL,
  INDEX idx_login_attempts_user_time (user_id, attempted_at),
  INDEX idx_login_attempts_ip_time (ip_address, attempted_at)
) ENGINE=InnoDB;
-- Two indexes here because brute-force detection queries by two different
-- angles: "failures for this account" (FR-AUTH-06) and "failures from this
-- IP" (NFR-SEC-06 rate limiting) — different queries, different index needs.

CREATE TABLE password_reset_tokens (
  token_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NOT NULL,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  DATETIME NOT NULL,
  used_at     DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pwd_reset_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================================
-- SECTION 2: CUSTOMER & BANKING DATA
-- ============================================================================

CREATE TABLE customers (
  customer_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  full_name     VARCHAR(150) NOT NULL,
  national_id   VARCHAR(50) NOT NULL,
  date_of_birth DATE NOT NULL,
  address       VARCHAR(255) NULL,
  occupation    VARCHAR(100) NULL,
  kyc_status    ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at    DATETIME NULL,
  CONSTRAINT uq_customers_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  CONSTRAINT uq_customers_user_id UNIQUE (user_id),   -- enforces one-to-one with users
  CONSTRAINT uq_customers_national_id UNIQUE (national_id),
  INDEX idx_customers_deleted (deleted_at)
) ENGINE=InnoDB;

CREATE TABLE accounts (
  account_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id     BIGINT UNSIGNED NOT NULL,
  account_number  VARCHAR(20) NOT NULL,     -- system-generated, never client-supplied (FR-CUST-04)
  account_type    ENUM('savings','current') NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',  -- ISO 4217 code
  balance         DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  minimum_balance DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  status          ENUM('active','frozen','closed') NOT NULL DEFAULT 'active',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at      DATETIME NULL,
  CONSTRAINT fk_accounts_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
  CONSTRAINT uq_accounts_number UNIQUE (account_number),
  CONSTRAINT chk_accounts_balance CHECK (balance >= minimum_balance OR status <> 'active'),
  CONSTRAINT chk_accounts_currency CHECK (CHAR_LENGTH(currency) = 3),
  INDEX idx_accounts_customer (customer_id),
  INDEX idx_accounts_customer_status (customer_id, status),
  INDEX idx_accounts_deleted (deleted_at)
) ENGINE=InnoDB;
-- Currency note: MVP scope (Phase 1) is single-currency USD, but Zimbabwe's
-- dual-currency (USD/ZWL) reality made this cheap enough to add now rather
-- than as a later migration on a table that will have live balance data by
-- then. CHAR(3) + a length CHECK rather than an ENUM, specifically so adding
-- a third currency later is a data change, not a schema migration. No
-- conversion logic is implemented in MVP — a transfer between two accounts
-- with different currencies is out of scope until Phase 2, and the service
-- layer should reject cross-currency transfers explicitly rather than
-- silently mishandling them.
-- DECIMAL(18,2), never FLOAT/DOUBLE — floating point cannot represent money
-- exactly (0.1 + 0.2 != 0.3 in IEEE 754), which is unacceptable for a ledger.
-- This is a detail worth naming explicitly in an interview.

CREATE TABLE beneficiaries (
  beneficiary_id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id             BIGINT UNSIGNED NOT NULL,
  beneficiary_account_number VARCHAR(20) NOT NULL,
  beneficiary_name        VARCHAR(150) NOT NULL,
  created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at              DATETIME NULL,      -- soft delete: a removed payee may still be referenced by a past fraud investigation
  CONSTRAINT fk_beneficiaries_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
  INDEX idx_beneficiaries_customer (customer_id),
  INDEX idx_beneficiaries_deleted (deleted_at)
) ENGINE=InnoDB;

CREATE TABLE transactions (
  transaction_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_account_id BIGINT UNSIGNED NULL,     -- NULL for a pure deposit
  to_account_id   BIGINT UNSIGNED NULL,     -- NULL for a pure withdrawal
  type            ENUM('deposit','withdrawal','transfer') NOT NULL,
  amount          DECIMAL(18,2) NOT NULL,
  currency        CHAR(3) NOT NULL DEFAULT 'USD',
  status          ENUM('pending','completed','failed','reversed','flagged') NOT NULL DEFAULT 'pending',
  reference_code  VARCHAR(40) NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_from FOREIGN KEY (from_account_id) REFERENCES accounts(account_id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_to FOREIGN KEY (to_account_id) REFERENCES accounts(account_id) ON DELETE RESTRICT,
  CONSTRAINT uq_transactions_reference UNIQUE (reference_code),
  CONSTRAINT chk_transactions_amount CHECK (amount > 0),
  CONSTRAINT chk_transactions_accounts CHECK (from_account_id IS NOT NULL OR to_account_id IS NOT NULL),
  CONSTRAINT chk_transactions_currency CHECK (CHAR_LENGTH(currency) = 3),
  INDEX idx_transactions_from (from_account_id, created_at),
  INDEX idx_transactions_to (to_account_id, created_at),
  INDEX idx_transactions_status (status)
) ENGINE=InnoDB;
-- reference_code is a client-facing idempotency key: if a transfer request
-- is retried (e.g. a flaky connection on the customer's end), the service
-- layer can check this unique constraint before inserting a duplicate
-- transaction — this is how real payment systems prevent double-spends
-- from network retries, not just from malicious replay.
--
-- 'flagged' status — design note (revises a Phase 1 assumption, flagged
-- deliberately rather than silently changed): Phase 1 UC-01 originally said
-- a high-risk transaction "still completes" while generating an alert. That
-- remains true for Medium/High risk bands (30-79). For Critical risk (80-100)
-- specifically, the more defensible enterprise behavior is to HOLD the
-- transaction — insert/leave it as status='flagged' rather than 'completed'
-- — pending an analyst decision on the auto-created fraud case. 'flagged' is
-- therefore a real settlement state (funds not yet released), not just a
-- label layered on top of 'completed'. This is why it's a value in the same
-- status enum rather than a separate is_flagged boolean: a transaction is
-- never simultaneously 'completed' and awaiting fraud review — those are
-- mutually exclusive settlement states, which the enum should reflect. A
-- flagged transaction later transitions to 'completed' (cleared by analyst)
-- or 'reversed'/'failed' (blocked). Worth confirming this matches your
-- intent before Milestone 4, since it changes service-layer behavior for
-- the critical-risk path, not just the schema.

-- ============================================================================
-- SECTION 3: FRAUD DETECTION
-- ============================================================================

CREATE TABLE fraud_rules (
  rule_id     SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code        VARCHAR(50) NOT NULL,          -- e.g. 'LARGE_TXN', 'IMPOSSIBLE_TRAVEL'
  name        VARCHAR(150) NOT NULL,
  description VARCHAR(255) NULL,
  weight      TINYINT UNSIGNED NOT NULL,     -- points contributed, see Phase 1 section 2.5a
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_fraud_rules_code UNIQUE (code)
) ENGINE=InnoDB;
-- Rule weights live in a table, not in application constants, specifically
-- so an Admin can tune them without a code deployment — and so this table
-- is exactly what a future AI Engine's "confidence weight" would slot next to.

CREATE TABLE risk_scores (
  risk_score_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  login_attempt_id BIGINT UNSIGNED NULL,
  transaction_id   BIGINT UNSIGNED NULL,
  score            TINYINT UNSIGNED NOT NULL,     -- 0-100
  band             ENUM('low','medium','high','critical') NOT NULL,
  triggered_rules  JSON NULL,                     -- array of {rule_code, points} for explainability
  calculated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_risk_scores_login FOREIGN KEY (login_attempt_id) REFERENCES login_attempts(attempt_id) ON DELETE CASCADE,
  CONSTRAINT fk_risk_scores_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id) ON DELETE CASCADE,
  CONSTRAINT chk_risk_scores_range CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT chk_risk_scores_one_source CHECK (
    (login_attempt_id IS NOT NULL AND transaction_id IS NULL) OR
    (login_attempt_id IS NULL AND transaction_id IS NOT NULL)
  ),
  INDEX idx_risk_scores_band (band)
) ENGINE=InnoDB;
-- triggered_rules as JSON rather than a join table: this is a deliberate
-- exception to strict 3NF. The list of which rules fired for a specific
-- score is written once and never queried relationally (you don't need
-- "find all scores where rule X fired" as a first-class query for MVP) —
-- it exists for explainability/audit display. JSON avoids a join table
-- that would only ever be read back whole. If that query need appears
-- later, this denormalization is easy to split out.

CREATE TABLE security_alerts (
  alert_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  risk_score_id BIGINT UNSIGNED NOT NULL,
  customer_id   BIGINT UNSIGNED NULL,             -- NULL if alert is login-only, pre-customer-link
  status        ENUM('open','reviewed','escalated','false_positive') NOT NULL DEFAULT 'open',
  reviewed_by   BIGINT UNSIGNED NULL,
  reviewed_at   DATETIME NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_alerts_risk_score FOREIGN KEY (risk_score_id) REFERENCES risk_scores(risk_score_id) ON DELETE CASCADE,
  CONSTRAINT fk_alerts_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE SET NULL,
  CONSTRAINT fk_alerts_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_alerts_status (status)
) ENGINE=InnoDB;

CREATE TABLE fraud_cases (
  case_id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id         BIGINT UNSIGNED NOT NULL,
  assigned_analyst_id BIGINT UNSIGNED NULL,
  status              ENUM('open','under_investigation','pending_review','escalated','resolved','false_positive','closed') NOT NULL DEFAULT 'open',
  resolution_notes    TEXT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cases_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE RESTRICT,
  CONSTRAINT fk_cases_analyst FOREIGN KEY (assigned_analyst_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_cases_status (status),
  INDEX idx_cases_analyst (assigned_analyst_id)
) ENGINE=InnoDB;

CREATE TABLE fraud_case_alerts (
  case_id    BIGINT UNSIGNED NOT NULL,
  alert_id   BIGINT UNSIGNED NOT NULL,
  linked_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (case_id, alert_id),
  CONSTRAINT fk_case_alerts_case FOREIGN KEY (case_id) REFERENCES fraud_cases(case_id) ON DELETE CASCADE,
  CONSTRAINT fk_case_alerts_alert FOREIGN KEY (alert_id) REFERENCES security_alerts(alert_id) ON DELETE CASCADE,
  INDEX idx_case_alerts_alert (alert_id)
) ENGINE=InnoDB;
-- idx_case_alerts_alert enables the reverse lookup "is this alert already
-- attached to a case?" — the composite PK alone only indexes case_id first,
-- so a query starting from alert_id (which is how the fraud engine asks
-- the question, since it has the alert, not the case, in hand) would
-- otherwise force a full scan.

CREATE TABLE fraud_case_transactions (
  case_id        BIGINT UNSIGNED NOT NULL,
  transaction_id BIGINT UNSIGNED NOT NULL,
  linked_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (case_id, transaction_id),
  CONSTRAINT fk_case_txns_case FOREIGN KEY (case_id) REFERENCES fraud_cases(case_id) ON DELETE CASCADE,
  CONSTRAINT fk_case_txns_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(transaction_id) ON DELETE RESTRICT,
  INDEX idx_case_txns_transaction (transaction_id)
) ENGINE=InnoDB;

CREATE TABLE fraud_case_history (
  history_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id      BIGINT UNSIGNED NOT NULL,
  from_status  VARCHAR(30) NULL,           -- NULL on case creation
  to_status    VARCHAR(30) NOT NULL,
  changed_by   BIGINT UNSIGNED NOT NULL,
  changed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes        VARCHAR(500) NULL,
  CONSTRAINT fk_case_history_case FOREIGN KEY (case_id) REFERENCES fraud_cases(case_id) ON DELETE CASCADE,
  CONSTRAINT fk_case_history_user FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE RESTRICT,
  INDEX idx_case_history_case (case_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE investigation_notes (
  note_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id      BIGINT UNSIGNED NOT NULL,
  author_id    BIGINT UNSIGNED NOT NULL,
  note_text    TEXT NOT NULL,
  evidence_url VARCHAR(500) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notes_case FOREIGN KEY (case_id) REFERENCES fraud_cases(case_id) ON DELETE CASCADE,
  CONSTRAINT fk_notes_author FOREIGN KEY (author_id) REFERENCES users(user_id) ON DELETE RESTRICT,
  INDEX idx_notes_case (case_id, created_at)
) ENGINE=InnoDB;

-- ============================================================================
-- SECTION 4: AUDIT, LOGGING & NOTIFICATIONS
-- ============================================================================

CREATE TABLE audit_logs (
  audit_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     BIGINT UNSIGNED NULL,          -- NULL for system-initiated actions
  ip_address  VARCHAR(45) NULL,
  device_info VARCHAR(255) NULL,
  action      VARCHAR(100) NOT NULL,         -- e.g. 'ACCOUNT_SUSPENDED', 'TRANSFER_COMPLETED'
  entity_type VARCHAR(50) NOT NULL,          -- e.g. 'user', 'account', 'fraud_case'
  entity_id   BIGINT UNSIGNED NULL,
  old_value   JSON NULL,
  new_value   JSON NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_audit_logs_entity (entity_type, entity_id),
  INDEX idx_audit_logs_user_time (user_id, created_at)
) ENGINE=InnoDB;
-- No UPDATE or DELETE grant is issued to the application's DB user on this
-- table at the database-privilege level, not just the application layer —
-- FR-AUDIT-02 (append-only) is enforced in two places, not one, which
-- matters if a future bug in the app layer tries to "clean up" old logs.

CREATE TABLE security_logs (
  log_id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level          ENUM('INFO','WARNING','ERROR','SECURITY','CRITICAL') NOT NULL,
  user_id        BIGINT UNSIGNED NULL,
  role           VARCHAR(50) NULL,
  ip_address     VARCHAR(45) NULL,
  action         VARCHAR(150) NOT NULL,
  endpoint       VARCHAR(255) NULL,
  status_code    SMALLINT UNSIGNED NULL,
  correlation_id VARCHAR(64) NOT NULL,       -- NFR-LOG-03, propagated per-request
  message        TEXT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_security_logs_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_security_logs_correlation (correlation_id),
  INDEX idx_security_logs_level_time (level, created_at)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  notification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          BIGINT UNSIGNED NOT NULL,
  type             VARCHAR(50) NOT NULL,     -- e.g. 'SUSPICIOUS_LOGIN', 'CASE_ASSIGNED'
  channel          ENUM('email','in_app') NOT NULL,
  title            VARCHAR(150) NOT NULL,
  message          VARCHAR(500) NOT NULL,
  is_read          BOOLEAN NOT NULL DEFAULT FALSE,
  read_at          DATETIME NULL,            -- precise read timestamp rather than a generic updated_at
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_notifications_user_unread (user_id, is_read)
) ENGINE=InnoDB;

CREATE TABLE reports (
  report_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  generated_by  BIGINT UNSIGNED NOT NULL,
  report_type   ENUM('fraud','audit','user','transaction') NOT NULL,
  format        ENUM('pdf','excel') NOT NULL,
  file_path     VARCHAR(500) NOT NULL,
  generated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reports_user FOREIGN KEY (generated_by) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ============================================================================
-- SEED DATA: roles + permissions only (structural, not sample business data)
-- ============================================================================

INSERT INTO roles (name, description) VALUES
  ('admin', 'Full system control'),
  ('security_analyst', 'Monitors and investigates fraud'),
  ('auditor', 'Read-only compliance oversight'),
  ('customer', 'Bank customer, self-service only');

INSERT INTO fraud_rules (code, name, weight, is_active) VALUES
  ('LARGE_TXN', 'Large transaction above threshold', 25, TRUE),
  ('NEW_DEVICE', 'Login from new device or IP', 20, TRUE),
  ('IMPOSSIBLE_TRAVEL', 'Geographically impossible login sequence', 40, TRUE),
  ('RAPID_TRANSFERS', 'Multiple transfers in short window', 30, TRUE),
  ('DORMANT_REACTIVATION', 'Activity on long-dormant account', 20, TRUE),
  ('FAILED_LOGIN_BURST', 'Multiple failures before success', 25, TRUE);
