'use client';

import { useFund } from '@/hooks/useFund';
import { formatEther, parseEther } from 'viem';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { injected } from 'wagmi/connectors';
import Navigation from './Navigation';
import { fetchAllPrices, formatUpdateTime } from '@/lib/fetchPrices';
import { PriceData, AssetSymbol } from '@/lib/priceFeeds';
import { useVaultBalances } from '@/lib/useVaultBalances';

const NEUROVAULT_ADDRESS = '0x62758FBa7591E3dE9F398fE785eef3be6efc8336' as `0x${string}`;

// Portfolio token addresses from env vars
const ENV_ADDRESSES = {
  BTC: process.env.NEXT_PUBLIC_BTC_ADDRESS,
  ETH: process.env.NEXT_PUBLIC_ETH_ADDRESS,
  LTC: process.env.NEXT_PUBLIC_LTC_ADDRESS,
  GOLD: process.env.NEXT_PUBLIC_GOLD_ADDRESS,
  SILVER: process.env.NEXT_PUBLIC_SILVER_ADDRESS,
  TESLA: process.env.NEXT_PUBLIC_TESLA_ADDRESS,
  APPLE: process.env.NEXT_PUBLIC_APPLE_ADDRESS,
} as const;

// Portfolio Assets Configuration
const PORTFOLIO_ASSETS = [
  { key: "BTC",    name: "Bitcoin",    symbol: "mBTC", icon: "₿",  address: ENV_ADDRESSES.BTC,    category: "CRYPTO" },
  { key: "ETH",    name: "Ethereum",   symbol: "mETH", icon: "Ξ",  address: ENV_ADDRESSES.ETH,    category: "CRYPTO" },
  { key: "LTC",    name: "Litecoin",   symbol: "mLTC", icon: "Ł",  address: ENV_ADDRESSES.LTC,    category: "CRYPTO" },
  { key: "GOLD",   name: "Gold",       symbol: "mGLD", icon: "🥇", address: ENV_ADDRESSES.GOLD,   category: "COMMODITY" },
  { key: "SILVER", name: "Silver",     symbol: "mSLV", icon: "🥈", address: ENV_ADDRESSES.SILVER, category: "COMMODITY" },
  { key: "TESLA",  name: "Tesla",      symbol: "mTSLA", icon: "🚗", address: ENV_ADDRESSES.TESLA,  category: "STOCK" },
  { key: "APPLE",  name: "Apple",      symbol: "mAAPL", icon: "🍎", address: ENV_ADDRESSES.APPLE,  category: "STOCK" },
] as const;

// Address validation helper
function validateAddress(addr: string | undefined): `0x${string}` | null {
  return typeof addr === "string" && /^0x[a-fA-F0-9]{40}$/.test(addr)
    ? addr as `0x${string}`
    : null;
}

// Log missing addresses once
let hasLoggedMissing = false;
function logMissingPortfolioAddresses() {
  if (hasLoggedMissing) return;
  hasLoggedMissing = true;
  
  const missing = PORTFOLIO_ASSETS
    .filter(asset => !validateAddress(asset.address))
    .map(asset => `NEXT_PUBLIC_${asset.key}_ADDRESS`);
  
  if (missing.length > 0) {
    console.warn('⚠️ Portfolio missing addresses:');
    missing.forEach(envKey => console.warn(`- ${envKey}`));
  }
}

const VAULT_ABI = [
  {
    inputs: [],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'string', name: 'assetSymbol', type: 'string' }],
    name: 'invest',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'owner',
    outputs: [{ internalType: 'address', name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'Deposited',
    type: 'event',
  },
] as const;

interface Transaction {
  hash: string;
  type: string;
  amount: string;
  timestamp: number;
  status: string;
}

