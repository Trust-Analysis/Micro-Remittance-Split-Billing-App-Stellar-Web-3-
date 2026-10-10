import React, { useState, useEffect, useCallback } from 'react';
import {
  isAllowed,
  setAllowed,
  requestAccess,
  signTransaction,
  getPublicKey,
  getNetwork,
  isConnected,
} from '@stellar/freighter-api';
import {
  rpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Contract,
  nativeToScVal,
} from '@stellar/stellar-sdk';

const CONTRACT_ID =
  process.env.REACT_APP_CONTRACT_ID ||
  'CA3D5KRYMCMCZWHSUK4D367HMCZ5EBR67V3O624I7H2PVRR4YDY7L27T'; // Testnet fallback placeholder
const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:3001';
const SOROBAN_RPC_URL =
  process.env.REACT_APP_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';

const contract = new Contract(CONTRACT_ID);
const server = new rpc.Server(SOROBAN_RPC_URL);

export default function App() {
  const [pubKey, setPubKey] = useState('');
  const [walletStatus, setWalletStatus] = useState('disconnected'); // 'disconnected' | 'connecting' | 'connected' | 'uninstalled'
  const [network, setNetwork] = useState('');
  const [activeTab, setActiveTab] = useState('lookup'); // 'lookup' | 'create'
  
  // Bill state
  const [billId, setBillId] = useState('1');
  const [billDetails, setBillDetails] = useState(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // New bill state
  const [newBill, setNewBill] = useState({
    payee: '',
    token: '',
    totalAmountXlm: '',
  });

  // Tx tracking
  const [txTracking, setTxTracking] = useState({
    status: null, // 'simulating' | 'signing' | 'submitting' | 'pending' | 'success' | 'failed'
    hash: null,
    error: null,
  });

  const checkWalletConnection = useCallback(async () => {
    try {
      const extensionAvailable = await isConnected();
      if (!extensionAvailable) {
        setWalletStatus('uninstalled');
        return;
      }

      const allowed = await isAllowed();
      if (allowed) {
        const publicKey = await getPublicKey();
        if (publicKey) {
          setPubKey(publicKey);
          setWalletStatus('connected');
          const currentNet = await getNetwork();
          setNetwork(currentNet || 'TESTNET');
        }
      }
    } catch (err) {
      console.warn('Initial wallet check info:', err.message || err);
    }
  }, []);

  useEffect(() => {
    checkWalletConnection();
  }, [checkWalletConnection]);

  const connectWallet = async () => {
    setWalletStatus('connecting');
    setError(null);

    try {
      const extensionAvailable = await isConnected();
      if (!extensionAvailable) {
        setWalletStatus('uninstalled');
        setError('Freighter extension not detected. Please install Freighter from freighter.app.');
        return;
      }

      let allowed = await isAllowed();
      if (!allowed) {
        await setAllowed();
      }

      const publicKey = await requestAccess();
      if (!publicKey) {
        throw new Error('Access denied by user');
      }

      setPubKey(publicKey);
      setWalletStatus('connected');

      let currentNet = 'TESTNET';
      try {
        currentNet = await getNetwork();
      } catch (e) {
        // Fallback default
      }
      setNetwork(currentNet || 'TESTNET');
    } catch (err) {
      console.error('Wallet connection failed:', err);
      setWalletStatus('disconnected');
      setError(err.message || 'Failed to connect Freighter wallet.');
    }
  };

  const disconnectWallet = () => {
    setPubKey('');
    setWalletStatus('disconnected');
    setBillDetails(null);
    setTxTracking({ status: null, hash: null, error: null });
  };

  const formatAddress = (addr) => {
    if (!addr) return '';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const stroopsToXlm = (stroops) => {
    if (!stroops) return '0.0000000';
    try {
      const val = typeof stroops === 'bigint' ? stroops : BigInt(stroops);
      const integerPart = val / 10000000n;
      const fracPart = (val % 10000000n).toString().padStart(7, '0');
      return `${integerPart}.${fracPart}`;
    } catch {
      return (Number(stroops) / 10000000).toFixed(7);
    }
  };

  const xlmToStroops = (xlmStr) => {
    const parsed = parseFloat(xlmStr);
    if (isNaN(parsed) || parsed <= 0) return 0n;
    return BigInt(Math.round(parsed * 10000000));
  };

  // Poll transaction status from Soroban RPC
  const pollTxStatus = async (txHash) => {
    setTxTracking({ status: 'pending', hash: txHash, error: null });
    const maxAttempts = 15;
    const intervalMs = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      try {
        const txStatus = await server.getTransaction(txHash);
        if (txStatus.status === 'SUCCESS') {
          setTxTracking({ status: 'success', hash: txHash, error: null });
          return true;
        } else if (txStatus.status === 'FAILED') {
          setTxTracking({
            status: 'failed',
            hash: txHash,
            error: 'Transaction failed on-chain.',
          });
          return false;
        }
      } catch (e) {
        // Continue polling until timeout
      }
    }

    setTxTracking({
      status: 'pending',
      hash: txHash,
      error: 'Transaction broadcasted. Still confirming on ledger...',
    });
    return true;
  };

  const fetchBill = async (idToFetch) => {
    const id = idToFetch || billId;
    if (!id || isNaN(parseInt(id, 10))) {
      setError('Please provide a valid numeric Bill ID.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/bill/${id}`);
      const data = await response.json();

      if (data.success && data.bill) {
        setBillDetails(data.bill);
      } else {
        setError(data.error || `Bill #${id} not found.`);
        setBillDetails(null);
      }
    } catch (err) {
      console.error('Error fetching bill:', err);
      setError(`Failed to reach backend at ${API_BASE}. Make sure the backend server is running.`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBill = async (e) => {
    e.preventDefault();
    if (!pubKey) {
      setError('Connect your wallet before creating a bill.');
      return;
    }

    const payee = newBill.payee.trim();
    if (!payee || (!payee.startsWith('G') && !payee.startsWith('C'))) {
      setError('Please provide a valid Stellar address for Payee (starts with G or C).');
      return;
    }

    const amountStroops = xlmToStroops(newBill.totalAmountXlm);
    if (amountStroops <= 0n) {
      setError('Total amount must be greater than 0 XLM.');
      return;
    }

    const tokenAddress = newBill.token.trim() || pubKey;

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setTxTracking({ status: 'simulating', hash: null, error: null });

    try {
      const account = await server.getAccount(pubKey);
      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      });

      const op = contract.call(
        'create_bill',
        nativeToScVal(payee, { type: 'address' }),
        nativeToScVal(tokenAddress, { type: 'address' }),
        nativeToScVal(amountStroops, { type: 'i128' })
      );

      const rawTx = txBuilder.addOperation(op).setTimeout(60).build();

      const sim = await server.simulateTransaction(rawTx);
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error || 'Contract rejected call'}`);
      }

      setTxTracking({ status: 'signing', hash: null, error: null });
      const assembledTx = rpc.assembleTransaction(rawTx, sim).build();

      const signedTxXdr = await signTransaction(assembledTx.toXDR(), {
        network: 'TESTNET',
        networkPassphrase: Networks.TESTNET,
      });

      setTxTracking({ status: 'submitting', hash: null, error: null });
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const sendResponse = await server.sendTransaction(signedTx);

      if (sendResponse.status === 'ERROR') {
        throw new Error(`RPC submission error: ${sendResponse.errorResultXdr || 'Rejected'}`);
      }

      const txHash = sendResponse.hash;
      await pollTxStatus(txHash);

      setSuccessMsg('Bill created successfully!');
      setNewBill({ payee: '', token: '', totalAmountXlm: '' });
      setActiveTab('lookup');
    } catch (err) {
      console.error('Create bill error:', err);
      setError(err.message || 'Failed to create bill.');
      setTxTracking({ status: 'failed', hash: null, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handlePayBill = async () => {
    if (!pubKey) {
      setError('Connect your wallet before paying.');
      return;
    }
    if (!billDetails) {
      setError('Please fetch bill details first.');
      return;
    }

    if (!billDetails.is_active) {
      setError('This bill is already completed or closed.');
      return;
    }

    if (pubKey === billDetails.payee) {
      setError('The bill payee cannot contribute to their own bill.');
      return;
    }

    const payStroops = BigInt(paymentAmount || 0);
    const remaining = BigInt(billDetails.total_amount) - BigInt(billDetails.amount_collected);

    if (payStroops <= 0n) {
      setError('Payment amount must be greater than zero.');
      return;
    }

    if (payStroops > remaining) {
      setError(`Payment exceeds remaining bill requirement (${stroopsToXlm(remaining)} XLM).`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setTxTracking({ status: 'simulating', hash: null, error: null });

    try {
      const account = await server.getAccount(pubKey);
      const txBuilder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: Networks.TESTNET,
      });

      const op = contract.call(
        'pay_bill',
        nativeToScVal(pubKey, { type: 'address' }),
        nativeToScVal(parseInt(billId, 10), { type: 'u32' }),
        nativeToScVal(payStroops, { type: 'i128' })
      );

      const rawTx = txBuilder.addOperation(op).setTimeout(60).build();

      const sim = await server.simulateTransaction(rawTx);
      if (rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${sim.error || 'Contract rejected payment'}`);
      }

      setTxTracking({ status: 'signing', hash: null, error: null });
      const assembledTx = rpc.assembleTransaction(rawTx, sim).build();

      const signedTxXdr = await signTransaction(assembledTx.toXDR(), {
        network: 'TESTNET',
        networkPassphrase: Networks.TESTNET,
      });

      setTxTracking({ status: 'submitting', hash: null, error: null });
      const signedTx = TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
      const sendResponse = await server.sendTransaction(signedTx);

      if (sendResponse.status === 'ERROR') {
        throw new Error(`RPC submission error: ${sendResponse.errorResultXdr || 'Rejected'}`);
      }

      const txHash = sendResponse.hash;
      await pollTxStatus(txHash);

      setSuccessMsg(`Payment of ${stroopsToXlm(payStroops)} XLM submitted!`);
      setPaymentAmount('');
      // Refresh bill details
      await fetchBill(billId);
    } catch (err) {
      console.error('Payment error:', err);
      setError(err.message || 'Payment transaction failed.');
      setTxTracking({ status: 'failed', hash: null, error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Quick fill calculations
  const calculateQuickFill = (ratio) => {
    if (!billDetails) return;
    const remaining = BigInt(billDetails.total_amount) - BigInt(billDetails.amount_collected);
    if (remaining <= 0n) return;
    const amt = (remaining * BigInt(Math.round(ratio * 100))) / 100n;
    setPaymentAmount(amt.toString());
  };

  const progressPercent = billDetails
    ? Math.min(
        100,
        Math.max(
          0,
          (Number(billDetails.amount_collected) / Number(billDetails.total_amount)) * 100
        )
      )
    : 0;

  return (
    <div className="app-layout">
      <div className="container">
        {/* Navigation & Wallet Bar */}
        <header className="header-card" id="app-header">
          <div className="brand-wrapper">
            <div className="brand-icon" aria-hidden="true">✦</div>
            <div>
              <h1 className="brand-title">Stellar Split</h1>
              <p className="brand-subtitle">Micro-Remittance & Split-Billing Protocol on Soroban</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {walletStatus === 'connected' ? (
              <>
                <div
                  className={`status-pill ${network === 'TESTNET' ? 'testnet' : 'warning'}`}
                  id="network-badge"
                >
                  <span className="pulse-dot" />
                  <span>{network || 'TESTNET'}</span>
                </div>
                <div className="status-pill account" id="wallet-address-badge">
                  {formatAddress(pubKey)}
                </div>
                <button
                  id="disconnect-wallet-btn"
                  onClick={disconnectWallet}
                  className="btn btn-secondary"
                  style={{ padding: '0.4rem 0.85rem', fontSize: '0.8125rem' }}
                >
                  Disconnect
                </button>
              </>
            ) : walletStatus === 'uninstalled' ? (
              <a
                href="https://www.freighter.app"
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                id="install-freighter-btn"
              >
                Install Freighter
              </a>
            ) : (
              <button
                id="connect-wallet-btn"
                onClick={connectWallet}
                disabled={walletStatus === 'connecting'}
                className="btn btn-primary"
              >
                {walletStatus === 'connecting' ? 'Connecting...' : 'Connect Freighter'}
              </button>
            )}
          </div>
        </header>

        {/* Network Warning Banner if user is on Mainnet instead of Testnet */}
        {network && network !== 'TESTNET' && walletStatus === 'connected' && (
          <div className="alert warning" id="network-warning-banner">
            <span>⚠️</span>
            <div>
              <strong>Active Network Warning:</strong> Your Freighter wallet is connected to{' '}
              <strong>{network}</strong>. This application is configured for{' '}
              <strong>Stellar Testnet</strong>. Please open Freighter and switch your network to
              Testnet.
            </div>
          </div>
        )}

        {/* Global Notifications */}
        {error && (
          <div className="alert error" id="global-error-banner">
            <span>✕</span>
            <div style={{ flex: 1 }}>{error}</div>
            <button
              onClick={() => setError(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {successMsg && (
          <div className="alert success" id="global-success-banner">
            <span>✓</span>
            <div style={{ flex: 1 }}>{successMsg}</div>
            <button
              onClick={() => setSuccessMsg(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
              aria-label="Dismiss message"
            >
              ×
            </button>
          </div>
        )}

        {/* Transaction Status Tracker */}
        {txTracking.status && (
          <div className="tx-status-banner" id="tx-tracker-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <span className="pulse-dot" />
              <strong style={{ textTransform: 'capitalize' }}>
                Status: {txTracking.status}
              </strong>
            </div>
            {txTracking.hash && (
              <div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tx Hash: </span>
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${txTracking.hash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="tx-link"
                  id="stellar-expert-tx-link"
                >
                  {txTracking.hash} ↗
                </a>
              </div>
            )}
            {txTracking.error && (
              <p style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
                {txTracking.error}
              </p>
            )}
          </div>
        )}

        {/* Tab Controls */}
        <div className="tab-group" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'lookup'}
            id="tab-lookup"
            onClick={() => setActiveTab('lookup')}
            className={`tab-btn ${activeTab === 'lookup' ? 'active' : ''}`}
          >
            Find & Settle Bill
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'create'}
            id="tab-create"
            onClick={() => setActiveTab('create')}
            className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`}
          >
            Create New Bill
          </button>
        </div>

        {/* Tab Content: Lookup & Settle */}
        {activeTab === 'lookup' && (
          <>
            <section className="glass-card" aria-labelledby="lookup-title">
              <h2 className="card-title" id="lookup-title">
                Query Split Bill
              </h2>
              <p className="card-description">
                Retrieve verified on-chain bill status and contribute remittances in real-time.
              </p>

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1', minWidth: '180px' }}>
                  <input
                    id="bill-id-input"
                    type="number"
                    min="1"
                    value={billId}
                    onChange={(e) => setBillId(e.target.value)}
                    placeholder="Enter numeric Bill ID (e.g. 1)"
                    className="form-input"
                  />
                </div>
                <button
                  id="fetch-bill-btn"
                  onClick={() => fetchBill(billId)}
                  disabled={loading}
                  className="btn btn-primary"
                >
                  {loading ? 'Fetching...' : 'Query Bill'}
                </button>
              </div>
            </section>

            {/* Bill Details Display */}
            {billDetails && (
              <section className="glass-card" id="bill-details-card" aria-labelledby="bill-details-heading">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h2 className="card-title" id="bill-details-heading">
                    Bill #{billDetails.id}
                  </h2>
                  <div
                    className={`status-pill ${billDetails.is_active ? 'testnet' : 'danger'}`}
                    id="bill-status-pill"
                  >
                    <span className="pulse-dot" />
                    <span>{billDetails.is_active ? 'Active & Open' : 'Completed / Closed'}</span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                    <span>Remittance Funding Progress</span>
                    <strong style={{ color: 'var(--text-primary)' }}>{progressPercent.toFixed(1)}%</strong>
                  </div>
                  <div className="progress-container" role="progressbar" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
                    <div
                      className="progress-bar-fill"
                      id="bill-progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="details-grid">
                  <div className="metric-card">
                    <div className="metric-label">Target Amount</div>
                    <div className="metric-value">{stroopsToXlm(billDetails.total_amount)} XLM</div>
                    <div className="metric-sub">{billDetails.total_amount} stroops</div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-label">Collected</div>
                    <div className="metric-value" style={{ color: 'var(--accent-emerald)' }}>
                      {stroopsToXlm(billDetails.amount_collected)} XLM
                    </div>
                    <div className="metric-sub">{billDetails.amount_collected} stroops</div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-label">Remaining</div>
                    <div className="metric-value" style={{ color: 'var(--accent-cyan)' }}>
                      {stroopsToXlm(
                        BigInt(billDetails.total_amount) - BigInt(billDetails.amount_collected)
                      )}{' '}
                      XLM
                    </div>
                    <div className="metric-sub">
                      {(
                        BigInt(billDetails.total_amount) - BigInt(billDetails.amount_collected)
                      ).toString()}{' '}
                      stroops
                    </div>
                  </div>

                  <div className="metric-card">
                    <div className="metric-label">Participants</div>
                    <div className="metric-value">{billDetails.participant_count}</div>
                    <div className="metric-sub">contributors</div>
                  </div>
                </div>

                <div style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
                  <div style={{ marginBottom: '0.35rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Payee Address: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {billDetails.payee}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Token Contract: </span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                      {billDetails.token}
                    </span>
                  </div>
                </div>

                {/* Settle / Pay Section */}
                {billDetails.is_active && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                      Contribute Remittance Portion
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                      Payer must approve transaction in Freighter. Payments cannot exceed remaining balance.
                    </p>

                    <div className="form-group">
                      <label htmlFor="payment-amount-input" className="form-label">
                        Payment Amount (in stroops: 1 XLM = 10,000,000 stroops)
                      </label>
                      <input
                        id="payment-amount-input"
                        type="number"
                        min="1"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="Enter stroops (e.g. 10000000 for 1 XLM)"
                        className="form-input"
                      />

                      {/* Quick fill buttons */}
                      <div className="quick-chips">
                        <button
                          type="button"
                          className="chip-btn"
                          id="quick-25-btn"
                          onClick={() => calculateQuickFill(0.25)}
                        >
                          25% Remaining
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          id="quick-50-btn"
                          onClick={() => calculateQuickFill(0.5)}
                        >
                          50% Remaining
                        </button>
                        <button
                          type="button"
                          className="chip-btn"
                          id="quick-100-btn"
                          onClick={() => calculateQuickFill(1.0)}
                        >
                          Full Remaining
                        </button>
                      </div>
                    </div>

                    <button
                      id="pay-bill-btn"
                      onClick={handlePayBill}
                      disabled={loading || walletStatus !== 'connected'}
                      className="btn btn-primary"
                    >
                      {loading
                        ? 'Processing Payment...'
                        : walletStatus !== 'connected'
                        ? 'Connect Wallet to Pay'
                        : `Submit Payment (${paymentAmount ? stroopsToXlm(paymentAmount) : '0'} XLM)`}
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {/* Tab Content: Create Bill */}
        {activeTab === 'create' && (
          <section className="glass-card" aria-labelledby="create-title">
            <h2 className="card-title" id="create-title">
              Create Split Bill
            </h2>
            <p className="card-description">
              Initialize a verifiable on-chain group billing target on Stellar Soroban.
            </p>

            <form onSubmit={handleCreateBill}>
              <div className="form-group">
                <label htmlFor="create-payee-input" className="form-label">
                  Recipient / Payee Address *
                </label>
                <input
                  id="create-payee-input"
                  type="text"
                  required
                  value={newBill.payee}
                  onChange={(e) => setNewBill({ ...newBill, payee: e.target.value })}
                  placeholder="G... or C... Stellar public address"
                  className="form-input"
                />
              </div>

              <div className="form-group">
                <label htmlFor="create-amount-input" className="form-label">
                  Total Bill Target (XLM) *
                </label>
                <input
                  id="create-amount-input"
                  type="number"
                  step="any"
                  min="0.0000001"
                  required
                  value={newBill.totalAmountXlm}
                  onChange={(e) => setNewBill({ ...newBill, totalAmountXlm: e.target.value })}
                  placeholder="e.g. 25.5 XLM"
                  className="form-input"
                />
                {newBill.totalAmountXlm && (
                  <span style={{ fontSize: '0.775rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.25rem' }}>
                    Equivalent to {xlmToStroops(newBill.totalAmountXlm).toString()} stroops
                  </span>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="create-token-input" className="form-label">
                  Stellar Asset Contract Address (Optional)
                </label>
                <input
                  id="create-token-input"
                  type="text"
                  value={newBill.token}
                  onChange={(e) => setNewBill({ ...newBill, token: e.target.value })}
                  placeholder="Defaults to native SAC / caller address if empty"
                  className="form-input"
                />
              </div>

              <button
                id="submit-create-bill-btn"
                type="submit"
                disabled={loading || walletStatus !== 'connected'}
                className="btn btn-primary"
              >
                {loading
                  ? 'Creating Bill On-Chain...'
                  : walletStatus !== 'connected'
                  ? 'Connect Wallet to Create'
                  : 'Deploy Split Bill'}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
