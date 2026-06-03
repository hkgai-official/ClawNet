import type { KvStore } from '../../store/kv-store';
import type { Theme, Language } from '../../../shared/ipc-contract';

export type SettingsChange =
  | { theme: Theme; language?: undefined }
  | { language: Language; theme?: undefined };

export class SettingsService {
  constructor(
    private readonly kv: KvStore,
    private readonly onChanged: (change: SettingsChange) => void,
  ) {}

  getTheme(): Theme {
    return (this.kv.get<Theme>('settings.theme') ?? 'system');
  }

  setTheme(theme: Theme): void {
    this.kv.set('settings.theme', theme);
    this.onChanged({ theme });
  }

  getLanguage(): Language {
    return (this.kv.get<Language>('settings.language') ?? 'en');
  }

  setLanguage(language: Language): void {
    this.kv.set('settings.language', language);
    this.onChanged({ language });
  }
}
