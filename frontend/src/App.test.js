import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from './App';

// Mock freighter-api
jest.mock('@stellar/freighter-api', () => ({
  isConnected: jest.fn().mockResolvedValue(true),
  isAllowed: jest.fn().mockResolvedValue(false),
  setAllowed: jest.fn().mockResolvedValue(true),
  requestAccess: jest.fn().mockResolvedValue('GD6RQC7TNR7Z63ZAXZ2R4G6EZX7U3XW74P4V56Q2K5T3LNV2M5Q4XXXX'),
  getPublicKey: jest.fn().mockResolvedValue(''),
  getNetwork: jest.fn().mockResolvedValue('TESTNET'),
  signTransaction: jest.fn().mockResolvedValue('AAAA...'),
}));

// Mock stellar-sdk
jest.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  BASE_FEE: '100',
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn(),
  })),
  TransactionBuilder: jest.fn(),
  nativeToScVal: jest.fn(),
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getAccount: jest.fn(),
      simulateTransaction: jest.fn(),
      sendTransaction: jest.fn(),
      getTransaction: jest.fn(),
    })),
    Api: {
      isSimulationError: jest.fn().mockReturnValue(false),
    },
    assembleTransaction: jest.fn().mockReturnValue({
      build: jest.fn(),
    }),
  },
}));

import freighter from '@stellar/freighter-api';

describe('App Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    freighter.isConnected.mockResolvedValue(true);
    freighter.isAllowed.mockResolvedValue(false);
    freighter.setAllowed.mockResolvedValue(true);
    freighter.requestAccess.mockResolvedValue('GD6RQC7TNR7Z63ZAXZ2R4G6EZX7U3XW74P4V56Q2K5T3LNV2M5Q4XXXX');
    freighter.getPublicKey.mockResolvedValue('');
    freighter.getNetwork.mockResolvedValue('TESTNET');
    freighter.signTransaction.mockResolvedValue('AAAA...');
  });

  test('renders header with brand name and subtitle', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText('Stellar Split')).toBeInTheDocument();
    expect(
      screen.getByText('Micro-Remittance & Split-Billing Protocol on Soroban')
    ).toBeInTheDocument();
  });

  test('renders connect freighter wallet button when disconnected', async () => {
    await act(async () => {
      render(<App />);
    });
    const connectBtn = screen.getByRole('button', { name: /Connect Freighter/i });
    expect(connectBtn).toBeInTheDocument();
  });

  test('renders bill lookup section by default', async () => {
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText('Query Split Bill')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter numeric Bill ID/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Query Bill/i })).toBeInTheDocument();
  });

  test('switches tabs between Query and Create Bill', async () => {
    await act(async () => {
      render(<App />);
    });
    const createTab = screen.getByRole('tab', { name: /Create New Bill/i });
    await act(async () => {
      fireEvent.click(createTab);
    });

    expect(screen.getByText('Create Split Bill')).toBeInTheDocument();
    expect(screen.getByLabelText(/Recipient \/ Payee Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Total Bill Target/i)).toBeInTheDocument();

    const lookupTab = screen.getByRole('tab', { name: /Find & Settle Bill/i });
    await act(async () => {
      fireEvent.click(lookupTab);
    });
    expect(screen.getByText('Query Split Bill')).toBeInTheDocument();
  });

  test('shows error when querying with invalid bill id', async () => {
    await act(async () => {
      render(<App />);
    });
    const input = screen.getByPlaceholderText(/Enter numeric Bill ID/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
    });

    const fetchBtn = screen.getByRole('button', { name: /Query Bill/i });
    await act(async () => {
      fireEvent.click(fetchBtn);
    });

    expect(await screen.findByText(/Please provide a valid numeric Bill ID/i)).toBeInTheDocument();
  });
});
