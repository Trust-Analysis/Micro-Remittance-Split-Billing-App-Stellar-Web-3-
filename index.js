require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { 
    rpc, 
    Contract, 
    nativeToScVal, 
    scValToNative, 
    Networks, 
    Keypair, 
    TransactionBuilder, 
    BASE_FEE
} = require('@stellar/stellar-sdk');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize the Stellar RPC client for Testnet
const server = new rpc.Server('https://soroban-testnet.stellar.org');

// Contract configuration
const CONTRACT_ID = process.env.CONTRACT_ID || 'C_REPLACE_WITH_YOUR_ACTUAL_CONTRACT_ID';
const contract = new Contract(CONTRACT_ID);

// Random keypair for read-only transactions
const simulateKeypair = Keypair.random();

/**
 * GET /api/bill/:id
 * Fetches the current state of a Split Bill from the Soroban contract
 */
app.get('/api/bill/:id', async (req, res) => {
    try {
        const billId = parseInt(req.params.id, 10);

        // Build a read-only invocation to the "get_bill" function
        const txBuilder = new TransactionBuilder(await server.getAccount(simulateKeypair.publicKey()), {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
        });

        const operation = contract.call('get_bill', nativeToScVal(billId, { type: 'u32' }));
        const tx = txBuilder.addOperation(operation).setTimeout(30).build();

        // Simulate the transaction to read the state
        const simulation = await server.simulateTransaction(tx);

        if (simulation.error) {
            return res.status(404).json({ error: "Bill not found or contract error" });
        }

        // Convert the returned Soroban Value (ScVal) back to a JavaScript object
        const result = scValToNative(simulation.result.retval);
        
        res.json({ success: true, bill: result });
    } catch (error) {
        console.error("Error fetching bill:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/bill-count
 * Gets the total number of bills created
 */
app.get('/api/bill-count', async (req, res) => {
    try {
        const account = await server.getAccount(simulateKeypair.publicKey());
        const txBuilder = new TransactionBuilder(account, {
            fee: BASE_FEE,
            networkPassphrase: Networks.TESTNET,
        });

        const operation = contract.call('get_bill_count');
        const tx = txBuilder.addOperation(operation).setTimeout(30).build();

        const simulation = await server.simulateTransaction(tx);

        if (simulation.error) {
            return res.status(400).json({ error: simulation.error });
        }

        const result = scValToNative(simulation.result.retval);
        res.json({ success: true, count: result });
    } catch (error) {
        console.error("Error fetching bill count:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
    res.json({ status: 'ok', contract: CONTRACT_ID });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Web 3 Backend server running on http://localhost:${PORT}`);
    console.log(`Contract ID: ${CONTRACT_ID}`);
    console.log(`Network: Testnet`);
});