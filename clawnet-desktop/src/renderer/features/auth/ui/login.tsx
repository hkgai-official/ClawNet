import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { useAuth } from '../hooks/use-auth';
import { useIpc } from '../../../hooks/use-ipc';

const FALLBACK_SERVER = 'http://localhost:9000';

/**
 * Login form. Layout mirrors macOS LoginView.swift:25-95:
 *
 *   - Stacked 72px rounded-square badge with the chat-bubble icon
 *   - "ClawNet" headline + localized subtitle ("Sign in to your account")
 *   - Server URL / Account / Password fields (server URL is hidden by
 *     default; Settings → Connection is the user-facing entry point to
 *     change it. macOS LoginView likewise hides it behind a disclosure.)
 *   - Wide primary "Sign In" button
 *
 * All visible strings come from the `common` namespace so en/zh-Hans/
 * zh-Hant render correctly.
 */
export function LoginScreen() {
  const { t } = useTranslation('common');
  const { login } = useAuth();
  const ipc = useIpc();
  const [serverURL, setServerURL] = useState(FALLBACK_SERVER);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Pre-fill server URL from main process. In e2e, the launcher sets
  // CLAWNET_E2E_SERVER_URL → settings handler returns the fake-server URL.
  useEffect(() => {
    let cancelled = false;
    void ipc('settings.defaultServerURL.get', {}).then((url) => {
      if (!cancelled) setServerURL(url);
    });
    return () => {
      cancelled = true;
    };
  }, [ipc]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      { serverURL, username, password },
      {
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };

  const loginEnabled =
    !login.isPending && username.trim().length > 0 && password.length > 0;

  return (
    <div
      className="flex items-center justify-center h-full"
      style={{ background: 'var(--color-bg-app)' }}
    >
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-6 p-10"
        style={{
          width: 420,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        {/* Header — stacked badge + title + subtitle, all centered. */}
        <div className="flex flex-col items-center gap-3">
          <div
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 72,
              height: 72,
              borderRadius: 'var(--radius-lg)',
              background:
                'color-mix(in srgb, var(--color-brand-500) 12%, transparent)',
              color: 'var(--color-brand-500)',
            }}
          >
            <MessagesSquare size={32} aria-hidden />
          </div>
          <h1
            className="m-0"
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
            }}
          >
            {t('appName')}
          </h1>
          <p
            className="m-0 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            {t('loginTitle')}
          </p>
        </div>

        <label
          className="flex flex-col gap-1 text-sm"
          style={{ display: 'none' }}
          aria-hidden="true"
        >
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {t('loginServerURL')}
          </span>
          <input
            type="url"
            value={serverURL}
            onChange={(e) => setServerURL(e.target.value)}
            required
            className="px-3 py-2 text-sm"
            style={{
              background: 'var(--color-bg-surface-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {t('loginAccount')}
          </span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="px-3 py-2 text-sm"
            style={{
              background: 'var(--color-bg-surface-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
            }}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--color-text-secondary)' }}>
            {t('loginPassword')}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="px-3 py-2 text-sm"
            style={{
              background: 'var(--color-bg-surface-2)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text-primary)',
            }}
          />
        </label>

        {error && (
          <div
            role="alert"
            className="text-sm"
            style={{ color: 'var(--color-danger)' }}
          >
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={!loginEnabled}
          style={{ height: 44 } as React.CSSProperties}
        >
          {login.isPending ? t('loading') : t('loginButton')}
        </Button>
      </form>
    </div>
  );
}
