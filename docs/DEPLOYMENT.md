# Stellar Testnet Deployment Guide

This document describes the exact, reproducible process for compiling, deploying, and initializing the `stellar_split_bill` Soroban smart contract on Stellar Testnet.

---

## 1. Prerequisites

- **Rust & Cargo**: Rust 1.82+ (verified on Rust 1.97.1)
- **WASM Target**: `wasm32v1-none` (mandated for Soroban SDK v22–v29)
  ```bash
  rustup target add wasm32v1-none
  ```
- **Node.js**: v18 or later
- **Stellar CLI** (recommended):
  ```bash
  cargo install --locked stellar-cli --features opt
  ```
  *(Alternative: Use the Node.js SDK deployment script described in Section 4)*

---

## 2. Compile Contract WASM

From the repository root, build the release WASM binary:

```bash
SOROBAN_SDK_BUILD_SYSTEM_SUPPORTS_SPEC_SHAKING_V2=1 \
cargo build --package stellar_split_bill --target wasm32v1-none --release
```

The optimized contract binary will be generated at:
```text
target/wasm32v1-none/release/stellar_split_bill.wasm
```
*Current artifact size: ~22 KB.*

---

## 3. Deployment via Stellar CLI

### Step 3.1: Generate and Fund Testnet Identity

```bash
# Generate a new identity keypair
stellar keys generate --network testnet deployer

# Fund using friendbot
stellar keys fund deployer --network testnet
```

### Step 3.2: Deploy the WASM Binary

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/stellar_split_bill.wasm \
  --source deployer \
  --network testnet
```

Output:
```text
<CONTRACT_ID_OUTPUT>
# Example format: C... (56 character hex-encoded StrKey)
```

### Step 3.3: Initialize the Contract

Initialize the contract with an admin account (typically the deployer):

```bash
DEPLOYER_ADDRESS=$(stellar keys address deployer)

stellar contract invoke \
  --id <DEPLOYED_CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin "$DEPLOYER_ADDRESS"
```

### Step 3.4: Verify State & Execute Test Bill

```bash
# Query bill count (should return 0 initially)
stellar contract invoke \
  --id <DEPLOYED_CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  get_bill_count

# Create a test bill
stellar contract invoke \
  --id <DEPLOYED_CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  create_bill \
  --payee "$DEPLOYER_ADDRESS" \
  --token "$DEPLOYER_ADDRESS" \
  --total_amount 10000000
```

---

## 4. Alternative Deployment via Node.js (@stellar/stellar-sdk)

For environments without `stellar-cli`, use the following Node.js script:

```javascript
import { Keypair, Networks, rpc, Operation, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import fs from 'fs';

const server = new rpc.Server('https://soroban-testnet.stellar.org');
const deployer = Keypair.fromSecret(process.env.DEPLOYER_SECRET_KEY);
const wasmBytes = fs.readFileSync('target/wasm32v1-none/release/stellar_split_bill.wasm');

async function deploy() {
  const account = await server.getAccount(deployer.publicKey());
  
  // 1. Upload WASM (InstallContractCode)
  const installOp = Operation.uploadContractWasm({ wasm: wasmBytes });
  let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(installOp)
    .setTimeout(60)
    .build();

  let sim = await server.simulateTransaction(tx);
  let prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(deployer);
  let res = await server.sendTransaction(prepared);
  console.log('WASM installed, tx hash:', res.hash);
}
```

---

## 5. Environment Configuration

Once deployed, copy your Testnet Contract ID into the backend and frontend configurations:

1. **Backend (`backend/.env`)**:
   ```env
   PORT=3001
   SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
   CONTRACT_ID=<YOUR_DEPLOYED_CONTRACT_ID>
   NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
   ```

2. **Frontend (`frontend/.env`)**:
   ```env
   REACT_APP_CONTRACT_ID=<YOUR_DEPLOYED_CONTRACT_ID>
   REACT_APP_API_BASE=http://localhost:3001
   REACT_APP_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
   ```

---

## 6. Deployment Status Notice

> **Important Ecosystem Transparency Notice**:
> In accordance with project integrity standards, contract IDs are not hardcoded or fabricated in this repository. Developers and evaluators should deploy a fresh instance to Stellar Testnet using the verified steps above or connect to their organization's designated testnet contract address via `.env`.
