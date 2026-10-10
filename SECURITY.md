# Security Policy

## 1. Supported Versions

| Component | Version / Target | Supported |
| :--- | :--- | :--- |
| Smart Contract (`contracts/stellar_split_bill`) | Soroban SDK 29.0.0 (WASM) | :white_check_mark: |
| Backend API (`backend/`) | Node.js 18.x / 20.x | :white_check_mark: |
| Frontend DApp (`frontend/`) | React 18.x + Freighter API 2.x | :white_check_mark: |

---

## 2. Reporting a Vulnerability

We take the security of smart contracts and financial infrastructure seriously. If you discover a security vulnerability, please report it responsibly:

- **Do NOT file a public GitHub issue.**
- Email your findings directly to the maintainers or report via GitHub Security Advisories (Privately Report Vulnerability).
- Provide a detailed report including:
  1. Description of the vulnerability and attack vector.
  2. Proof-of-concept (PoC) code or Soroban test scenario replicating the issue.
  3. Affected component(s) and commit hash.
  4. Potential impact (e.g., unauthorized state transition, fund lock, denial of service).

You will receive an acknowledgment within **48 hours**, and we will coordinate an advisory and patch release.

---

## 3. Smart Contract Security Architecture

### 3.1 Authentication & Authorization
- Every state-mutating function enforces strict caller authorization:
  - `initialize`: Can only be invoked once; requires authorization from the assigned `admin`.
  - `create_bill`: Requires authorization from the bill creator (`payee.require_auth()`).
  - `pay_bill`: Requires authorization from the payer (`payer.require_auth()`).
  - `remit`: Requires authorization from the designated payee (`bill.payee.require_auth()`).
  - `close_bill`, `emergency_stop`, `resume`: Enforce admin-only caller authorization (`admin.require_auth()`).

### 3.2 Checked Arithmetic & Bounds
- All balance and remittance additions are calculated using `checked_add`. Any potential integer overflow results in an explicit `Error::Overflow` termination rather than wrapping or silent corruption.
- Zero or negative remittance amounts are strictly rejected with `Error::InvalidAmount`.
- Overpayments exceeding the remaining unpaid target are rejected with `Error::AmountExceedsRemaining`.

### 3.3 Reentrancy Mitigation
- Soroban's runtime prohibits recursive contract calls within the same execution stack by default. In addition, the contract enforces a stateful `ReentrancyLock` guard across critical token transfer pathways.

### 3.4 Storage Lifetime Management
- Instance and persistent storage keys are programmatically refreshed using Soroban `extend_ttl` (`INSTANCE_TTL_LOW=10_000`, `INSTANCE_TTL_HIGH=20_000`, `PERSISTENT_TTL_LOW=20_000`, `PERSISTENT_TTL_HIGH=50_000`), preventing ledger entry archiving from disrupting active split-bill contracts.

---

## 4. Operational Disclaimers

> **CAUTION: TESTNET & PROTOTYPE NOTICE**  
> This software is currently developed and tested on Stellar Testnet. It has **NOT** undergone a formal external third-party security audit. It is provided strictly for evaluation, testing, and ecosystem research. Do **NOT** deploy this code to Stellar Mainnet with real financial assets without independent security auditing and formal verification.
