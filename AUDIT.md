# Comprehensive Security & Architectural Audit Report

**Date:** October 2026  
**Auditor:** Senior Soroban / Stellar Full-Stack Engineer  
**Target Repository:** `Micro-Remittance-Split-Billing-App-Stellar-Web-3-`  
**Initial Commit:** `060e4e1c7c82024d0a8f89a379731c8715bc2038`

---

## Executive Summary

An exhaustive audit of the codebase was conducted prior to making any code modifications. The audit revealed that the repository was a raw, single-commit upload suffering from significant architectural dissonance, broken compilation paths, critical runtime bugs in both the smart contract and backend, unverified security claims in the documentation, and a total absence of continuous integration and quality controls.

Most critically:
1. **The smart contract could not be built or tested** due to a conflicting root `Cargo.toml` and illegal Soroban symbol lengths (`symbol_short!` exceeding 9 characters).
2. **The contract storage tier mismatch** checked instance storage for the admin while writing to persistent storage, breaking the single-initialization guarantee.
3. **The backend read proxy failed on every request** because it attempted to query `server.getAccount()` on an unfunded random keypair.
4. **The repository structure was fragmented**, with duplicate, divergent versions of files sitting at both the root and within subdirectories.
5. **README claims of "production readiness", "reentrancy protection", and "comprehensive testing" were inaccurate.**

---

## 1. File Structure & Duplication Analysis

| Root File | Subdirectory Canonical File | Status & Discrepancies | Resolution |
| :--- | :--- | :--- | :--- |
| `Cargo.toml` | `stellar_split_bill/Cargo.toml` | Root file specifies a library package but lacks `src/lib.rs`, which breaks Cargo's parent workspace search and prevents `cargo test` everywhere. | Delete root package manifest; convert root into a clean Cargo workspace manifest pointing to `contracts/stellar_split_bill`. |
| `lib.rs` | `stellar_split_bill/src/lib.rs` | Root `lib.rs` (325 lines) is an outdated snapshot lacking the unit tests present in `stellar_split_bill/src/lib.rs` (630 lines). | Remove root `lib.rs`; retain canonical contract in `contracts/stellar_split_bill/src/lib.rs`. |
| `App.jsx` | `frontend/src/App.jsx` | Root `App.jsx` (145 lines) is an incomplete stub without bill creation forms, progress bars, or stroops formatting. `frontend/src/App.jsx` (576 lines) contains the full UI logic. | Remove root `App.jsx`; modernize `frontend/src/App.jsx`. |
| `package.json` | `frontend/package.json` | Root `package.json` is actually the backend server configuration (`name: "split-bill-backend"`), not a monorepo or frontend file. | Move backend package manifest to a dedicated `/backend` directory. |
| `index.js` | *None (at root)* | The backend server was placed directly at root instead of in a `/backend` directory. | Move to `/backend/index.js` (or `/backend/src/index.js`). |
| `.env.example` | `frontend/.env.example` | Root `.env.example` configures backend (`PORT`, `CONTRACT_ID`, `RPC_URL`), while `frontend/.env.example` configures the React client. | Move root `.env.example` to `/backend/.env.example`. |

---

## 2. Broken Imports, Build & Toolchain Issues

1. **Cargo Workspace Manifest Failure (Critical)**:
   Running `cargo test` or `cargo build` in `stellar_split_bill` fails immediately with:
   ```text
   error: failed searching for potential workspace
   invalid potential workspace manifest: .../Cargo.toml
   Caused by: can't find library `stellar_split_bill`, rename file to `src/lib.rs`
   ```
2. **Soroban Event Symbol Length Compile Errors (Critical)**:
   In `stellar_split_bill/src/lib.rs`:
   - `symbol_short!("bill_created")` -> 12 characters (exceeds Soroban 9-character max limit).
   - `symbol_short!("bill_completed")` -> 14 characters (exceeds 9-character max limit).
   - `symbol_short!("bill_closed")` -> 11 characters (exceeds 9-character max limit).
   These macros will fail at compile time once Cargo parses the crate.
3. **Storage TTL API Deprecation / Incompatibility (High)**:
   Calls to `env.storage().instance().bump(...)` and `env.storage().persistent().bump(...)` fail on Soroban SDK 20+, which standardizes on `extend_ttl(low_threshold, high_threshold)` for instance and persistent entries.
4. **Missing Workspace Setup**:
   No root monorepo scripts or workspace `Cargo.toml`.

---

## 3. README Claims vs. Code Reality Audit

