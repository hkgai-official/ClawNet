import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enAgent from './en/agent.json';
import enChat from './en/chat.json';
import enCommon from './en/common.json';
import enSettings from './en/settings.json';
import enContacts from './en/contacts.json';
import enSearch from './en/search.json';
import enTags from './en/tags.json';
import enProfile from './en/profile.json';
import enAudit from './en/audit.json';
import statusBarEn from './en/status-bar.json';
import updateEn from './en/update.json';
import zhAgent from './zh-Hans/agent.json';
import zhChat from './zh-Hans/chat.json';
import zhCommon from './zh-Hans/common.json';
import zhSettings from './zh-Hans/settings.json';
import zhContacts from './zh-Hans/contacts.json';
import zhSearch from './zh-Hans/search.json';
import zhTags from './zh-Hans/tags.json';
import zhProfile from './zh-Hans/profile.json';
import zhAudit from './zh-Hans/audit.json';
import statusBarZh from './zh-Hans/status-bar.json';
import updateZh from './zh-Hans/update.json';
import zhHantAgent from './zh-Hant/agent.json';
import zhHantChat from './zh-Hant/chat.json';
import zhHantCommon from './zh-Hant/common.json';
import zhHantSettings from './zh-Hant/settings.json';
import zhHantContacts from './zh-Hant/contacts.json';
import zhHantSearch from './zh-Hant/search.json';
import zhHantTags from './zh-Hant/tags.json';
import zhHantProfile from './zh-Hant/profile.json';
import zhHantAudit from './zh-Hant/audit.json';
import statusBarZhHant from './zh-Hant/status-bar.json';
import updateZhHant from './zh-Hant/update.json';
import type { Language } from '../../shared/ipc-contract';

export async function initI18n(initialLanguage: Language): Promise<void> {
  await i18n.use(initReactI18next).init({
    lng: initialLanguage,
    // zh-Hant falls back to zh-Hans (mostly mutually intelligible) then en.
    fallbackLng: { 'zh-Hant': ['zh-Hans', 'en'], default: ['en'] },
    ns: ['common', 'settings', 'chat', 'agent', 'contacts', 'search', 'tags', 'profile', 'audit', 'status-bar', 'update'],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    resources: {
      en: {
        common: enCommon, settings: enSettings, chat: enChat, agent: enAgent,
        contacts: enContacts, search: enSearch, tags: enTags, profile: enProfile,
        audit: enAudit, 'status-bar': statusBarEn, update: updateEn,
      },
      'zh-Hans': {
        common: zhCommon, settings: zhSettings, chat: zhChat, agent: zhAgent,
        contacts: zhContacts, search: zhSearch, tags: zhTags, profile: zhProfile,
        audit: zhAudit, 'status-bar': statusBarZh, update: updateZh,
      },
      'zh-Hant': {
        common: zhHantCommon, settings: zhHantSettings, chat: zhHantChat, agent: zhHantAgent,
        contacts: zhHantContacts, search: zhHantSearch, tags: zhHantTags, profile: zhHantProfile,
        audit: zhHantAudit, 'status-bar': statusBarZhHant, update: updateZhHant,
      },
    },
  });
}

export async function changeLanguage(lang: Language): Promise<void> {
  await i18n.changeLanguage(lang);
}
