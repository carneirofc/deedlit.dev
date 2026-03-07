"use client";

import { Provider as JotaiProvider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { useEventHub } from "@/lib/store/event-hub";

function EventHubMount() {
  useEventHub();
  return null;
}

export default function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <EventHubMount />
        {children}
      </JotaiProvider>
    </QueryClientProvider>
  );
}
