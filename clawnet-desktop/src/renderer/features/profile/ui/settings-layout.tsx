// src/renderer/features/profile/ui/settings-layout.tsx
//
// Mirrors macOS SettingsDetailView.swift:1-53 — sidebar on the left,
// scrollable detail on the right.

import { useState } from 'react';
import { SettingsSidebar, type SettingsPage } from './settings-sidebar';
import { ProfileSettingsPanel } from './profile-settings-panel';
import { GeneralSettingsPanel } from './general-settings-panel';
import { ConnectionSettingsPanel } from './connection-settings-panel';
import { FileAccessPanel } from '../../settings/ui/file-access-panel';
import { TagManagementPanel } from '../../tags/ui/tag-management-panel';

export function SettingsLayout() {
  const [page, setPage] = useState<SettingsPage>('profile');

  return (
    <div
      style={{
        display: 'flex',
        height: '100%',
        background: 'var(--color-bg-app)',
      }}
    >
      <SettingsSidebar active={page} onSelect={setPage} />
      <div
        style={{
          flex: 1, overflowY: 'auto', padding: 32,
        }}
      >
        {page === 'profile' && <ProfileSettingsPanel />}
        {page === 'general' && <GeneralSettingsPanel />}
        {page === 'connection' && <ConnectionSettingsPanel />}
        {page === 'security' && <FileAccessPanel />}
        {page === 'tags' && <TagManagementPanel />}
      </div>
    </div>
  );
}
