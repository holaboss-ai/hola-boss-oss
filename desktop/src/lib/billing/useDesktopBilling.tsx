import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useDesktopAuthSession } from "@/lib/auth/authClient";

interface DesktopBillingContextValue {
  isAvailable: boolean;
  isLoading: boolean;
  error: Error | null;
  overview: DesktopBillingOverviewPayload | null;
  usage: DesktopBillingUsagePayload | null;
  links: DesktopBillingLinksPayload | null;
  hasHostedBillingAccount: boolean;
  isLowBalance: boolean;
  isOutOfCredits: boolean;
  refresh: () => Promise<void>;
}

const DesktopBillingContext = createContext<DesktopBillingContextValue | null>(
  null,
);

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error("Failed to load desktop billing state.");
}

export function DesktopBillingProvider({
  children,
}: {
  children: ReactNode;
}) {
  const authSessionState = useDesktopAuthSession();
  const isAuthenticated = Boolean(authSessionState.data?.user?.id?.trim());
  const [isLoading, setIsLoading] = useState(authSessionState.isPending);
  const [error, setError] = useState<Error | null>(null);
  const [overview, setOverview] =
    useState<DesktopBillingOverviewPayload | null>(null);
  const [usage, setUsage] = useState<DesktopBillingUsagePayload | null>(null);
  const [links, setLinks] = useState<DesktopBillingLinksPayload | null>(null);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setOverview(null);
      setUsage(null);
      setLinks(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [nextOverview, nextUsage, nextLinks] = await Promise.all([
        window.electronAPI.billing.getOverview(),
        window.electronAPI.billing.getUsage(),
        window.electronAPI.billing.getLinks(),
      ]);
      setOverview(nextOverview);
      setUsage(nextUsage);
      setLinks(nextLinks);
      setError(null);
    } catch (nextError) {
      setError(normalizeError(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (authSessionState.isPending) {
      setIsLoading(true);
      return;
    }
    void refresh();
  }, [authSessionState.isPending, refresh]);

  const isLowBalance = Boolean(
    overview &&
      (overview.isLowBalance ||
        (overview.creditsBalance > 0 &&
          overview.creditsBalance < overview.lowBalanceThreshold)),
  );
  const isOutOfCredits = overview ? overview.creditsBalance <= 0 : false;

  const value = useMemo<DesktopBillingContextValue>(
    () => ({
      isAvailable: isAuthenticated,
      isLoading,
      error,
      overview,
      usage,
      links,
      hasHostedBillingAccount: Boolean(overview?.hasHostedBillingAccount),
      isLowBalance,
      isOutOfCredits,
      refresh,
    }),
    [error, isAuthenticated, isLoading, isLowBalance, isOutOfCredits, links, overview, refresh, usage],
  );

  return (
    <DesktopBillingContext.Provider value={value}>
      {children}
    </DesktopBillingContext.Provider>
  );
}

export function useDesktopBilling(): DesktopBillingContextValue {
  const context = useContext(DesktopBillingContext);
  if (!context) {
    throw new Error(
      "useDesktopBilling must be used inside DesktopBillingProvider.",
    );
  }
  return context;
}