| Documentation Claim | Reality in Code | Assessment |
| :--- | :--- | :--- |
| **"Comprehensive Testing: Full Rust unit test suite covering all contract functions"** | Cargo test fails to run at all due to workspace collision. The existing tests in `stellar_split_bill` do not test `remit()`, do not test event emission, do not test token balance changes post-transfer, and do not test reentrancy. | **Inaccurate / Overstated** |
| **"Reentrancy Protection: Guards against reentrancy attacks"** | An instance storage boolean flag `ReentrancyKey::InProgress` was added, but the test `test_reentrancy_protection` merely creates a single bill without simulating reentrancy. In Soroban's execution environment, cross-contract calls only reenter if an external contract explicitly calls back; setting instance storage adds gas/storage write overhead to every call. | **Misleading / Untested** |
| **"Storage Management: Proper Instance vs Persistent storage with automatic TTL bumping"** | `initialize()` checks `instance().has(&DataKey::Admin)` but writes to `persistent().set(&DataKey::Admin, &admin)`. Because it checks the wrong storage tier, the admin check fails to detect existing persistent data. In addition, `.bump()` is used instead of `.extend_ttl()`. | **Defective / Buggy** |
| **"Admin Controls: Emergency stop functionality for admins"** | `close_bill()` flags `bill.is_active = false`. However, because `pay_bill()` transfers tokens immediately to the payee on every split payment, `close_bill()` does not escrow or refund anything; it only halts future payments. | **Partially Accurate (needs clear documentation)** |
| **"Decentralized Read-Layer: Backend provides optional data caching"** | Backend provides zero caching and crashes on every read request because it invokes `server.getAccount()` on an unfunded random keypair. | **Fabricated / Defective** |
| **"Provided as-is for educational and production use"** | No LICENSE file exists in the repo. Code contains breaking bugs, lacks CI, and has never undergone a formal audit. | **Unacceptable claim** |

---

## 4. Smart Contract Security & Logic Vulnerabilities

### 4.1 Storage Inconsistency & Double-Initialization (Severity: CRITICAL)
- **Code:**
  ```rust
  if env.storage().instance().has(&DataKey::Admin) {
      panic!("Contract already initialized");
  }
  admin.require_auth();
  env.storage().persistent().set(&DataKey::Admin, &admin);
  ```
- **Vulnerability:** The initialization check verifies `instance()` storage, but the admin is written into `persistent()` storage. Consequently, `instance().has(&DataKey::Admin)` evaluates to `false` on subsequent invocations, allowing `initialize()` to be re-run and potentially overwriting contract ownership.
- **Remedy:** Store and check Admin consistently in `instance()` storage, or check `persistent().has(&DataKey::Admin)`.

### 4.2 Raw Panics Instead of `#[contracterror]` (Severity: HIGH)
- **Code:** Uses `panic!("Bill not found")`, `panic!("Contract already initialized")`, `panic!("Amount below minimum")`.
- **Vulnerability:** Unstructured panics prevent client applications and indexers from distinguishing specific failure modes and consume unnecessary host gas without returning machine-readable error codes.
- **Remedy:** Implement a comprehensive `#[contracterror]` enum (`Error::AlreadyInitialized`, `Error::BillNotFound`, `Error::BillInactive`, `Error::Overpayment`, `Error::InvalidAmount`, `Error::Unauthorized`, etc.) and return `Result<T, Error>` across all contract entry points.

### 4.3 Payee == Payer Exploitation (Severity: MEDIUM)
- **Vulnerability:** In `pay_bill`, there is no check preventing the payer from being the bill's payee. While self-payment transfers funds to oneself, in a micro-remittance and split-billing context, it allows inflating `participant_count` and spoofing multi-party participation.
- **Remedy:** Disallow `payer == bill.payee`.

### 4.4 Overpayment Handling & Precision (Severity: MEDIUM)
- **Code:** If a payment pushes `amount_collected` even 1 stroop past `total_amount`, the transaction aborts with a panic.
- **Remedy:** Explicitly check remaining balance: `let remaining = bill.total_amount - bill.amount_collected`. Return `Error::Overpayment` with the exact remaining amount expected or cap the payment cleanly.

### 4.5 Lack of Remittance Recipient Check (Severity: LOW)
- **Code:** `remit(env, from, to, token, amount)` does not verify `from != to`.
- **Remedy:** Validate `from != to` to avoid pointless gas expenditure and confusing event emissions.

---

## 5. Backend Server Vulnerabilities & Architectural Flaws

### 5.1 Unfunded Simulate Keypair Crash (Severity: CRITICAL)
- **Code:**
  ```javascript
  const simulateKeypair = Keypair.random();
  ...
  const txBuilder = new TransactionBuilder(await server.getAccount(simulateKeypair.publicKey()), ...);
  ```
- **Vulnerability:** `simulateKeypair` is generated randomly on process start and has never been funded with lumens via friendbot or ledger. When `server.getAccount()` is called, the Stellar RPC throws a 404 Account Not Found error, causing every call to `/api/bill/:id` and `/api/bill-count` to crash with HTTP 500.
- **Remedy:** For read-only Soroban transaction simulation, instantiate a mock account `new Account(simulateKeypair.publicKey(), "0")` without invoking `server.getAccount()`, or use an optional pre-configured read-only account.

### 5.2 Missing Parameter Validation (Severity: HIGH)
- **Code:** `const billId = parseInt(req.params.id, 10);`
- **Vulnerability:** If `req.params.id` is not a valid unsigned integer (e.g., negative, non-numeric, or floating point), `billId` becomes `NaN` or invalid, causing unhandled RPC serialization errors.
- **Remedy:** Validate input strictly: ensure integer `>= 1` and `<= MAX_BILL_ID`.

