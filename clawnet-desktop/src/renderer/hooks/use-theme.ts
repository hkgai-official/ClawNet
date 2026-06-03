import { useEffect, useState, useCallback } from 'react';
import type { Theme } from '../../shared/ipc-contract';
import { useIpc } from './use-ipc';
import { useIpcEvent } from './use-ipc-event';

function applyTheme(theme: Theme) {
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset['theme'] = isDark ? 'dark' : 'light';
}

export function useTheme(): { theme: Theme; setTheme: (t: Theme) => Promise<void> } {
  const ipc = useIpc();
  const [theme, setThemeLocal] = useState<Theme>('system');

  useEffect(() => {
    ipc('settings.theme.get', {}).then((t) => {
      setThemeLocal(t);
      applyTheme(t);
    });
  }, [ipc]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  useIpcEvent('settings.changed', (change) => {
    if (change.theme) {
      setThemeLocal(change.theme);
      applyTheme(change.theme);
    }
  });

  const setTheme = useCallback(
    async (t: Theme) => {
      await ipc('settings.theme.set', { theme: t });
      setThemeLocal(t);
      applyTheme(t);
    },
    [ipc],
  );

  return { theme, setTheme };
}
