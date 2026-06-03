import { create } from 'zustand';

// Mirrors the dialog.draft.updated push payload (after deepSnakeToCamel) per
// macOS ChatEventHandler.swift. macOS keeps mainDraftText / secondaryDraftText
// on a separate session-scoped state rather than on DialogSession itself;
// this slice does the same on the renderer side.

export type DraftStatus = 'generating' | 'ready' | 'refining';

export interface DraftPayload {
  sessionId: string;
  mainDraftText?: string;
  secondaryDraftText?: string;
  status?: DraftStatus;
}

export interface DraftState {
  mainDraftText?: string;
  secondaryDraftText?: string;
  status?: DraftStatus;
}

interface DialogDraftStore {
  drafts: Record<string, DraftState>;
  updateDraft(payload: DraftPayload): void;
  clearDraft(sessionId: string): void;
}

export const useDialogDraftStore = create<DialogDraftStore>((set) => ({
  drafts: {},
  updateDraft: (p) => set((s) => {
    const cur = s.drafts[p.sessionId] ?? {};
    const next: DraftState = { ...cur };
    if (p.mainDraftText !== undefined) next.mainDraftText = p.mainDraftText;
    if (p.secondaryDraftText !== undefined) next.secondaryDraftText = p.secondaryDraftText;
    if (p.status !== undefined) next.status = p.status;
    return { drafts: { ...s.drafts, [p.sessionId]: next } };
  }),
  clearDraft: (sessionId) => set((s) => {
    const next = { ...s.drafts };
    delete next[sessionId];
    return { drafts: next };
  }),
}));
