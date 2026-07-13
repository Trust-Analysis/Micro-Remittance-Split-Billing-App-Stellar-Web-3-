import React, { useState } from 'react';
import { isAllowed, setAllowed, requestAccess, signTransaction } from '@stellar/freighter-api';
import { rpc, TransactionBuilder, Networks, BASE_FEE, Contract, nativeToScVal } from '@stellar/stellar-sdk';

export default function App() {
    const [pubKey, setPubKey] = useState('');
    const [billId, setBillId] = useState('');
    const [paymentAmount, setPaymentAmount] = useState('');
    const [billDetails, setBillDetails] = useState(null);

    // 1. Connect to the Freighter Wallet
    const connectWallet = async () => {
        try {
            let allowed = await isAllowed();
            if (!allowed) {
                await setAllowed();
            }
            const publicKey = await requestAccess();
            setPubKey(publicKey);
        } catch (error) {
            console.error("Wallet connection failed:", error);
            alert("Please install Freighter wallet and switch to Testnet!");
        }
    };

    // 2. Fetch Bill Details from our Node.js Backend
    const fetchBill = async () => {
        try {
            const response = await fetch(`http://localhost:3001/api/bill/${billId}`);
            const data = await response.json();
            if (data.success) {
                setBillDetails(data.bill);
            } else {
                alert(data.error);
            }
        } catch (error) {
            console.error("Error fetching bill:", error);
        }
    };

    // 3. Pay the Bill using Freighter signature
    const payBill = async () => {
        if (!pubKey) {
            return alert("Connect your wallet first!");
        }
        if (!paymentAmount || paymentAmount <= 0) {
            return alert("Please enter a valid payment amount.");
        }

        try {
            // Initialize the server and contract
            const server = new rpc.Server('https://soroban-testnet.stellar.org');
            // Make sure this matches your deployed Contract ID!
            const contractId = 'C_REPLACE_WITH_YOUR_ACTUAL_CONTRACT_ID'; 
            const contract = new Contract(contractId);

            // Fetch account details to get the current sequence number
            const account = await server.getAccount(pubKey);

            // Build the transaction
            const txBuilder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET });
            
            // Call the 'pay_bill' function on our Soroban contract
            const operation = contract.call(
                'pay_bill',
                nativeToScVal(pubKey, { type: 'address' }),          // payer
                nativeToScVal(parseInt(billId), { type: 'u32' }),    // bill_id
                nativeToScVal(parseInt(paymentAmount), { type: 'i128' }) // amount
            );

            txBuilder.addOperation(operation).setTimeout(30);
            const builtTx = txBuilder.build();

            // Send to Freighter for user signature
            const signedTxXdr = await signTransaction(builtTx.toXDR(), { network: 'TESTNET', networkPassphrase: Networks.TESTNET });
            
            // Submit the signed transaction to the Stellar network
            const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
            const txResponse = await server.sendTransaction(signedTx);

            if (txResponse.status === "PENDING" || txResponse.status === "SUCCESS") {
                alert("Payment submitted successfully!");
                fetchBill(); // Refresh bill details to show new collected amount
            } else {
                alert("Transaction failed on the network!");
            }
        } catch (error) {
            console.error("Payment error:", error);
            alert("Payment failed: " + error.message);
        }
    };

    return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
            <h1>Micro-Remittance & Split Bill</h1>
            
            {!pubKey ? (
                <button onClick={connectWallet} style={{ padding: '10px', fontSize: '16px' }}>
                    Connect Wallet
                </button>
            ) : (
                <div>
                    <p><strong>Connected:</strong> {pubKey.slice(0, 6)}...{pubKey.slice(-4)}</p>
                    
                    <div style={{ marginTop: '2rem' }}>
                        <h3>Lookup Split Bill</h3>
                        <input 
                            type="number" 
                            value={billId} 
                            onChange={(e) => setBillId(e.target.value)} 
                            placeholder="Enter Bill ID (e.g. 1)"
                            style={{ padding: '8px', marginRight: '10px' }}
                        />
                        <button onClick={fetchBill} style={{ padding: '8px' }}>Fetch</button>
                    </div>
                </div>
            )}

            {billDetails && (
                <div style={{ marginTop: '2rem', padding: '1rem', border: '1px solid #ccc' }}>
                    <h3>Bill #{billId} Details</h3>
                    <p><strong>Payee:</strong> {billDetails.payee}</p>
                    <p><strong>Total Amount:</strong> {billDetails.total_amount}</p>
                    <p><strong>Collected:</strong> {billDetails.amount_collected}</p>
                    <p><strong>Status:</strong> {billDetails.is_active ? "Active" : "Completed"}</p>
                    
                    {billDetails.is_active && (
                        <div style={{ marginTop: '1rem' }}>
                            <input 
                                type="number" 
                                value={paymentAmount} 
                                onChange={(e) => setPaymentAmount(e.target.value)} 
                                placeholder="Amount to pay"
                                style={{ padding: '8px', marginRight: '10px' }}
                            />
                            <button onClick={payBill} style={{ padding: '10px', background: 'green', color: 'white', border: 'none', cursor: 'pointer' }}>
                                Pay Portion
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}