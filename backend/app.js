const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const {
    rpc,
    Contract,
    nativeToScVal,
    scValToNative,
    Networks,
    Keypair,
    TransactionBuilder,
    Account,
    BASE_FEE,
} = require('@stellar/stellar-sdk');

/**
 * Recursively converts BigInt values safely for JSON serialization.
 * Numbers within safe integer range are converted to JavaScript Numbers;
 * larger values (like large i128 amounts) are converted to string representation.
 */
function serializeSorobanValue(value) {
    if (typeof value === 'bigint') {
        if (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)) {
            return Number(value);
        }
        return value.toString();
    }
    if (Array.isArray(value)) {
        return value.map(serializeSorobanValue);
    }
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = serializeSorobanValue(v);
        }
        return out;
    }
    return value;
}

function createApp(config = {}) {
    const app = express();

    const CONTRACT_ID = config.CONTRACT_ID || process.env.CONTRACT_ID || '';
    const RPC_URL = config.RPC_URL || process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
    const NETWORK_PASSPHRASE = config.NETWORK_PASSPHRASE || process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
    const CORS_ORIGIN = config.CORS_ORIGIN || process.env.CORS_ORIGIN || 'http://localhost:3000';

    // In-memory or injected server client for RPC calls
    const server = config.server || new rpc.Server(RPC_URL);

    // Dummy account for read-only simulations (does not query network for sequence number)
    const readKeypair = Keypair.random();
    const readAccount = new Account(readKeypair.publicKey(), '0');

    // Security middlewares
    app.use(helmet());

    const allowedOrigins = CORS_ORIGIN.split(',').map((o) => o.trim());
    app.use(
        cors({
            origin: (origin, callback) => {
                // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
                if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
                    callback(null, true);
                } else {
                    callback(new Error('Blocked by CORS policy'));
                }
            },
            methods: ['GET', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization'],
        })
    );

    // Rate limiting: 100 requests per 15 minutes per IP
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: 'Too many requests, please try again later.' },
    });
    app.use('/api/', limiter);

    app.use(express.json());

    /**
     * GET /health
     * Health check endpoint
     */
    app.get('/health', (req, res) => {
        const isContractConfigured = Boolean(
            CONTRACT_ID &&
            CONTRACT_ID.startsWith('C') &&
            CONTRACT_ID.length === 56 &&
            !CONTRACT_ID.includes('REPLACE')
        );

        res.json({
            status: 'ok',
            uptime: process.uptime(),
            network: NETWORK_PASSPHRASE === Networks.TESTNET ? 'testnet' : 'custom',
            contractConfigured: isContractConfigured,
            contractId: isContractConfigured ? CONTRACT_ID : 'NOT_CONFIGURED',
            timestamp: new Date().toISOString(),
        });
    });

    /**
     * GET /api/bill/:id
     * Fetches current state of a Split Bill from Soroban
     */
    app.get('/api/bill/:id', async (req, res, next) => {
        try {
            const rawId = req.params.id;
            const billId = parseInt(rawId, 10);

            if (isNaN(billId) || billId <= 0 || billId > 1_000_000 || String(billId) !== rawId) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid bill ID: must be a positive integer between 1 and 1,000,000',
                });
            }

            if (!CONTRACT_ID || CONTRACT_ID.includes('REPLACE')) {
                return res.status(503).json({
                    success: false,
                    error: 'Contract ID is not configured on this server',
                });
            }

            const contract = new Contract(CONTRACT_ID);

            // Build read-only invocation without hitting network for sequence
            const txBuilder = new TransactionBuilder(readAccount, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            });

            const operation = contract.call('get_bill', nativeToScVal(billId, { type: 'u32' }));
            const tx = txBuilder.addOperation(operation).setTimeout(30).build();

            const simulation = await server.simulateTransaction(tx);

            if (simulation.error) {
                return res.status(404).json({
                    success: false,
                    error: `Bill #${billId} not found or simulation error`,
                    details: simulation.error,
                });
            }

            if (!simulation.result || !simulation.result.retval) {
                return res.status(404).json({
                    success: false,
                    error: `Bill #${billId} not found`,
                });
            }

            const nativeResult = scValToNative(simulation.result.retval);
            const serialized = serializeSorobanValue(nativeResult);
            res.json({ success: true, billId, bill: serialized });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /api/bill-count
     * Fetches total number of bills created
     */
    app.get('/api/bill-count', async (req, res, next) => {
        try {
            if (!CONTRACT_ID || CONTRACT_ID.includes('REPLACE')) {
                return res.status(503).json({
                    success: false,
                    error: 'Contract ID is not configured on this server',
                });
            }

            const contract = new Contract(CONTRACT_ID);

            const txBuilder = new TransactionBuilder(readAccount, {
                fee: BASE_FEE,
                networkPassphrase: NETWORK_PASSPHRASE,
            });

            const operation = contract.call('get_bill_count');
            const tx = txBuilder.addOperation(operation).setTimeout(30).build();

            const simulation = await server.simulateTransaction(tx);

            if (simulation.error) {
                return res.status(400).json({
                    success: false,
                    error: 'Failed to read bill count from contract',
                    details: simulation.error,
                });
            }

            const nativeResult = scValToNative(simulation.result.retval);
            const serialized = serializeSorobanValue(nativeResult);
            res.json({ success: true, count: serialized });
        } catch (error) {
            next(error);
        }
    });

    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            error: `Route not found: ${req.method} ${req.url}`,
        });
    });

    // Centralized error handler
    app.use((err, req, res, _next) => {
        console.error(`[Error] ${req.method} ${req.url}:`, err.message || err);
        const statusCode = err.status || 500;
        res.status(statusCode).json({
            success: false,
            error: err.message || 'Internal server error',
        });
    });

    return app;
}

module.exports = { createApp, serializeSorobanValue };
