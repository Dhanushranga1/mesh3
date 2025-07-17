'use client';

import { useState, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export default function useWallet() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMetaMaskInstalled, setIsMetaMaskInstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectWallet = useCallback(async () => {
    console.log('[Mesh3] Connect button clicked');

    if (!window.ethereum) {
      setError("MetaMask not detected. Please install it from metamask.io.");
      console.warn('[Mesh3] MetaMask not found in window.ethereum');
      return;
    }

    try {
      setIsConnecting(true);
      console.log('[Mesh3] Requesting wallet access...');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      console.log('[Mesh3] Wallet connected:', accounts);
      setWalletAddress(accounts[0]);
      setError(null);
    } catch (err: any) {
      console.error('[Mesh3] Wallet connection failed:', err);
      setError("Wallet connection failed or was rejected.");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  useEffect(() => {
    const installed = typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
    setIsMetaMaskInstalled(installed);

    if (installed) {
      console.log('[Mesh3] MetaMask is installed');
      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        console.log('[Mesh3] Accounts changed:', accounts);
        setWalletAddress(accounts.length > 0 ? accounts[0] : null);
      });
    } else {
      console.warn('[Mesh3] MetaMask is not installed');
    }
  }, []);

  return { walletAddress, connectWallet, isConnecting, error, isMetaMaskInstalled };
}
