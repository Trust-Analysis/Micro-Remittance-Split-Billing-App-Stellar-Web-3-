# Stellar Split: Engineering Roadmap & Future Issues

This document tracks prioritized future milestones and GitHub issues for evolving the Stellar Split protocol into a production-grade, globally accessible micro-remittance ecosystem.

---

## Issue #1: Multi-Asset Contract (SAC) Liquidity & Native USDC/EURC Support
- **Labels**: `enhancement`, `contracts`, `ecosystem`
- **Description**: Currently, the contract supports arbitrary token addresses via Stellar Asset Contract (SAC) client transfers. We will formalize trusted token whitelisting and add first-class user interfaces for Circle USDC and EURC on Stellar, allowing diaspora remitters to settle obligations without exposure to crypto asset volatility.
- **Deliverables**:
  - Whitelist registry for audited stablecoin SAC addresses.
  - Decimals normalization in UI (USDC 7 decimals vs native assets).
  - Test vectors with simulated SAC tokens on local sandbox and Testnet.

---

## Issue #2: Automated Soroban Path Payments for Cross-Currency Remittances
- **Labels**: `enhancement`, `stellar-core`, `remittance`
- **Description**: Enable remittances where contributors pay in their local currency (e.g., local currency stablecoin or XLM) while the bill recipient automatically receives their desired target asset (e.g., USDC or local fiat token) utilizing Stellar DEX liquidity paths.
- **Deliverables**:
  - Integration with Stellar path-payment primitives.
  - Slippage protection and deadline enforcement in contract invocation.
  - Frontend swap-route estimation card showing exchange rates before submission.

---

## Issue #3: SEP-24 & SEP-31 Anchor Integration for Cash-In / Cash-Out Fiat Ramps
- **Labels**: `architecture`, `ecosystem`, `anchors`
- **Description**: Remittance recipients in emerging markets often need physical cash or local bank disbursements. We will integrate Stellar Ecosystem Proposals (SEP-24 interactive deposit/withdrawal and SEP-31 cross-border remittances) connecting our DApp directly with verified Stellar anchors (e.g. MoneyGram Access).
- **Deliverables**:
  - SEP-24 webview flow inside frontend.
  - Webhook integration in backend for off-chain disbursement confirmation.
  - Verification with MoneyGram Access testnet endpoints.

---

## Issue #4: Timelocked Expiration, Refund Escrow & Pro-Rata Reclaim
- **Labels**: `contracts`, `security`
- **Description**: In the event that a group bill fails to reach its total target before a deadline, contributors currently rely on manual intervention. Implement an automated expiration timestamp with a `reclaim_contribution` entrypoint allowing participants to claw back their proportional contribution if the target is unreached.
- **Deliverables**:
  - Expiration timestamp field added to `Bill` struct.
  - Per-participant contribution ledger mapping.
  - `reclaim_contribution(payer, bill_id)` smart contract function with event emissions.

---

## Issue #5: Account Abstraction & Passkey / Social Onboarding (SEP-30)
- **Labels**: `frontend`, `ux`, `accessibility`
- **Description**: Non-technical diaspora families frequently struggle with browser extension wallet setup. Implement Soroban passkey / Web3Auth integration using SEP-30 key recovery, enabling zero-install biometric onboarding on mobile smartphones.
- **Deliverables**:
  - WebAuthn passkey signer implementation for Soroban contract calls.
  - Mobile-responsive biometric signature modal.
  - Fallback exportable key recovery mechanism.

---

## Issue #6: Third-Party Security Audit & Formal Verification
- **Labels**: `security`, `audit`, `mainnet-readiness`
- **Description**: Engage an independent Stellar security auditing firm (e.g., Certora, OpenZeppelin, or OtterSec) to conduct formal verification of the contract's authorization logic, arithmetic invariants, and reentrancy protections prior to any Mainnet deployment.
- **Deliverables**:
  - Full static analysis report with automated fuzzing harnesses.
  - Formal mathematical verification of invariant: `amount_collected <= total_amount`.
  - Published public audit report artifact.
