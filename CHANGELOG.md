# Changelog

All notable changes to the **Stellar Split: Micro-Remittance & Split-Billing Protocol** project since the initial repository upload are documented in this file.

The project adheres to [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).

---

## [Unreleased] - Major Quality & Architectural Overhaul

### Smart Contract (`contracts/stellar_split_bill`)
- **Upgraded Soroban SDK**: Updated dependency from v20.0.0 to v29.0.0, resolving Rust 1.97.1 transmute and `ethnum` compilation incompatibilities. Configured `wasm32v1-none` compilation target mandated by modern Soroban toolchains.
- **Typed Contract Errors (`#[contracterror]`)**: Replaced generic panics with an explicit 12-code error enum (`Error`):
  - `AlreadyInitialized`, `NotInitialized`, `BillNotFound`, `BillClosed`, `InvalidAmount`, `AmountExceedsRemaining`, `Unauthorized`, `InvalidState`, `ContractPaused`, `PayeeCannotBePayer`, `Overflow`, `ReentrancyGuard`.
- **Strict Authorization Enforcement**:
  - `initialize` requires admin signature and rejects double-initialization.
  - `create_bill` enforces payee cryptographic authorization (`payee.require_auth()`).
  - `pay_bill` enforces payer cryptographic authorization (`payer.require_auth()`).
  - `remit` enforces payee cryptographic authorization (`bill.payee.require_auth()`).
  - `close_bill`, `emergency_stop`, and `resume` enforce admin authorization (`admin.require_auth()`).
- **Payee-Payer Invariant**: Enforced rule that a bill payee cannot pay into their own bill (`Error::PayeeCannotBePayer`).
- **Checked Arithmetic & Overpayment Protection**: Replaced standard operators with `checked_add` trapping overflows via `Error::Overflow`. Payments cannot exceed the remaining balance requirement (`Error::AmountExceedsRemaining`). Zero or negative amounts are rejected (`Error::InvalidAmount`).
- **Stateful Reentrancy Guard**: Implemented contract-level `ReentrancyLock` guard across critical token transfer pathways.
- **Storage Tier Alignment & Automatic TTL Bumping**:
  - Moved admin storage to `instance()` with programmatic TTL extensions (`INSTANCE_TTL_LOW=10_000`, `INSTANCE_TTL_HIGH=20_000`).
  - Persistent bill entries refreshed using `extend_ttl` (`PERSISTENT_TTL_LOW=20_000`, `PERSISTENT_TTL_HIGH=50_000`), protecting records from ledger entry archiving.
- **Typed Contract Events (`#[contractevent]`)**: Implemented typed event structs (`BillCreatedEvent`, `BillPaidEvent`, `BillCompletedEvent`, `BillClosedEvent`, `RemitEvent`) publishing via `.publish(&env)` without string symbol limitations.
- **Comprehensive Test Suite**: Implemented 14 automated unit and integration tests in `src/test.rs` covering happy paths, overpayment, remit peer-to-peer settlement, SAC token balance changes, unauthorized access, double-initialization, and event publishing (100% pass rate).

### Backend Read & Simulation Service (`backend/`)
- **Modular Architecture**: Separated Express app creation (`backend/app.js`) from server lifecycle and network listener (`backend/index.js`) for testability.
- **Security Hardening**: Integrated `helmet` security headers, CORS origin controls, and `express-rate-limit` (100 requests / 15 minutes).
- **Strict Parameter Bounds Validation**: Validates `billId` as positive integer between 1 and 1,000,000; non-numeric, negative, floating-point, or out-of-range IDs return HTTP 400.
- **Offline Simulation Without Account 404**: Replaced live `server.getAccount` on ephemeral keypairs with a deterministic offline `new Account(readKeypair.publicKey(), '0')`, enabling reliable transaction simulation without network dependencies or 404 account errors.
- **BigInt JSON Serialization**: Implemented `serializeSorobanValue` to recursively serialize Soroban `i128` BigInt types without Node JSON serialization crashes.
- **Lifecycle & Operational Resilience**: Added structured startup configuration logging, configuration validation failing fast if required variables are invalid, and graceful shutdown handlers for `SIGTERM` and `SIGINT`.
- **Automated Testing Suite**: Added 13 Jest + Supertest integration tests in `backend/test/app.test.js` covering input validation, health endpoints, simulation success/failure, and unconfigured contract error handling (100% pass rate). Added `npm test` and `npm run lint`.

