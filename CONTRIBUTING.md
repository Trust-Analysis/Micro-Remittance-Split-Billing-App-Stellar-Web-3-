# Contributing to Stellar Split

Thank you for your interest in contributing to Stellar Split! We welcome contributions to improve our Soroban smart contracts, backend integration service, and frontend user experience.

---

## 1. Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free environment for everyone. Please treat all contributors and community members with respect, empathy, and professional integrity.

---

## 2. Development Setup

### Prerequisites
- **Rust**: 1.82+ with `wasm32v1-none` target
  ```bash
  rustup target add wasm32v1-none
  rustup component add rustfmt clippy
  ```
- **Node.js**: 18+ (tested on Node 20 & 24)
- **Freighter Wallet Extension**: [freighter.app](https://www.freighter.app) configured to Testnet.

### Installation
```bash
# Clone the repository
git clone https://github.com/<org>/Micro-Remittance-Split-Billing-App-Stellar-Web-3-.git
cd Micro-Remittance-Split-Billing-App-Stellar-Web-3-

# Install backend dependencies
cd backend && npm install && cd ..

# Install frontend dependencies
cd frontend && npm install && cd ..
```

---

## 3. Quality Standards & Verification

Before submitting a Pull Request, all of the following checks must pass locally without warnings:

### Smart Contract Checks
```bash
# Code formatting
cargo fmt --check

# Static analysis
cargo clippy --workspace --all-targets -- -D warnings

# Unit & integration test suite (14 tests)
cargo test --workspace

# Release WASM compilation
SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 \
cargo build --package stellar_split_bill --target wasm32v1-none --release
```

### Backend Checks
```bash
# Run ESLint
npm --prefix backend run lint

# Run Supertest integration tests (13 tests)
npm --prefix backend test
```

### Frontend Checks
```bash
# Run React test suite (5 tests)
CI=true npm --prefix frontend test

# Production build
npm --prefix frontend run build
```

---

## 4. Conventional Commits

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new feature or capability
- `fix:` A bug fix
- `test:` Adding or updating tests
- `docs:` Documentation additions or updates
- `refactor:` Code restructuring without functional changes
- `ci:` Changes to CI/CD workflows or configurations
- `chore:` Dependency bumps, build adjustments, etc.

Commit messages must be concise, descriptive, and accurately represent the change. Never squash all historical commits into a single generic commit.

---

## 5. Submitting a Pull Request

1. Fork the repo and create a feature branch (`git checkout -b feat/your-feature-name`).
2. Implement your changes following existing architectural patterns.
3. Add corresponding unit or integration tests for any new logic.
4. Verify all tests and linters pass.
5. Push to your branch and open a Pull Request using the provided PR template.