export default function Dashboard() {
  const { totalAssets, tslaBalance, aaplBalance, gldBalance, slvBalance, btcBalance, ethBalance, ltcBalance, isLoading: hookIsLoading, refetch } = useFund();
  const { balances: vaultBalances, refetch: refetchVaultBalances } = useVaultBalances();
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isTslaUpdating, setIsTslaUpdating] = useState(false);
  const [isAaplUpdating, setIsAaplUpdating] = useState(false);
  const [isGldUpdating, setIsGldUpdating] = useState(false);
  const [isSlvUpdating, setIsSlvUpdating] = useState(false);
  const [isBtcUpdating, setIsBtcUpdating] = useState(false);
  const [isEthUpdating, setIsEthUpdating] = useState(false);
  const [isLtcUpdating, setIsLtcUpdating] = useState(false);
  const [amount, setAmount] = useState('');
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [prevTotalAssets, setPrevTotalAssets] = useState(totalAssets);
  const [prevTslaBalance, setPrevTslaBalance] = useState(tslaBalance);
  const [prevAaplBalance, setPrevAaplBalance] = useState(aaplBalance);
  const [prevGldBalance, setPrevGldBalance] = useState(gldBalance);
  const [prevSlvBalance, setPrevSlvBalance] = useState(slvBalance);
  const [prevBtcBalance, setPrevBtcBalance] = useState(btcBalance);
  const [prevEthBalance, setPrevEthBalance] = useState(ethBalance);
  const [prevLtcBalance, setPrevLtcBalance] = useState(ltcBalance);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'loading';
    message: string;
  } | null>(null);
  
  // Refresh key for manual state updates
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Snapshot of balances for AI detection
  const balanceSnapshotRef = useRef({
    btc: 0n,
    eth: 0n,
    ltc: 0n,
    gold: 0n,
    silver: 0n,
    tesla: 0n,
    apple: 0n,
  });

  // Real-time market prices with metadata
  const [prices, setPrices] = useState<Record<AssetSymbol, PriceData>>({
    BTC: { price: 43000, updatedAt: Date.now() },
    ETH: { price: 2300, updatedAt: Date.now() },
    LTC: { price: 70, updatedAt: Date.now() },
    GOLD: { price: 2020, updatedAt: Date.now() },
    SILVER: { price: 24, updatedAt: Date.now() },
    TESLA: { price: 248, updatedAt: Date.now() },
    APPLE: { price: 185, updatedAt: Date.now() },
  });
  const [pricesLoading, setPricesLoading] = useState(true);

  // Portfolio diversification state (USD values)
  const [portfolio, setPortfolio] = useState({
    BTC: 0,
    ETH: 0,
    LTC: 0,
    GOLD: 0,
    SILVER: 0,
    TESLA: 0,
    APPLE: 0,
  });

  // **FIX: Use useFund balances converted to numbers for consistency**
  const normalizedBalances = useMemo(() => ({
    BTC: Number(formatEther(btcBalance)),
    ETH: Number(formatEther(ethBalance)),
    LTC: Number(formatEther(ltcBalance)),
    GOLD: Number(formatEther(gldBalance)),
    SILVER: Number(formatEther(slvBalance)),
    TESLA: Number(formatEther(tslaBalance)),
    APPLE: Number(formatEther(aaplBalance)),
  }), [btcBalance, ethBalance, ltcBalance, gldBalance, slvBalance, tslaBalance, aaplBalance]);

  // Calculate portfolio values based on balances and prices
  useEffect(() => {
    const calculatePortfolio = () => {
      setPortfolio({
        BTC: normalizedBalances.BTC * (prices.BTC?.price || 0),
        ETH: normalizedBalances.ETH * (prices.ETH?.price || 0),
        LTC: normalizedBalances.LTC * (prices.LTC?.price || 0),
        GOLD: normalizedBalances.GOLD * (prices.GOLD?.price || 0),
        SILVER: normalizedBalances.SILVER * (prices.SILVER?.price || 0),
        TESLA: normalizedBalances.TESLA * (prices.TESLA?.price || 0),
        APPLE: normalizedBalances.APPLE * (prices.APPLE?.price || 0),
      });
    };

    calculatePortfolio();
  }, [prices, normalizedBalances]);

  // **FIX: Calculate total using normalizedBalances**
  const total = useMemo(() => {
    return Object.values(normalizedBalances).reduce((a, b) => a + b, 0);
  }, [normalizedBalances]);

  // **FIX: Calculate diversification using normalizedBalances**
  const diversification = useMemo(() => {
    return [
      { name: 'BTC', value: normalizedBalances.BTC, color: 'from-purple-500 to-purple-600', category: 'Crypto' },
      { name: 'ETH', value: normalizedBalances.ETH, color: 'from-purple-500 to-purple-600', category: 'Crypto' },
      { name: 'LTC', value: normalizedBalances.LTC, color: 'from-purple-500 to-purple-600', category: 'Crypto' },
      { name: 'GOLD', value: normalizedBalances.GOLD, color: 'from-yellow-500 to-yellow-600', category: 'Commodity' },
      { name: 'SILVER', value: normalizedBalances.SILVER, color: 'from-yellow-500 to-yellow-600', category: 'Commodity' },
      { name: 'TESLA', value: normalizedBalances.TESLA, color: 'from-blue-500 to-blue-600', category: 'Stock' },
      { name: 'APPLE', value: normalizedBalances.APPLE, color: 'from-blue-500 to-blue-600', category: 'Stock' },
    ].sort((a, b) => b.value - a.value);
  }, [normalizedBalances]);

  // Log missing portfolio addresses on mount
  useEffect(() => {
    logMissingPortfolioAddresses();
  }, []);

  // Poll on-chain state every 15 seconds to detect AI investments
  useEffect(() => {
    const pollInterval = setInterval(() => {
      refetch();
      refetchVaultBalances();
    }, 15000); // 15 seconds

    return () => clearInterval(pollInterval);
  }, [refetch, refetchVaultBalances]);

  // Manual refresh trigger
  useEffect(() => {
    if (refreshKey > 0) {
      console.log('[Dashboard] Manual refresh triggered');
      refetch();
      refetchVaultBalances();
    }
  }, [refreshKey, refetch, refetchVaultBalances]);

  // Fetch real-time prices from multiple sources
  useEffect(() => {
    console.log('[Dashboard] Starting price fetch useEffect');
    const updatePrices = async () => {
      console.log('[Dashboard] Calling fetchAllPrices...');
      setPricesLoading(true);
      try {
        const newPrices = await fetchAllPrices();
        console.log('[Dashboard] Received prices, updating state:', newPrices);
        setPrices(newPrices);
        setPricesLoading(false);
        console.log('[Dashboard] State updated successfully');
      } catch (error) {
        console.error('[Dashboard] Failed to fetch prices:', error);
        setPricesLoading(false);
      }
    };

    // Initial fetch
    updatePrices();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(() => {
      console.log('[Dashboard] Auto-refresh triggered');
      updatePrices();
    }, 30000);
    
    return () => {
      console.log('[Dashboard] Cleaning up price fetch interval');
      clearInterval(interval);
    };
  }, []);

  // Stop loading after 3 seconds regardless of hook state
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsLoading(false);
    }, 3000);
    return () => clearTimeout(timeout);
  }, []);

  // Sync with hook loading state but cap at 3 seconds
  useEffect(() => {
    if (!hookIsLoading) {
      setIsLoading(false);
    }
  }, [hookIsLoading]);
  
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const chainId = useChainId();
  const { writeContractAsync, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });

  // Load transactions from localStorage on mount
  useEffect(() => {
    if (address) {
      const key = `neurofund_transactions_${address}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        setTransactions(JSON.parse(stored));
      }
    }
  }, [address]);

  // Save transaction when successful (only if not already saved)
  useEffect(() => {
    if (isSuccess && txHash && amount && address) {
      // Check if transaction already exists
      const exists = transactions.some(tx => tx.hash === txHash);
      if (!exists) {
        const newTx: Transaction = {
          hash: txHash,
          type: 'Deposit',
          amount: amount,
          timestamp: Date.now(),
          status: 'Completed',
        };
        const updated = [newTx, ...transactions];
        setTransactions(updated);
        const key = `neurofund_transactions_${address}`;
        localStorage.setItem(key, JSON.stringify(updated));
      }
    }
  }, [isSuccess, txHash, amount, address]);

  // Detect changes in assets and trigger animation
  useEffect(() => {
    if (prevTotalAssets !== totalAssets && prevTotalAssets !== 0n) {
      setIsUpdating(true);
      setTimeout(() => setIsUpdating(false), 2000);
    }
    setPrevTotalAssets(totalAssets);
  }, [totalAssets, prevTotalAssets]);

  // Detect changes in TSLA balance
  useEffect(() => {
    if (prevTslaBalance !== tslaBalance && prevTslaBalance !== 0n) {
      setIsTslaUpdating(true);
      setTimeout(() => setIsTslaUpdating(false), 2000);
    }
    setPrevTslaBalance(tslaBalance);
  }, [tslaBalance, prevTslaBalance]);

  // Detect changes in AAPL balance
  useEffect(() => {
    if (prevAaplBalance !== aaplBalance && prevAaplBalance !== 0n) {
      setIsAaplUpdating(true);
      setTimeout(() => setIsAaplUpdating(false), 2000);
    }
    setPrevAaplBalance(aaplBalance);
  }, [aaplBalance, prevAaplBalance]);

  // Detect changes in GLD balance
  useEffect(() => {
    if (prevGldBalance !== gldBalance && prevGldBalance !== 0n) {
      setIsGldUpdating(true);
      setTimeout(() => setIsGldUpdating(false), 2000);
    }
    setPrevGldBalance(gldBalance);
  }, [gldBalance, prevGldBalance]);

  // Detect changes in SLV balance
  useEffect(() => {
    if (prevSlvBalance !== slvBalance && prevSlvBalance !== 0n) {
      setIsSlvUpdating(true);
      setTimeout(() => setIsSlvUpdating(false), 2000);
    }
    setPrevSlvBalance(slvBalance);
  }, [slvBalance, prevSlvBalance]);

  // Detect changes in BTC balance
  useEffect(() => {
    if (prevBtcBalance !== btcBalance && prevBtcBalance !== 0n) {
      setIsBtcUpdating(true);
      setTimeout(() => setIsBtcUpdating(false), 2000);
    }
    setPrevBtcBalance(btcBalance);
  }, [btcBalance, prevBtcBalance]);

  // Detect changes in ETH balance
  useEffect(() => {
    if (prevEthBalance !== ethBalance && prevEthBalance !== 0n) {
      setIsEthUpdating(true);
      setTimeout(() => setIsEthUpdating(false), 2000);
    }
    setPrevEthBalance(ethBalance);
  }, [ethBalance, prevEthBalance]);

  // Detect changes in LTC balance
  useEffect(() => {
    if (prevLtcBalance !== ltcBalance && prevLtcBalance !== 0n) {
      setIsLtcUpdating(true);
      setTimeout(() => setIsLtcUpdating(false), 2000);
    }
    setPrevLtcBalance(ltcBalance);
  }, [ltcBalance, prevLtcBalance]);

  // Detect AI investments by comparing balance snapshots
  useEffect(() => {
    const snapshot = balanceSnapshotRef.current;
    
    // Skip on initial mount
    if (snapshot.btc === 0n && snapshot.eth === 0n && snapshot.ltc === 0n && 
        snapshot.gold === 0n && snapshot.silver === 0n && snapshot.tesla === 0n && snapshot.apple === 0n) {
      balanceSnapshotRef.current = {
        btc: btcBalance,
        eth: ethBalance,
        ltc: ltcBalance,
        gold: gldBalance,
        silver: slvBalance,
        tesla: tslaBalance,
        apple: aaplBalance,
      };
      return;
    }

    // Check if any balance changed (indicating AI investment)
    const balanceChanged = 
      snapshot.btc !== btcBalance ||
      snapshot.eth !== ethBalance ||
      snapshot.ltc !== ltcBalance ||
      snapshot.gold !== gldBalance ||
      snapshot.silver !== slvBalance ||
      snapshot.tesla !== tslaBalance ||
      snapshot.apple !== aaplBalance;

    if (balanceChanged) {
      // Determine which asset changed
      let changedAsset = '';
      if (snapshot.btc !== btcBalance) changedAsset = 'Bitcoin (mBTC)';
      else if (snapshot.eth !== ethBalance) changedAsset = 'Ethereum (mETH)';
      else if (snapshot.ltc !== ltcBalance) changedAsset = 'Litecoin (mLTC)';
      else if (snapshot.gold !== gldBalance) changedAsset = 'Gold (mGLD)';
      else if (snapshot.silver !== slvBalance) changedAsset = 'Silver (mSLV)';
      else if (snapshot.tesla !== tslaBalance) changedAsset = 'Tesla (mTSLA)';
      else if (snapshot.apple !== aaplBalance) changedAsset = 'Apple (mAAPL)';

      console.log('[Dashboard] AI investment detected:', changedAsset);

      // Add AI investment to history
      const aiTx: Transaction = {
        hash: `ai-${Date.now()}`,
        type: 'AI Investment',
        amount: changedAsset,
        timestamp: Date.now(),
        status: 'Completed',
      };

      const updated = [aiTx, ...transactions];
      setTransactions(updated);

      // Save to localStorage
      if (address) {
        const key = `neurofund_transactions_${address}`;
        localStorage.setItem(key, JSON.stringify(updated));
      }

      // Show toast notification
      setNotification({
        type: 'success',
        message: `AI Agent rebalanced portfolio to ${changedAsset}`,
      });
      setTimeout(() => setNotification(null), 5000);

      // Refetch vault balances immediately
      refetchVaultBalances();

      // Update snapshot
      balanceSnapshotRef.current = {
        btc: btcBalance,
        eth: ethBalance,
        ltc: ltcBalance,
        gold: gldBalance,
        silver: slvBalance,
        tesla: tslaBalance,
        apple: aaplBalance,
      };
    }
  }, [btcBalance, ethBalance, ltcBalance, gldBalance, slvBalance, tslaBalance, aaplBalance, address, transactions, refetchVaultBalances]);

  // Refetch balances when transaction succeeds
  useEffect(() => {
    if (isSuccess) {
      setTimeout(() => {
        refetch();
        setAmount('');
        reset();
      }, 3000);
    }
  }, [isSuccess, refetch, reset]);

  const handleConnectWallet = async () => {
    try {
      console.log('Attempting to connect wallet...');
      
      // First, try to add/switch to Monad Testnet
      if (window.ethereum) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x279F' }], // 10143 in hex
          });
        } catch (switchError: any) {
          // Chain doesn't exist, add it
          if (switchError.code === 4902) {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x279F', // 10143
                chainName: 'Monad Testnet',
                nativeCurrency: {
                  name: 'Monad',
                  symbol: 'MON',
                  decimals: 18
                },
                rpcUrls: ['https://testnet-rpc.monad.xyz'],
                blockExplorerUrls: ['https://explorer.testnet.monad.xyz']
              }]
            });
          }
        }
      }
      
      // Then connect wallet
      await connect({ connector: connectors[0] });
    } catch (err) {
      console.error('Connection error:', err);
      alert('Failed to connect wallet. Make sure MetaMask is installed.');
    }
  };

  const handleLogout = () => {
    if (isConnected) {
      setIsLoggingOut(true);
      
      // Animate out and disconnect after delay
      setTimeout(() => {
        disconnect();
        // Reset all local state (data persists in localStorage)
        setAmount('');
        setTransactions([]);
        setIsLoggingOut(false);
      }, 800);
    }
  };

  async function handleInvest() {
    console.log("HANDLE INVEST START");

    if (!isConnected) {
      setNotification({ type: 'error', message: 'Please connect your wallet first' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    if (!amount || Number(amount) <= 0) {
      setNotification({ type: 'error', message: 'Enter a valid amount' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }

    setNotification({ type: 'loading', message: 'Preparing transaction...' });

    try {
      const value = BigInt(Math.floor(Number(amount) * 1e18));
      console.log("Calling deposit with value:", value.toString());

      const hash = await writeContractAsync({
        address: NEUROVAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "deposit",
        value,
      });

      console.log("DEPOSIT TX HASH:", hash);
      
      setNotification({ type: 'success', message: 'Investment successful!' });
      setTimeout(() => setNotification(null), 3000);
      
      // Update history immediately
      const newTx: Transaction = {
        hash: hash,
        type: 'Deposit',
        amount: amount,
        timestamp: Date.now(),
        status: 'Completed',
      };
      const updated = [newTx, ...transactions];
      setTransactions(updated);
      
      // Save to localStorage
      if (address) {
        const key = `neurofund_transactions_${address}`;
        localStorage.setItem(key, JSON.stringify(updated));
      }
      
      setAmount('');
      setTxHash(hash);
      
      // Refetch balances after successful deposit
      setTimeout(() => {
        refetch();
        refetchVaultBalances();
        setRefreshKey(k => k + 1);
      }, 2000);
    } catch (err: any) {
      console.error("DEPOSIT FAILED:", err);
      setNotification({ type: 'error', message: err?.shortMessage || err?.message || 'Transaction failed' });
      setTimeout(() => setNotification(null), 3000);
    }
  }

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds} seconds ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  };

  // Helper to get balance by asset key
  const getBalanceByKey = (key: string): bigint => {
    switch (key) {
      case 'BTC': return btcBalance;
      case 'ETH': return ethBalance;
      case 'LTC': return ltcBalance;
      case 'GOLD': return gldBalance;
      case 'SILVER': return slvBalance;
      case 'TESLA': return tslaBalance;
      case 'APPLE': return aaplBalance;
      default: return 0n;
    }
  };

  // Helper to get updating state by asset key
  const getUpdatingStateByKey = (key: string): boolean => {
    switch (key) {
      case 'BTC': return isBtcUpdating;
      case 'ETH': return isEthUpdating;
      case 'LTC': return isLtcUpdating;
      case 'GOLD': return isGldUpdating;
      case 'SILVER': return isSlvUpdating;
      case 'TESLA': return isTslaUpdating;
      case 'APPLE': return isAaplUpdating;
      default: return false;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Custom Toast Notification */}
      {notification && (
        <div className="fixed top-4 right-4 z-50 animate-slideInRight">
          <div className={`px-4 py-3 rounded border shadow-lg ${
            notification.type === 'success' ? 'bg-slate-900 border-emerald-600/50 text-emerald-50' :
            notification.type === 'error' ? 'bg-slate-900 border-red-600/50 text-red-50' :
            'bg-slate-900 border-blue-600/50 text-blue-50'
          }`}>
            <div className="flex items-center gap-3">
              {notification.type === 'loading' && (
                <div className="w-5 h-5 border-2 border-blue-300 border-t-transparent rounded-full animate-spin"></div>
              )}
              {notification.type === 'success' && (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {notification.type === 'error' && (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              <span className="font-medium">{notification.message}</span>
            </div>
          </div>
        </div>
      )}
      
      {/* Logout Animation Overlay */}
      {isLoggingOut && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 animate-fadeIn">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 mx-auto border-2 border-slate-700 border-t-blue-500 rounded-full animate-spin"></div>
            <div className="space-y-1">
              <p className="text-lg font-medium text-white">Logging Out</p>
              <p className="text-sm text-slate-400">Securing your session</p>
            </div>
          </div>
        </div>
      )}

      
      <Navigation />
      
      <div className="pt-20">
        {/* Quick Actions Bar */}
        <div className="border-b border-slate-800/50 bg-slate-900/50 sticky top-16 z-50">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-3 flex justify-between items-center gap-2">
            {/* Price Update Indicator */}
            <div className="flex items-center gap-2 text-[10px]">
              <span className={`inline-block w-2 h-2 rounded-full ${pricesLoading ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'}`}></span>
              <span className="text-slate-500">
                {pricesLoading ? 'Updating prices...' : `Last update: ${formatUpdateTime(prices.BTC?.updatedAt || Date.now())}`}
              </span>
            </div>

            {isConnected && (
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="group px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 rounded text-xs font-medium tracking-wide transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-3.5 h-3.5 text-red-400 group-hover:text-red-300 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                <span className="text-red-400 group-hover:text-red-300 transition-colors">
                  {isLoggingOut ? 'Logging out...' : 'Logout'}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <main className={`relative px-4 sm:px-6 lg:px-8 py-8 transition-all duration-500 ${isLoggingOut ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
          {/* Subtle Grid Background */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>

          <div className="container mx-auto relative z-10" style={{maxWidth: '1600px'}}>
            {/* Status Badge */}
          <div className="flex justify-between items-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded border border-cyan-500/30 bg-slate-900/50 backdrop-blur-sm shadow-[0_0_15px_rgba(34,211,238,0.15)]">
              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.6)]"></div>
              <span className="text-slate-100 text-xs font-semibold tracking-wide">Monad Testnet · AI Active</span>
            </div>
          </div>

          {/* Top Row: Invest + Portfolio Value + Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Invest Section */}
          <div className="">
            <div className="relative overflow-hidden h-full">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-600/10 to-blue-600/10"></div>
              <div className="relative p-8 bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 shadow-[0_0_30px_rgba(34,211,238,0.1)] transition-all duration-300 hover:shadow-[0_0_40px_rgba(34,211,238,0.2)]">
                <div className="mb-8 text-center">
                  <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-cyan-500 to-blue-500 mb-4 shadow-[0_0_20px_rgba(34,211,238,0.4)]">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <h3 className="text-2xl font-semibold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-2">Deposit Funds</h3>
                  <p className="text-sm text-slate-400">Add MON to your portfolio</p>
                </div>
            
              {!isConnected ? (
                <button
                  onClick={handleConnectWallet}
                  disabled={isConnecting}
                  className="w-full px-6 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 border border-cyan-400/50 text-white font-semibold text-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(34,211,238,0.3)] hover:shadow-[0_0_30px_rgba(34,211,238,0.5)]"
                >
                  {isConnecting ? "Connecting..." : "Connect Wallet"}
                </button>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-3">
                      Deposit Amount
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full px-5 py-4 bg-slate-900/50 border border-slate-700/50 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:shadow-[0_0_15px_rgba(34,211,238,0.3)] text-xl font-semibold transition-all duration-300"
                        step="0.01"
                        min="0"
                      />
                      <span className="absolute right-5 top-1/2 -translate-y-1/2 text-cyan-400 font-semibold text-sm">MON</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      console.log("RAW INVEST BUTTON CLICKED");
                      handleInvest();
                    }}
                    disabled={!isConnected || !amount || Number(amount) <= 0 || isPending}
                    className="w-full px-6 py-4 bg-gradient-to-r from-emerald-400 to-cyan-500 hover:from-emerald-300 hover:to-cyan-400 border border-emerald-400/50 text-slate-950 font-semibold text-lg transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(52,211,153,0.3)] hover:shadow-[0_0_30px_rgba(52,211,153,0.5)]"
                  >
                    {isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-slate-700 border-t-slate-950 rounded-full animate-spin"></div>
                        Processing...
                      </>
                    ) : (
                      'Deposit Funds'
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Total AUM Card */}
          <div className="">
            <div className="px-6 py-8 bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 shadow-[0_0_30px_rgba(34,211,238,0.1)] h-full flex flex-col justify-center">
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <p className="text-slate-400 text-xs uppercase tracking-widest font-semibold">Total Portfolio Value</p>
                  {isUpdating && (
                    <span className="inline-flex items-center px-2 py-0.5 bg-cyan-900/50 text-cyan-300 text-[10px] font-semibold tracking-wide uppercase border border-cyan-500/50 shadow-[0_0_10px_rgba(34,211,238,0.3)]">
                      UPDATING
                    </span>
                  )}
                </div>
                {isLoading ? (
                  <div className="flex items-center justify-center gap-3 py-8">
                    <div className="w-6 h-6 border-2 border-slate-700 border-t-cyan-400 rounded-full animate-spin shadow-[0_0_10px_rgba(34,211,238,0.3)]"></div>
                    <span className="text-slate-400 text-sm font-medium">Loading portfolio...</span>
                  </div>
                ) : (
                  <div className={`transition-all duration-300 ${isUpdating ? 'scale-[1.02]' : 'scale-100'}`}>
                    <p className="text-4xl lg:text-5xl font-semibold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-1 tracking-tight">
                      {isConnected ? formatEther(totalAssets) : '0.00'}
                    </p>
                    <p className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Total Portfolio Value (MON)</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Performance Metrics */}
          <div className="">
            <div className="grid grid-cols-1 gap-4">
              {[
                { label: '24h Change', value: '+12.5%', subtext: '1.24 MON' },
                { label: '7d Change', value: '+28.3%', subtext: '2.83 MON' },
                { label: 'Total Return', value: '+156.7%', subtext: 'Since inception' },
              ].map((metric, idx) => (
                <div key={idx} className="p-4 bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 hover:border-cyan-500/50 transition-all duration-300 hover:shadow-[0_0_15px_rgba(34,211,238,0.2)]">
                  <p className="text-[10px] text-slate-500 uppercase tracking-[0.15em] font-medium mb-1">{metric.label}</p>
                  <p className="text-2xl font-light text-white mb-0.5 tracking-tight">{metric.value}</p>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider">{metric.subtext}</p>
                </div>
              ))}
            </div>
          </div>
          </div>

          {/* Portfolio Diversification Section */}
          <div className="mb-12 mt-12">
            <div className="inline-flex items-center gap-2 mb-3">
              <div className="h-px w-8 bg-gradient-to-r from-transparent to-cyan-500/50"></div>
              <span className="text-xs font-semibold text-slate-500 tracking-widest uppercase">Portfolio Diversification</span>
              <div className="h-px flex-1 bg-gradient-to-r from-cyan-500/50 to-transparent"></div>
            </div>
            <p className="text-xs text-slate-400 mb-6">Live breakdown of your asset allocation</p>

            <div className="px-8 py-8 bg-slate-900/50 backdrop-blur-sm border border-slate-700/50">
              <div className="space-y-4">
                {/* Total Value Header */}
                <div className="pb-4 border-b border-slate-700/50">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-slate-500 uppercase tracking-widest font-semibold">Total Portfolio Value</span>
                    <span className="text-2xl font-semibold text-cyan-400">
                      {total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MON
                    </span>
                  </div>
                </div>

                {/* Asset Breakdown */}
                <div className="space-y-3 pt-2">
                  {diversification.map((asset) => {
                    const percentage = total === 0 ? 0 : (asset.value / total) * 100;
                    
                    return (
                      <div key={asset.name} className="group">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-white w-16">{asset.name}</span>
                            <span className="text-[10px] text-slate-500 uppercase tracking-wider">{asset.category}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm font-medium text-slate-300">
                              {asset.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MON
                            </span>
                            <span className="text-sm font-semibold text-cyan-400 w-12 text-right">
                              {percentage.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="h-2 bg-slate-800/50 rounded-full overflow-hidden">
                          <div 
                            className={`h-full bg-gradient-to-r ${asset.color} transition-all duration-500 ease-out`}
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Empty State */}
                {total === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-500">No assets in portfolio yet</p>
                    <p className="text-xs text-slate-600 mt-1">Deposit funds and invest to see your diversification</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Main Header */}
          <div className="mb-8 mt-12">
            <div className="inline-flex items-center gap-2 mb-3">
              <div className="h-px w-8 bg-gradient-to-r from-transparent to-cyan-500/50"></div>
              <span className="text-xs font-semibold text-slate-500 tracking-widest uppercase">Asset Allocation</span>
              <div className="h-px flex-1 bg-gradient-to-r from-cyan-500/50 to-transparent"></div>
            </div>
            <p className="text-xs text-slate-400">Real-time portfolio balances across tokenized assets</p>
          </div>

          {/* Portfolio Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-12">
            {PORTFOLIO_ASSETS.map((asset) => {
              const address = validateAddress(asset.address);
              const balance = getBalanceByKey(asset.key);
              const isUpdating = getUpdatingStateByKey(asset.key);
              const priceData = prices[asset.key as AssetSymbol];
              const isConfigured = address !== null;

              // Category-based styling
              const categoryColors = {
                CRYPTO: 'hover:border-cyan-500/50 hover:shadow-[0_0_20px_rgba(34,211,238,0.2)]',
                COMMODITY: 'hover:border-amber-500/50 hover:shadow-[0_0_20px_rgba(251,191,36,0.2)]',
                STOCK: 'hover:border-cyan-500/50 hover:shadow-[0_0_20px_rgba(34,211,238,0.2)]',
              };

              return (
                <div key={asset.key} className="group">
                  <div className={`px-6 py-6 bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 ${categoryColors[asset.category]} transition-all duration-300`}>
                    <div className="transform transition-transform duration-300 group-hover:scale-[1.02]">
                      <div className="flex items-center justify-between mb-5">
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">
                            {asset.category === 'COMMODITY' ? 'COMMODITIES' : asset.category}
                          </p>
                          <p className="text-xs text-slate-100 font-semibold">{asset.symbol}</p>
                        </div>
                        <span className="text-2xl">{asset.icon}</span>
                      </div>
                      <div className={`transition-all duration-500 ${isUpdating ? 'scale-105' : 'scale-100'}`}>
                        {isConfigured ? (
                          <>
                            <p className="text-3xl font-semibold text-slate-100 mb-1">
                              {isConnected ? Number(formatEther(balance)).toFixed(2) : '0.00'}
                            </p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-2">
                              {asset.name}
                            </p>
                            <div className="flex items-center gap-2">
                              <p className="text-[10px] text-slate-400 font-semibold">
                                ${(priceData?.price || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} USD
                              </p>
                              {priceData?.change24h !== undefined && (
                                <span className={`text-[9px] font-semibold flex items-center gap-0.5 ${
                                  priceData.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'
                                }`}>
                                  {priceData.change24h >= 0 ? '▲' : '▼'}
                                  {Math.abs(priceData.change24h).toFixed(1)}%
                                </span>
                              )}
                            </div>
                            <p className="text-[9px] text-slate-600 mt-1">
                              {formatUpdateTime(priceData?.updatedAt || Date.now())}
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-2xl font-semibold text-slate-500 mb-1">—</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-2">
                              {asset.name}
                            </p>
                            <p className="text-[9px] text-amber-500/70 font-semibold">⚠ UNCONFIGURED</p>
                            <p className="text-[8px] text-slate-600 mt-1">Address missing</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* AI Activity + Risk Management Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-12">
          {/* AI Activity Feed */}
          <div className="">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base font-semibold text-white">
                Recent AI Activity
              </h2>
              <div className="h-px flex-1 bg-slate-800"></div>
            </div>
            <div className="bg-slate-900/50 backdrop-blur-sm border border-slate-700/50 p-4">
              <div className="space-y-2">
                {[
                  { action: 'Multi-LLM Consensus', detail: 'GPT-4: CRYPTO | Gemini: CRYPTO → Buying mBTC', time: '2m ago', icon: '🧠' },
                  { action: 'Market Analysis', detail: '15 headlines analyzed across crypto, stocks, commodities', time: '5m ago', icon: '📰' },
                  { action: 'Price Signal Detection', detail: 'BTC +4.2% → Risk-on sentiment confirmed', time: '8m ago', icon: '📈' },
                  { action: 'Portfolio Rebalance', detail: 'Increased mBTC allocation based on consensus vote', time: '1h ago', icon: '⚡' },
                ].map((activity, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-3 bg-slate-800/30 border border-slate-700 hover:border-slate-600 transition-all duration-200"
                  >
                    <div className="flex-shrink-0 w-8 h-8 bg-slate-800 border border-slate-700 flex items-center justify-center text-base">
                      {activity.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-white font-semibold text-xs truncate">{activity.action}</p>
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold whitespace-nowrap ml-2">{activity.time}</span>
                      </div>
                      <p className="text-xs text-slate-400">{activity.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Risk Management */}
          <div className="">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-base font-semibold text-white">
                Risk Management
              </h2>
              <div className="h-px flex-1 bg-slate-800"></div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div className="p-4 bg-slate-900/50 backdrop-blur-sm border border-slate-700/50">
                <h3 className="text-sm font-light text-white mb-3 tracking-tight">Risk Metrics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-light">Volatility</span>
                    <span className="text-xs text-slate-300 font-light">Low</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-light">Sharpe Ratio</span>
                    <span className="text-xs text-slate-300 font-light">2.8</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-light">Max Drawdown</span>
                    <span className="text-xs text-slate-300 font-light">-12.3%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-400 font-light">Beta</span>
                    <span className="text-xs text-slate-300 font-light">0.85</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* Info Banner */}
          <div className="mb-8">
            <div className="p-6 bg-slate-900/50 backdrop-blur-sm border border-slate-700/50">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-slate-800/50 flex items-center justify-center">
                    <span className="text-lg opacity-60">🤖</span>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-light text-white mb-1 tracking-tight">Multi-LLM AI Agent Running</h3>
                  <p className="text-xs text-slate-500 font-light leading-relaxed">
                    Two AI models (GPT-4 + Google Gemini) independently analyze global news every 60 seconds. They vote on market sentiment (CRYPTO/STOCKS/COMMODITIES/HOLD) and reach consensus before automatically rebalancing your portfolio. Transparent decision logs show each model's reasoning.
                  </p>
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* Bottom Text */}
          <div className="text-center mt-16 pb-8">
            <p className="text-slate-600 text-xs font-light mb-2">
              Live data from Monad Testnet · Powered by Multi-LLM Consensus (GPT-4 + Gemini)
            </p>
            <p className="text-slate-700 text-[10px] font-light">
              Last updated: {new Date().toLocaleTimeString()} · Chain ID: 10143
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
