import { describe, it, expect, beforeEach } from 'vitest';
import { useDialogDraftStore } from '../dialog-draft-slice';

describe('useDialogDraftStore', () => {
  beforeEach(() => useDialogDraftStore.setState({ drafts: {} }));

  it('updateDraft merges per sessionId', () => {
    useDialogDraftStore.getState().updateDraft({
      sessionId: 's1', mainDraftText: 'hello', status: 'generating',
    });
    expect(useDialogDraftStore.getState().drafts.s1).toEqual({
      mainDraftText: 'hello', status: 'generating',
    });
    useDialogDraftStore.getState().updateDraft({
      sessionId: 's1', secondaryDraftText: 'alt', status: 'ready',
    });
    const d = useDialogDraftStore.getState().drafts.s1;
    expect(d?.mainDraftText).toBe('hello');
    expect(d?.secondaryDraftText).toBe('alt');
    expect(d?.status).toBe('ready');
  });

  it('updateDraft is independent per sessionId', () => {
    useDialogDraftStore.getState().updateDraft({ sessionId: 's1', mainDraftText: 'a' });
    useDialogDraftStore.getState().updateDraft({ sessionId: 's2', mainDraftText: 'b' });
    expect(useDialogDraftStore.getState().drafts.s1?.mainDraftText).toBe('a');
    expect(useDialogDraftStore.getState().drafts.s2?.mainDraftText).toBe('b');
  });

  it('clearDraft removes', () => {
    useDialogDraftStore.getState().updateDraft({ sessionId: 's1', mainDraftText: 'x', status: 'ready' });
    useDialogDraftStore.getState().clearDraft('s1');
    expect(useDialogDraftStore.getState().drafts.s1).toBeUndefined();
  });
});
