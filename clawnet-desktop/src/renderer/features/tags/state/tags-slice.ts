// src/renderer/features/tags/state/tags-slice.ts
//
// Local UI state for the tag management panel — open/close sheets,
// selected tag for editing. The tag *list* lives in React Query cache
// (see hooks/use-tags.ts) since it's server-owned data.

import { create } from 'zustand';
import type { Tag } from '../../../../shared/domain/tag';

type SheetState =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; tag: Tag };

interface TagsSlice {
  sheet: SheetState;
  openCreate: () => void;
  openEdit: (tag: Tag) => void;
  close: () => void;
}

export const useTagsUiStore = create<TagsSlice>((set) => ({
  sheet: { kind: 'closed' },
  openCreate: () => set({ sheet: { kind: 'create' } }),
  openEdit: (tag) => set({ sheet: { kind: 'edit', tag } }),
  close: () => set({ sheet: { kind: 'closed' } }),
}));
