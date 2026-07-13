import React, { useState, useEffect } from 'react';
import { isAllowed, setAllowed, requestAccess, signTransaction, getPublicKey } from '@stellar/freighter-api';
import { rpc, TransactionBuilder, Networks, BASE_FEE, Contract, nativeToScVal } from '@stellar/stellar-sdk';

const CONTRACT_ID = process.env.REACT_APP_CONTRACT_ID || 'C_REPLACE_WITH_YOUR_ACTUAL_CONTRACT_ID';
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001';
const contract = new Contract(CONTRACT_ID);

export default function App() {
  const [pubKey, setPubKey] = useState('');
  const [walletStatus, setWalletStatus] = useState('disconnected');
  const [network, setNetwork] = useState('unknown');
  const [billId, setBillId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [billDetails, setBillDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCreateBill, setShowCreateBill] = useState(false);
  const [newBill, setNewBill] = useState({ payee: '', token: '', totalAmount: '' });

  const server = new rpc.Server('https://soroban-testnet.stellar.org');

  useEffect(() => {
    checkWalletConnection();
  }, []);

  const checkWalletConnection = async () => {
    try {
      const allowed = await isAllowed();
      if (allowed) {
        const publicKey = await getPublicKey();
        setPubKey(publicKey);
        setWalletStatus('connected');
        setNetwork('TESTNET');
      }
    } catch (error) {
      console.error("Wallet check failed:", error);
      setWalletStatus('error');
    }
  };

  const connectWallet = async () => {
    setWalletStatus('connecting');
    setError(null);
    
    try {
      let allowed = await isAllowed();
      if (!allowed) {
        await setAllowed();
      }
      
      const publicKey = await requestAccess();
      setPubKey(publicKey);
      setWalletStatus('connected');
      setNetwork('TESTNET');
    } catch (error) {
      console.error("Wallet connection failed:", error);
      setWalletStatus('error');
      setError("Failed to connect wallet. Please ensure Freighter is installed and set to Testnet.");
    }
  };

  const disconnectWallet = () => {
    setPubKey('');
    setWalletStatus('disconnected');
    setBillDetails(null);
  };

  const fetchBill = async (id) => {
    if (!id) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`${API_BASE}/api/bill/${id}`);
      const data = await response.json();
      
      if (data.success) {
        setBillDetails(data.bill);
      } else {
        setError(data.error || 'Failed to fetch bill');
      }
    } catch (error) {
      console.error("Error fetching bill:", error);
      setError("Network error while fetching bill");
    } finally {
      setLoading(false);
    }
  };

  const createBill = async () => {
    if (!pubKey) {
      return setError("Please connect your wallet first");
    }
    if (!newBill.payee || !newBill.totalAmount) {
      return setError("Please fill in all required fields");
    }

    setLoading(true);
    setError(null);

    try {
      // Get account info
      const account = await server.getAccount(pubKey);
      
      // Build transaction
      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      });

      const operation = contract.call(
        'create_bill',
        nativeToScVal(newBill.payee, { type: 'address' }),
        nativeToScVal(newBill.token || pubKey, { type: 'address' }),
        nativeToScVal(parseInt(newBill.totalAmount), { type: 'i128' })
      );

      const tx = txBuilder.addOperation(operation).setTimeout(30).build();

      // Sign with Freighter
      const signedTxXdr = await signTransaction(tx.toXDR(), { 
        network: 'TESTNET', 
        networkPassphrase: Networks.TESTNET 
      });
      
      // Submit to network
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const txResponse = await server.sendTransaction(signedTx);

      if (txResponse.status === "PENDING" || txResponse.status === "SUCCESS") {
        setShowCreateBill(false);
        setNewBill({ payee: '', token: '', totalAmount: '' });
        alert("Bill created successfully!");
      } else {
        setError("Transaction failed on the network!");
      }
    } catch (error) {
      console.error("Create bill error:", error);
      setError(error.message || "Failed to create bill");
    } finally {
      setLoading(false);
    }
  };

  const payBill = async () => {
    if (!pubKey) {
      return setError("Please connect your wallet first");
    }
    if (!billId || !paymentAmount || paymentAmount <= 0) {
      return setError("Please enter a valid bill ID and payment amount");
    }

    setLoading(true);
    setError(null);

    try {
      // Get account info
      const account = await server.getAccount(pubKey);
      
      // Build transaction
      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      });

      const operation = contract.call(
        'pay_bill',
        nativeToScVal(pubKey, { type: 'address' }),
        nativeToScVal(parseInt(billId), { type: 'u32' }),
        nativeToScVal(parseInt(paymentAmount), { type: 'i128' })
      );

      const tx = txBuilder.addOperation(operation).setTimeout(30).build();

      // Sign with Freighter
      const signedTxXdr = await signTransaction(tx.toXDR(), { 
        network: 'TESTNET', 
        networkPassphrase: Networks.TESTNET 
      });
      
      // Submit to network
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const txResponse = await server.sendTransaction(signedTx);

      if (txResponse.status === "PENDING" || txResponse.status === "SUCCESS") {
        // Refresh bill details
        await fetchBill(billId);
        setPaymentAmount('');
        alert("Payment submitted successfully!");
      } else {
        setError("Transaction failed on the network!");
      }
    } catch (error) {
      console.error("Payment error:", error);
      setError(error.message || "Payment failed");
    } finally {
      setLoading(false);
    }
  };

  const formatAddress = (address) => {
    if (!address) return '';
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatAmount = (amount) => {
    if (!amount) return '0';
    return (amount / 10000000).toFixed(7);
  };

  return (
    <div style={{ 
      padding: '2rem', 
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      maxWidth: '800px',
      margin: '0 auto',
      backgroundColor: '#f5f5f5',
      minHeight: '100vh'
    }}>
      <div style={{ 
        backgroundColor: 'white', 
        padding: '2rem', 
        borderRadius: '8px', 
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '2rem'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, color: '#1a1a1a' }}>Micro-Remittance & Split Bill</h1>
            <p style={{ margin: '0.5rem 0 0 0', color: '#666' }}>
              Stellar Web 3 Decentralized Application
            </p>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            {walletStatus === 'connected' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ 
                  padding: '0.5rem 1rem', 
                  backgroundColor: '#e8f5e9', 
                  borderRadius: '4px',
                  color: '#2e7d32',
                  fontSize: '0.875rem'
                }}>
                  <strong>Network:</strong> {network}
                </div>
                <div style={{ 
                  padding: '0.5rem 1rem', 
                  backgroundColor: '#e3f2fd', 
                  borderRadius: '4px',
                  color: '#1565c0',
                  fontSize: '0.875rem'
                }}>
                  <strong>Connected:</strong> {formatAddress(pubKey)}
                </div>
                <button 
                  onClick={disconnectWallet}
                  style={{ 
                    padding: '0.5rem 1rem', 
                    backgroundColor: '#f44336', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button 
                onClick={connectWallet}
                disabled={walletStatus === 'connecting'}
                style={{ 
                  padding: '0.75rem 1.5rem', 
                  fontSize: '1rem',
                  backgroundColor: walletStatus === 'connecting' ? '#9e9e9e' : '#2196f3',
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px',
                  cursor: walletStatus === 'connecting' ? 'not-allowed' : 'pointer'
                }}
              >
                {walletStatus === 'connecting' ? 'Connecting...' : 'Connect Wallet'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ 
          padding: '1rem', 
          backgroundColor: '#ffebee', 
          border: '1px solid #ef5350', 
          borderRadius: '4px',
          color: '#c62828',
          marginBottom: '1rem'
        }}>
          {error}
        </div>
      )}

      {walletStatus === 'connected' && (
        <div>
          <div style={{ 
            backgroundColor: 'white', 
            padding: '1.5rem', 
            borderRadius: '8px', 
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            marginBottom: '1.5rem'
          }}>
            <h2 style={{ marginTop: 0, color: '#1a1a1a' }}>Actions</h2>
            
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <button
                onClick={() => setShowCreateBill(!showCreateBill)}
                style={{
                  padding: '0.75rem 1.5rem',
                  backgroundColor: showCreateBill ? '#f44336' : '#4caf50',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                {showCreateBill ? 'Cancel' : 'Create New Bill'}
              </button>
            </div>

            {showCreateBill && (
              <div style={{ 
                padding: '1rem', 
                backgroundColor: '#f5f5f5', 
                borderRadius: '4px',
                marginTop: '1rem'
              }}>
                <h3 style={{ marginTop: 0 }}>Create Split Bill</h3>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    Payee Address:
                  </label>
                  <input
                    type="text"
                    value={newBill.payee}
                    onChange={(e) => setNewBill({...newBill, payee: e.target.value})}
                    placeholder="Enter payee Stellar address"
                    style={{ 
                      width: '100%', 
                      padding: '0.5rem', 
                      border: '1px solid #ddd', 
                      borderRadius: '4px' 
                    }}
                  />
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    Token Address (optional):
                  </label>
                  <input
                    type="text"
                    value={newBill.token}
                    onChange={(e) => setNewBill({...newBill, token: e.target.value})}
                    placeholder="Leave empty for native XLM"
                    style={{ 
                      width: '100%', 
                      padding: '0.5rem', 
                      border: '1px solid #ddd', 
                      borderRadius: '4px' 
                    }}
                  />
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    Total Amount (stroops):
                  </label>
                  <input
                    type="number"
                    value={newBill.totalAmount}
                    onChange={(e) => setNewBill({...newBill, totalAmount: e.target.value})}
                    placeholder="Enter amount in stroops (1 XLM = 10,000,000 stroops)"
                    style={{ 
                      width: '100%', 
                      padding: '0.5rem', 
                      border: '1px solid #ddd', 
                      borderRadius: '4px' 
                    }}
                  />
                </div>
                <button
                  onClick={createBill}
                  disabled={loading}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: loading ? '#9e9e9e' : '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: loading ? 'not-allowed' : 'pointer'
                  }}
                >
                  {loading ? 'Creating...' : 'Create Bill'}
                </button>
              </div>
            )}

            {!showCreateBill && (
              <div style={{ 
                padding: '1rem', 
                backgroundColor: '#f5f5f5', 
                borderRadius: '4px',
                marginTop: '1rem'
              }}>
                <h3 style={{ marginTop: 0 }}>Pay Existing Bill</h3>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                    Bill ID:
                  </label>
                  <input 
                    type="number" 
                    value={billId} 
                    onChange={(e) => setBillId(e.target.value)} 
                    placeholder="Enter Bill ID"
                    style={{ 
                      width: '100%', 
                      padding: '0.5rem', 
                      border: '1px solid #ddd', 
                      borderRadius: '4px' 
                    }}
                  />
                </div>
                <button 
                  onClick={() => fetchBill(billId)}
                  disabled={loading}
                  style={{
                    padding: '0.75rem 1.5rem',
                    backgroundColor: loading ? '#9e9e9e' : '#2196f3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    marginRight: '0.5rem'
                  }}
                >
                  {loading ? 'Loading...' : 'Fetch Bill'}
                </button>
              </div>
            )}
          </div>

          {billDetails && (
            <div style={{ 
              backgroundColor: 'white', 
              padding: '1.5rem', 
              borderRadius: '8px', 
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              marginBottom: '1.5rem'
            }}>
              <h2 style={{ marginTop: 0, color: '#1a1a1a' }}>Bill #{billId} Details</h2>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Payee:</strong> {formatAddress(billDetails.payee)}
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Total Amount:</strong> {formatAmount(billDetails.total_amount)} XLM
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Collected:</strong> {formatAmount(billDetails.amount_collected)} XLM
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Progress:</strong> {((billDetails.amount_collected / billDetails.total_amount) * 100).toFixed(2)}%
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>Participants:</strong> {billDetails.participant_count}
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <strong>Status:</strong> 
                <span style={{ 
                  marginLeft: '0.5rem',
                  padding: '0.25rem 0.5rem',
                  borderRadius: '4px',
                  backgroundColor: billDetails.is_active ? '#e8f5e9' : '#ffebee',
                  color: billDetails.is_active ? '#2e7d32' : '#c62828'
                }}>
                  {billDetails.is_active ? "Active" : "Completed"}
                </span>
              </div>
              
              <div style={{ 
                height: '20px', 
                backgroundColor: '#e0e0e0', 
                borderRadius: '10px',
                marginBottom: '1rem',
                overflow: 'hidden'
              }}>
                <div style={{ 
                  height: '100%', 
                  backgroundColor: '#4caf50',
                  width: `${(billDetails.amount_collected / billDetails.total_amount) * 100}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              
              {billDetails.is_active && (
                <div>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 'bold' }}>
                      Payment Amount (stroops):
                    </label>
                    <input 
                      type="number" 
                      value={paymentAmount} 
                      onChange={(e) => setPaymentAmount(e.target.value)} 
                      placeholder="Enter amount to pay"
                      style={{ 
                        width: '100%', 
                        padding: '0.5rem', 
                        border: '1px solid #ddd', 
                        borderRadius: '4px' 
                      }}
                    />
                  </div>
                  <button 
                    onClick={payBill}
                    disabled={loading}
                    style={{
                      padding: '0.75rem 1.5rem',
                      backgroundColor: loading ? '#9e9e9e' : '#4caf50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontSize: '1rem'
                    }}
                  >
                    {loading ? 'Processing...' : 'Pay Portion'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {walletStatus === 'disconnected' && (
        <div style={{ 
          textAlign: 'center', 
          padding: '3rem', 
          backgroundColor: 'white', 
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
          <h2 style={{ color: '#1a1a1a' }}>Connect Your Wallet</h2>
          <p style={{ color: '#666', marginBottom: '1.5rem' }}>
            Please connect your Freighter wallet to access the Split Bill application
          </p>
          <button 
            onClick={connectWallet}
            style={{
              padding: '1rem 2rem',
              fontSize: '1.125rem',
              backgroundColor: '#2196f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Connect Freighter Wallet
          </button>
        </div>
      )}
    </div>
  );
}
