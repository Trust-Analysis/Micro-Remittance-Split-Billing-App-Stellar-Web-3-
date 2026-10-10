## Description
Briefly describe the change and why it was made.

## Type of Change
- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Refactor (`refactor:`)
- [ ] Test improvements (`test:`)
- [ ] Documentation (`docs:`)
- [ ] CI/CD or tooling (`ci:`, `chore:`)

## Verification Checklist
- [ ] Smart contract builds cleanly: `cargo build --target wasm32v1-none --release`
- [ ] Soroban tests pass: `cargo test`
- [ ] Clippy passes with zero warnings: `cargo clippy -- -D warnings`
- [ ] Backend tests pass: `npm --prefix backend test`
- [ ] Frontend tests pass: `CI=true npm --prefix frontend test`
- [ ] Frontend production build succeeds: `npm --prefix frontend run build`
- [ ] No secrets or private keys committed
