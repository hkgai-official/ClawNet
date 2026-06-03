import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastOverlay } from '../components/toast-overlay';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>{children}</Suspense>
      <ToastOverlay />
    </QueryClientProvider>
  );
}
