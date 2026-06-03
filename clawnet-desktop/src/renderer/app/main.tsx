import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initI18n } from '../i18n';
import '../styles/globals.css';

async function bootstrap() {
  const initialLanguage = await window.clawnet
    .invoke('settings.language.get', {})
    .then((r) => (r.ok ? r.data : 'en'));
  await initI18n(initialLanguage as 'en' | 'zh-Hans' | 'zh-Hant');

  const root = document.getElementById('root');
  if (!root) throw new Error('root element missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