### Frontend Web3 Application (`frontend/`)
- **Direct Freighter & Network Validation**: Integrates `@stellar/freighter-api` v2 with real connection detection (`isConnected`), account access, and network verification. Automatically warns users if wallet is connected to Stellar Mainnet instead of Testnet.
- **Soroban Transaction Simulation & Assembly**: Implemented proper transaction preparation using `server.simulateTransaction` and `rpc.assembleTransaction` before Freighter signing, ensuring accurate footprint and resource fee calculation.
- **Transaction Hash Tracking**: Real-time transaction polling (`server.getTransaction`) with status tracker (Pending, Success, Failed) and direct clickable links to `stellar.expert` Testnet ledger explorer.
- **Remittance Progress Visualization**: Added dynamic progress bar calculating percentage funded (`amount_collected / total_amount`), remaining balance display, and quick-fill remittance contribution buttons (25%, 50%, 100% of remaining).
- **Premium Glassmorphic Design System**: Implemented cohesive modern CSS design system in `frontend/src/index.css` featuring dark mode palette (`#0a0e17`), gradient glows, accessible typography (`Inter`, `Outfit`), responsive layouts, and pulsing status indicators.
- **Testing & Production Build**: Added React Testing Library suite (`frontend/src/App.test.js`) with 5 passing tests and verified zero-error production build (`npm run build`).

### Workspace & Project Organization
- **Clean Monorepo Restructuring**: Preserved history via `git mv`. Eliminated root-level file duplicates (`lib.rs`, `App.jsx`, `index.js`, `Cargo.toml`).
- **Standard Layout**: Organized into `/contracts/stellar_split_bill`, `/backend`, `/frontend`, `/docs`, and `/.github`.
- **Cargo Workspace**: Created root `Cargo.toml` managing workspace members and shared release profile optimizations.
- **Environment & Secret Hygiene**: Updated `.gitignore` across all directories. Confirmed zero private keys or secrets in repository history. Provided documented `.env.example` templates.

### CI/CD, Documentation & Governance
- **Lockfile Tracking & CI Caching**: Added `backend/package-lock.json`, `frontend/package-lock.json`, and `Cargo.lock` to git tracking and removed lockfile ignores from `.gitignore` to enable deterministic CI builds with `actions/setup-node` caching and `npm ci`.
- **GitHub Actions CI**:
  - `.github/workflows/rust.yml`: Automated `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and `wasm32v1-none` release compilation.
  - `.github/workflows/node.yml`: Automated backend linting, Jest testing, frontend React testing, and production Webpack build.
- **Quality Configurations**: Added `.github/dependabot.yml`, bug report and feature request issue templates, pull request template, and `.editorconfig`.
- **Open-Source License**: Added official **Apache License 2.0**.
- **Security & Contribution Guides**: Authored `SECURITY.md` (vulnerability disclosure policy and threat model) and `CONTRIBUTING.md` (development standards and PR checklist).
- **Roadmap & Ecosystem Architecture**: Created `docs/ROADMAP.md` detailing 6 prioritized milestones (SAC USDC/EURC support, path payments, SEP-24/31 cash on/off-ramps, timelock escrow, passkeys, formal audit) and `docs/DEPLOYMENT.md` with verified Testnet deployment instructions.
- **Audit Findings**: Authored and committed `AUDIT.md` providing line-by-line verification of previous README claims vs real code.
