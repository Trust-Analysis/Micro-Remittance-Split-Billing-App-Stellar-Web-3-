require('dotenv').config();
const { createApp } = require('./app');

const PORT = parseInt(process.env.PORT, 10) || 3001;
const CONTRACT_ID = process.env.CONTRACT_ID || '';
const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';

// Startup environment validation
console.log('--- Starting Stellar Split-Bill Read Proxy ---');
if (!CONTRACT_ID || CONTRACT_ID.includes('REPLACE')) {
    console.warn('[WARN] CONTRACT_ID is not configured or using default placeholder.');
    console.warn('       Contract read routes will return 503 until a valid CONTRACT_ID is provided in .env');
} else if (!CONTRACT_ID.startsWith('C') || CONTRACT_ID.length !== 56) {
    console.warn(`[WARN] CONTRACT_ID '${CONTRACT_ID}' does not match standard Stellar contract address format (C... 56 chars).`);
} else {
    console.log(`[INFO] Configured Contract ID: ${CONTRACT_ID}`);
}
console.log(`[INFO] Stellar RPC URL: ${RPC_URL}`);

const app = createApp({
    CONTRACT_ID,
    RPC_URL,
});

const server = app.listen(PORT, () => {
    console.log(`[INFO] Server running on http://localhost:${PORT}`);
    console.log(`[INFO] Health check available at http://localhost:${PORT}/health`);
});

// Graceful shutdown
function shutdown(signal) {
    console.log(`\n[INFO] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
        console.log('[INFO] HTTP server closed. Process terminating.');
        process.exit(0);
    });

    // Force terminate after 5 seconds if connections remain open
    setTimeout(() => {
        console.error('[ERROR] Force terminating after shutdown timeout.');
        process.exit(1);
    }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));