### 5.3 Security Hardening & Rate Limiting (Severity: HIGH)
- **Vulnerability:** No `helmet` security headers, unbounded `cors()` open to all domains, and no rate limiting. The server acts as an open, unprotected proxy to the public Soroban Testnet RPC endpoint.
- **Remedy:** Integrate `helmet`, configure CORS origins, add `express-rate-limit`, and add request size limits.

### 5.4 Environment Validation & Graceful Shutdown (Severity: MEDIUM)
- **Vulnerability:** If `CONTRACT_ID` is missing or is the default placeholder `C_REPLACE_...`, the backend starts without warning. No `SIGTERM`/`SIGINT` handlers exist.
- **Remedy:** Add startup validation asserting `CONTRACT_ID` matches Stellar contract ID format (`C[A-Z0-9]{55}`) and implement graceful shutdown.

### 5.5 Missing Tests & Linting (Severity: HIGH)
- **Vulnerability:** Zero automated tests or linting scripts exist in the backend.
- **Remedy:** Add test suite (using Jest or Vitest + Supertest) mocking Stellar RPC calls, plus ESLint.

---

## 6. Frontend Application Deficiencies

### 6.1 Unverified Network Connection (Severity: HIGH)
- **Code:** Hardcodes `setNetwork('TESTNET')` upon wallet connection without querying the actual Freighter network.
- **Vulnerability:** If the user has Freighter connected to `PUBLIC` or `FUTURENET`, transactions will be signed against the wrong network passphrase or fail cryptically.
- **Remedy:** Call `getNetwork()` or `getNetworkDetails()` from `@stellar/freighter-api` and block actions if not on Stellar Testnet.

### 6.2 Missing Transaction Hash & Explorer Tracking (Severity: MEDIUM)
- **Vulnerability:** The UI displays generic alert boxes (`alert("Payment submitted successfully!")`) without displaying the Stellar transaction hash or providing a link to `stellar.expert`.
- **Remedy:** Parse transaction submission response, extract transaction hash, and render clickable links to `https://stellar.expert/explorer/testnet/tx/{hash}`.

### 6.3 Transaction Status Polling (Severity: MEDIUM)
- **Vulnerability:** The UI assumes `PENDING` status means final success. It does not poll `server.getTransaction()` to verify on-chain finality.
- **Remedy:** Add polling loop checking transaction status until `SUCCESS` or `FAILED`.

### 6.4 UI Polish & Design Quality (Severity: MEDIUM)
- **Vulnerability:** Uses basic inline CSS, standard browser alerts, and no responsive theme system.
- **Remedy:** Refactor into a clean modern design system with clear visual progress bars, loading spinners, badge statuses, and accessible dialogs.

---

## 7. Issue Prioritization & Action Matrix

| Severity | Issue Key | Component | Action Required |
| :--- | :--- | :--- | :--- |
| **CRITICAL** | `CRIT-01` | Build System | Remove root Cargo.toml conflict; create clean Cargo workspace pointing to `contracts/stellar_split_bill`. |
| **CRITICAL** | `CRIT-02` | Contract | Fix `symbol_short!` macros exceeding 9 characters in `stellar_split_bill`. |
| **CRITICAL** | `CRIT-03` | Contract | Fix storage tier mismatch in `initialize` (`instance` vs `persistent`). |
| **CRITICAL** | `CRIT-04` | Backend | Fix unfunded simulate keypair `getAccount` crash in transaction simulation. |
| **HIGH** | `HIGH-01` | Contract | Replace raw panics with `#[contracterror]` enum and return `Result<T, Error>`. |
| **HIGH** | `HIGH-02` | Contract | Fix TTL management to use standard `extend_ttl` method. |
| **HIGH** | `HIGH-03` | Contract | Implement thorough test suite in `src/test.rs` covering happy and failure paths. |
| **HIGH** | `HIGH-04` | Backend | Add input validation, helmet, CORS whitelist, rate limiting, and startup env verification. |
| **HIGH** | `HIGH-05` | Frontend | Add Freighter network check (enforce Testnet) and explorer transaction link. |
| **HIGH** | `HIGH-06` | Testing & CI | Implement GitHub Actions CI for Rust (fmt, clippy, test, wasm) and Node (lint, test, build). |
| **MEDIUM** | `MED-01` | Repo Structure | Reorganize into `/contracts`, `/backend`, `/frontend`, `/docs` using `git mv`. |
| **MEDIUM** | `MED-02` | Contract | Disallow `payer == payee` in split bills; test token balance changes with Stellar asset contract. |
| **MEDIUM** | `MED-03` | Frontend | Modernize UI design, progress bar calculation, and status polling. |
| **MEDIUM** | `MED-04` | Docs | Rewrite README to accurately reflect capabilities, limitations, and ecosystem relevance. |
| **LOW** | `LOW-01` | Governance | Add open source `LICENSE` (MIT/Apache-2.0), `SECURITY.md`, `CONTRIBUTING.md`, and roadmap. |

---

## Next Steps
Proceeding to **Phase 1: Restructuring** to organize repository layout and resolve workspace conflicts.
