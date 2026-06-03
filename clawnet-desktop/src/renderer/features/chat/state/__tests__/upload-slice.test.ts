import { describe, it, expect, beforeEach } from 'vitest';
import { useUploadStore } from '../upload-slice';

beforeEach(() => {
  useUploadStore.setState({ uploads: {} });
});

describe('useUploadStore', () => {
  it('startUpload seeds an in_progress entry with zero bytesSent', () => {
    useUploadStore.getState().startUpload('temp-1', 1000);
    const entry = useUploadStore.getState().uploads['temp-1'];
    expect(entry).toBeDefined();
    expect(entry?.totalBytes).toBe(1000);
    expect(entry?.bytesSent).toBe(0);
    expect(entry?.status).toBe('in_progress');
  });

  it('updateProgress advances bytesSent', () => {
    useUploadStore.getState().startUpload('temp-1', 1000);
    useUploadStore.getState().updateProgress('temp-1', 500);
    expect(useUploadStore.getState().uploads['temp-1']?.bytesSent).toBe(500);
  });

  it('updateProgress is a no-op for unknown temp id', () => {
    useUploadStore.getState().updateProgress('temp-x', 99);
    expect(useUploadStore.getState().uploads['temp-x']).toBeUndefined();
  });

  it('completeUpload removes the slot', () => {
    useUploadStore.getState().startUpload('temp-1', 1000);
    useUploadStore.getState().completeUpload('temp-1');
    expect(useUploadStore.getState().uploads['temp-1']).toBeUndefined();
  });

  it('failUpload preserves the slot with status=failed + reason', () => {
    useUploadStore.getState().startUpload('temp-2', 100);
    useUploadStore.getState().failUpload('temp-2', 'network');
    const entry = useUploadStore.getState().uploads['temp-2'];
    expect(entry?.status).toBe('failed');
    expect(entry?.reason).toBe('network');
  });

  it('setTotalBytes patches totalBytes for an existing entry; no-op for missing', () => {
    useUploadStore.getState().startUpload('t-1', 0);
    useUploadStore.getState().setTotalBytes('t-1', 1000);
    expect(useUploadStore.getState().uploads['t-1']?.totalBytes).toBe(1000);
    useUploadStore.getState().setTotalBytes('t-missing', 500);
    expect(useUploadStore.getState().uploads['t-missing']).toBeUndefined();
  });
});
