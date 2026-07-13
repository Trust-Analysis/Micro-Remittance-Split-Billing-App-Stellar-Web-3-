# Micro-Remittance & Split-Billing App (Stellar Web 3)

This project is a Web 3 decentralized application built on the Stellar network using Soroban smart contracts. It allows users to send micro-remittances and create "Split Bills" that multiple participants can pay into until a target amount is reached.

## Architecture

This project contains three main components:

1. **Soroban Smart Contract (`stellar_split_bill/src/lib.rs`)**: Rust contract with security features, event emission, and admin controls
2. **Node.js Backend (`index.js`)**: Express server as a read-layer for contract data (RPC proxy)
3. **React Frontend (`frontend/src/App.jsx`)**: React UI with direct wallet interaction and transaction submission

## Key Features

### Smart Contract Security
- **Reentrancy Protection**: Guards against reentrancy attacks
- **Overflow Safety**: Checked arithmetic for all mathematical operations
- **Storage Management**: Proper Instance vs Persistent storage with automatic TTL bumping
- **Enhanced Authorization**: Soroban native auth framework with admin controls
- **Event Emission**: Contract events for tracking and transparency
- **Input Validation**: Strict bounds checking for amounts and bill IDs
- **Comprehensive Testing**: Full Rust unit test suite covering all contract functions

### Web 3 Architecture
- **Direct Blockchain Interaction**: Frontend communicates directly with Stellar network
- **User-Paid Transaction Fees**: Users pay their own gas fees (true Web 3 model)
- **Wallet-Based Auth**: All transactions signed by user's wallet
- **Decentralized Read-Layer**: Backend provides optional data caching but doesn't control transactions
- **No Backend Sponsorship**: No centralized gas sponsorship or transaction manipulation

## Prerequisites

- **Rust & Cargo**: To compile the smart contract
- **Stellar CLI**: To deploy the compiled WebAssembly to the network
- **Node.js & npm**: To run the frontend and backend
- **Freighter Wallet Extension**: To interact with the web app on the Stellar Testnet
- **XLM for Testnet**: Users need testnet XLM to pay transaction fees

## Setup Instructions

### 1. Build & Deploy the Smart Contract

Ensure you have the WebAssembly target installed:
```bash
rustup target add wasm32-unknown-unknown
```

Build the contract:
```bash
cd stellar_split_bill
cargo build --target wasm32-unknown-unknown --release
```

Install the Stellar CLI (if you haven't already):
```bash
cargo install --locked stellar-cli
```

Add the Testnet network and generate a funded deployer identity:
```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"

stellar keys generate my_deployer --network testnet
```

Deploy the contract to the Testnet:
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_split_bill.wasm \
  --source my_deployer \
  --network testnet
```

**Important**: Copy the resulting Contract ID (it starts with a `C`). You will need it for the backend!

### 2. Initialize the Contract

After deployment, initialize the contract with an admin address:
```bash
# Generate an admin keypair
stellar keys generate admin --network testnet

# Initialize the contract (replace CONTRACT_ID and ADMIN_ADDRESS)
stellar contract invoke \
  --id CONTRACT_ID \
  --source admin \
  --network testnet \
  initialize \
  --admin ADMIN_ADDRESS
```

### 3. Configure Backend

Copy the example environment file and configure:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
CONTRACT_ID=C_YOUR_DEPLOYED_CONTRACT_ID
PORT=3001
NETWORK=testnet
RPC_URL=https://soroban-testnet.stellar.org
```

### 4. Run the Node.js Backend

```bash
# Install dependencies
npm install

# Run the server
npm start
```

The backend will run on `http://localhost:3001` as a read-layer for contract data.

### 5. Configure Frontend

Navigate to the frontend directory:
```bash
cd frontend
cp .env.example .env
```

Edit `frontend/.env`:
```env
REACT_APP_CONTRACT_ID=C_YOUR_DEPLOYED_CONTRACT_ID
REACT_APP_API_BASE=http://localhost:3001
```

### 6. Run the React Frontend

```bash
# Install dependencies
npm install

# Start the React app
npm start
```

The app will open in your browser at `http://localhost:3000`. Make sure your Freighter wallet is set to the **Testnet** network and has testnet XLM for transaction fees.

## Running Tests

### Smart Contract Tests
```bash
cd stellar_split_bill
cargo test
```

## API Endpoints

### GET /api/bill/:id
Fetch bill state from the Soroban contract
- Returns current bill data directly from blockchain

### GET /api/bill-count
Get the total number of bills created
- Returns bill count from contract

### GET /health
Health check endpoint
- Returns server status and contract ID

## Smart Contract Functions

### initialize(admin: Address)
Initialize the contract with an admin address. Can only be called once.

### create_bill(payee: Address, token: Address, total_amount: i128) -> u32
Create a new split bill. Returns the bill ID.

### pay_bill(payer: Address, bill_id: u32, amount: i128)
Pay a portion of a bill. Validates amount and bill state.

### get_bill(bill_id: u32) -> SplitBill
Query the status of a bill.

### get_bill_count() -> u32
Get the total number of bills created.

### close_bill(admin: Address, bill_id: u32)
Admin function to close a bill (emergency stop).

### remit(from: Address, to: Address, token: Address, amount: i128)
Direct peer-to-peer payment wrapper.

## Security Features

- **Reentrancy Protection**: Guards prevent reentrancy attacks
- **Overflow Safety**: All arithmetic operations use checked math
- **Input Validation**: Strict bounds checking on all inputs
- **Authorization**: Soroban native auth for all state-changing functions
- **Admin Controls**: Emergency stop functionality for admins
- **Storage Management**: Automatic TTL bumping to prevent data loss

## Web 3 Transaction Flow

1. User connects Freighter wallet to frontend
2. User initiates action (create bill / pay bill)
3. Frontend builds transaction locally using Stellar SDK
4. Frontend sends transaction to Freighter for signing
5. User signs transaction with their private key
6. Frontend submits signed transaction directly to Stellar network
7. User pays their own transaction fees
8. Transaction is executed on-chain

## Event System

The contract emits events for:
- `bill_created`: When a new bill is created
- `bill_paid`: When a payment is made
- `bill_completed`: When a bill is fully funded
- `bill_closed`: When admin closes a bill
- `remit`: When a direct payment is made

## Development

### Smart Contract Development
```bash
cd stellar_split_bill
cargo test
cargo build --target wasm32-unknown-unknown --release
```

### Backend Development
```bash
npm run dev  # Uses nodemon for hot reload
```

### Frontend Development
```bash
cd frontend
npm start
```

## Web 3 Characteristics

This application follows true Web 3 principles:
- ✅ Direct blockchain interaction from frontend
- ✅ User-controlled private keys (via wallet)
- ✅ User-paid transaction fees
- ✅ No backend transaction sponsorship
- ✅ Decentralized transaction submission
- ✅ Transparent on-chain operations
- ✅ Smart contract security best practices
- ✅ Minimal trusted backend components

## License

This project is provided as-is for educational and production use.