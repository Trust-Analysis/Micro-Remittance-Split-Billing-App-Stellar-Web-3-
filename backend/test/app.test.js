const request = require('supertest');
const { createApp } = require('../app');
const { nativeToScVal, StrKey } = require('@stellar/stellar-sdk');

const VALID_TEST_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

describe('Backend Express API', () => {
    describe('GET /health', () => {
        it('should return 200 with server status', async () => {
            const app = createApp({ CONTRACT_ID: '' });
            const res = await request(app).get('/health');

            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.contractConfigured).toBe(false);
            expect(typeof res.body.uptime).toBe('number');
        });

        it('should report contract as configured when valid ID is passed', async () => {
            const app = createApp({ CONTRACT_ID: VALID_TEST_CONTRACT_ID });
            const res = await request(app).get('/health');

            expect(res.status).toBe(200);
            expect(res.body.contractConfigured).toBe(true);
            expect(res.body.contractId).toBe(VALID_TEST_CONTRACT_ID);
        });
    });

    describe('Input Validation on GET /api/bill/:id', () => {
        const app = createApp({ CONTRACT_ID: VALID_TEST_CONTRACT_ID });

        it('should reject non-numeric bill ID with 400', async () => {
            const res = await request(app).get('/api/bill/abc');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/positive integer/i);
        });

        it('should reject negative bill ID with 400', async () => {
            const res = await request(app).get('/api/bill/-5');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject zero bill ID with 400', async () => {
            const res = await request(app).get('/api/bill/0');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject floating-point bill ID with 400', async () => {
            const res = await request(app).get('/api/bill/3.14');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });

        it('should reject bill ID exceeding maximum range with 400', async () => {
            const res = await request(app).get('/api/bill/9999999');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
        });
    });

    describe('Unconfigured Contract Handling', () => {
        it('should return 503 when contract ID is not configured', async () => {
            const app = createApp({ CONTRACT_ID: '' });
            const res = await request(app).get('/api/bill/1');

            expect(res.status).toBe(503);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/not configured/i);
        });

        it('should return 503 on bill count when contract is placeholder', async () => {
            const app = createApp({ CONTRACT_ID: 'C_REPLACE_WITH_YOUR_ACTUAL_CONTRACT_ID' });
            const res = await request(app).get('/api/bill-count');

            expect(res.status).toBe(503);
            expect(res.body.success).toBe(false);
        });
    });

    describe('404 Route Handler', () => {
        it('should return 404 for unknown endpoints', async () => {
            const app = createApp();
            const res = await request(app).get('/api/unknown-endpoint');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/Route not found/);
        });
    });

    describe('Mocked RPC Simulation', () => {
        it('should return parsed bill details when simulation succeeds', async () => {
            const mockServer = {
                simulateTransaction: jest.fn().mockResolvedValue({
                    result: {
                        retval: nativeToScVal({
                            payee: 'GBZXN7PIRZGNMHGA728V3U2D5KCEG535DAHSWEB25AWMSC2BS6CSRTWD',
                            total_amount: 10000000n,
                            amount_collected: 5000000n,
                            is_active: true,
                            participant_count: 1,
                        }),
                    },
                }),
            };

            const app = createApp({
                CONTRACT_ID: VALID_TEST_CONTRACT_ID,
                server: mockServer,
            });

            const res = await request(app).get('/api/bill/1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.billId).toBe(1);
            expect(res.body.bill.is_active).toBe(true);
            expect(res.body.bill.participant_count).toBe(1);
        });

        it('should return 404 when simulation returns error', async () => {
            const mockServer = {
                simulateTransaction: jest.fn().mockResolvedValue({
                    error: 'HostError: Error(Contract, #3)', // BillNotFound
                }),
            };

            const app = createApp({
                CONTRACT_ID: VALID_TEST_CONTRACT_ID,
                server: mockServer,
            });

            const res = await request(app).get('/api/bill/99');

            expect(res.status).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toMatch(/not found/i);
        });

        it('should return bill count when get_bill_count succeeds', async () => {
            const mockServer = {
                simulateTransaction: jest.fn().mockResolvedValue({
                    result: {
                        retval: nativeToScVal(42, { type: 'u32' }),
                    },
                }),
            };

            const app = createApp({
                CONTRACT_ID: VALID_TEST_CONTRACT_ID,
                server: mockServer,
            });

            const res = await request(app).get('/api/bill-count');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.count).toBe(42);
        });
    });
});
