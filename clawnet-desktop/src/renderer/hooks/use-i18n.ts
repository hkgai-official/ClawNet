import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { Language } from '../../shared/ipc-contract';
import { useIpc } from './use-ipc';
import { useIpcEvent } from './use-ipc-event';
import { changeLanguage } from '../i18n';
import { LanguageManager } from '../i18n/language-manager';
import { useAuthStore } from '../features/auth/state/auth-slice';

export function useLanguage(): { language: Language; setLanguage: (l: Language) => Promise<void> } {
  const ipc = useIpc();
  const [language, setLanguageLocal] = useState<Language>('en');

  useEffect(() => {
    ipc('settings.language.get', {}).then(async (l) => {
      setLanguageLocal(l);
      LanguageManager.set(l);
      await changeLanguage(l);
    });
  }, [ipc]);

  useIpcEvent('settings.changed', async (change) => {
    if (change.language) {
      setLanguageLocal(change.language);
      LanguageManager.set(change.language);
      await changeLanguage(change.language);
    }
  });

  const setLanguage = useCallback(
    async (l: Language) => {
      await ipc('settings.language.set', { language: l });
      // Best-effort server sync (P3B). Matches macOS LanguageManager pushing
      // to /api/v1/users/me/language. Failure here does not roll back the
      // local change — offline / 401 / 5xx all degrade gracefully.
      const authKind = useAuthStore.getState().state.kind;
      if (authKind === 'loggedIn') {
        try {
          await ipc('profile.setLanguage', { language: l });
        } catch {
          /* swallow — local change already applied */
        }
      }
      setLanguageLocal(l);
      LanguageManager.set(l);
      await changeLanguage(l);
    },
    [ipc],
  );

  return { language, setLanguage };
}

export { useTranslation };
