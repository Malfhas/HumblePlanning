"use client";

import { QueryClient, QueryClientProvider, MutationCache, QueryCache } from "@tanstack/react-query";
import { useState } from "react";
import { clearLocalSession, isAuthRedirectSuspended } from "@/lib/session-cleanup";
import { isUnauthenticatedError } from "@/lib/api-client";

function handleGlobalError(error: Error) {
  // Redirect to login on authentication errors (session revoked/expired).
  // Purge client-side state first so any new login starts clean.
  // Detected by code (`errors.unauthenticated`), language-independent.
  if (isUnauthenticatedError(error)) {
    if (isAuthRedirectSuspended()) return;
    clearLocalSession();
    window.location.href = "/login";
  }
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: (failureCount, error) => {
              // Don't retry on auth errors
              if (isUnauthenticatedError(error)) {
                return false;
              }
              return failureCount < 2;
            },
            retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
            refetchOnWindowFocus: false,
          },
        },
        queryCache: new QueryCache({
          onError: handleGlobalError,
        }),
        mutationCache: new MutationCache({
          onError: handleGlobalError,
        }),
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
