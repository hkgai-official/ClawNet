// Tiny hand-rolled router: shows LoginScreen when loggedOut/loggingIn,
// MainShell when loggedIn. No react-router dep (YAGNI for P1B).
import type { ReactNode } from 'react';
import { useAuthStore } from '../features/auth/state/auth-slice';
import { LoginScreen } from '../features/auth/ui/login';

export function Router({ mainShell }: { mainShell: ReactNode }) {
  const state = useAuthStore((s) => s.state);
  if (state.kind === 'loggedIn') return <>{mainShell}</>;
  return <LoginScreen />;
}
