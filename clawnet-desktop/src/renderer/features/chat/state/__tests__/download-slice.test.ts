import { describe, it, expect, beforeEach } from 'vitest';
import { useDownloadStore } from '../download-slice';

beforeEach(() => useDownloadStore.setState({ downloads: {} }));

describe('download-slice', () => {
  it('startDownload seeds an entry with status="in_progress" and totalBytes', () => {
    useDownloadStore.getState().startDownload('m-1', 1000);
    expect(useDownloadStore.getState().downloads['m-1']).toEqual({
      bytesReceived: 0,
      totalBytes: 1000,
      status: 'in_progress',
    });
  });

  it('updateProgress patches bytesReceived', () => {
    useDownloadStore.getState().startDownload('m-1', 1000);
    useDownloadStore.getState().updateProgress('m-1', 500);
    expect(useDownloadStore.getState().downloads['m-1']?.bytesReceived).toBe(500);
  });

  it('updateProgress patches totalBytes when the optional 3rd arg is provided (backfill)', () => {
    // Started with totalBytes=0 (response headers not seen yet); first progress
    // event carries the real Content-Length and should patch it.
    useDownloadStore.getState().startDownload('m-1', 0);
    useDownloadStore.getState().updateProgress('m-1', 256, 1000);
    expect(useDownloadStore.getState().downloads['m-1']).toMatchObject({
      bytesReceived: 256,
      totalBytes: 1000,
    });
  });

  it('updateProgress leaves totalBytes alone when the 3rd arg is omitted', () => {
    useDownloadStore.getState().startDownload('m-1', 999);
    useDownloadStore.getState().updateProgress('m-1', 100);
    expect(useDownloadStore.getState().downloads['m-1']?.totalBytes).toBe(999);
  });

  it('completeDownload sets status="completed" and stores localPath', () => {
    useDownloadStore.getState().startDownload('m-1', 1000);
    useDownloadStore.getState().completeDownload('m-1', '/tmp/cache/m-1_x.pdf');
    expect(useDownloadStore.getState().downloads['m-1']).toMatchObject({
      status: 'completed',
      localPath: '/tmp/cache/m-1_x.pdf',
    });
  });

  it('failDownload sets status="failed" + reason', () => {
    useDownloadStore.getState().startDownload('m-1', 1000);
    useDownloadStore.getState().failDownload('m-1', 'oops');
    expect(useDownloadStore.getState().downloads['m-1']).toMatchObject({
      status: 'failed',
      reason: 'oops',
    });
  });
});
