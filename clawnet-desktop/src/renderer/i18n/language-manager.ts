import type { Language } from '../../shared/ipc-contract';

let currentLanguage: Language = 'en';

export const LanguageManager = {
  current(): Language { return currentLanguage; },
  set(lang: Language): void { currentLanguage = lang; },
};
