import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getCoins } from './resourceApi';
import { RESOURCE_TYPES } from './resourceTypes';

interface ResourceWalletContextValue {
  coins: number;
  isLoadingCoins: boolean;
  refreshCoins: () => Promise<void>;
  applyOptimisticCoinDelta: (amount: number) => () => void;
}

const ResourceWalletContext = createContext<ResourceWalletContextValue | null>(null);

function clampAmount(amount: number) {
  if (!Number.isFinite(amount)) {
    return 0;
  }

  return Math.floor(amount);
}

export function ResourceProvider({
  currentUserId,
  children,
}: {
  currentUserId: string | null;
  children: ReactNode;
}) {
  const [coinCount, setCoinCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currentUserId) {
      setCoinCount(0);
      setIsLoading(false);
      return;
    }

    let isActive = true;

    const loadCoins = async () => {
      setIsLoading(true);

      try {
        const nextCoinCount = await getCoins(currentUserId);

        if (isActive) {
          setCoinCount(nextCoinCount);
        }
      } catch (error) {
        if (isActive) {
          console.warn('Unable to load BB Coins.', error);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadCoins();

    return () => {
      isActive = false;
    };
  }, [currentUserId]);

  const refreshCoins = async () => {
    if (!currentUserId) {
      setCoinCount(0);
      return;
    }

    const nextCoinCount = await getCoins(currentUserId);
    setCoinCount(nextCoinCount);
  };

  const contextValue: ResourceWalletContextValue = {
    coins: coinCount,
    isLoadingCoins: isLoading,
    refreshCoins,
    applyOptimisticCoinDelta: (amount: number) => {
      const safeAmount = clampAmount(amount);

      if (safeAmount === 0) {
        return () => undefined;
      }

      setCoinCount((currentAmount) => Math.max(0, currentAmount + safeAmount));

      return () => {
        setCoinCount((currentAmount) => Math.max(0, currentAmount - safeAmount));
      };
    },
  };

  return (
    <ResourceWalletContext.Provider value={contextValue}>
      {children}
    </ResourceWalletContext.Provider>
  );
}

export function useCoins() {
  const context = useContext(ResourceWalletContext);

  if (!context) {
    throw new Error('useCoins must be used inside a ResourceProvider.');
  }

  return context;
}

export function useResourceWallet() {
  return useCoins();
}

export function CoinDisplay() {
  const { coins, isLoadingCoins } = useCoins();

  return (
    <div className="coin-display" aria-label={`BB Coins: ${coins.toLocaleString()}`}>
      <img alt="" aria-hidden="true" className="coin-icon" src="/bbcoin.png" />
      <strong className={`coin-display-value${isLoadingCoins ? ' is-loading' : ''}`}>
        {coins.toLocaleString()}
      </strong>
    </div>
  );
}

export { RESOURCE_TYPES };
