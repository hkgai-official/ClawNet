import { describe, it, expect, vi } from 'vitest';
import {
  platformLabel,
  deviceFamilyLabel,
  reportedPlatformLabel,
  reportedDeviceFamilyLabel,
  resolveDisplayName,
} from '../platform-identity';

describe('platformLabel', () => {
  it('maps darwin → macos (matches Swift ChatService.swift:119)', () => {
    expect(platformLabel('darwin')).toBe('macos');
  });
  it('maps win32 → windows', () => {
    expect(platformLabel('win32')).toBe('windows');
  });
  it('maps linux → linux', () => {
    expect(platformLabel('linux')).toBe('linux');
  });
  it('falls through to the raw platform string for unknown values', () => {
    expect(platformLabel('freebsd' as NodeJS.Platform)).toBe('freebsd');
  });
});

describe('deviceFamilyLabel', () => {
  it('maps darwin → Mac (matches Swift InstanceIdentity.swift:47)', () => {
    expect(deviceFamilyLabel('darwin')).toBe('Mac');
  });
  it('maps win32 → Windows', () => {
    expect(deviceFamilyLabel('win32')).toBe('Windows');
  });
  it('maps linux → Linux', () => {
    expect(deviceFamilyLabel('linux')).toBe('Linux');
  });
  it('falls through to "Unknown" for unmapped values', () => {
    expect(deviceFamilyLabel('freebsd' as NodeJS.Platform)).toBe('Unknown');
  });
});

describe('reportedPlatformLabel / reportedDeviceFamilyLabel (wire-side, pinned)', () => {
  // These are pinned to macos/Mac to dodge the server-side per-platform
  // allowlist that only authorises file commands on macos. See the
  // file-level comment in platform-identity.ts for the why.
  it('reportedPlatformLabel is always "macos"', () => {
    expect(reportedPlatformLabel()).toBe('macos');
  });
  it('reportedDeviceFamilyLabel is always "Mac"', () => {
    expect(reportedDeviceFamilyLabel()).toBe('Mac');
  });
});

describe('resolveDisplayName', () => {
  it('on darwin: prefers scutil ComputerName output', () => {
    const runExec = vi.fn().mockReturnValue('Alice MBA');
    const getHostname = vi.fn().mockReturnValue('alice-mba.local');
    expect(resolveDisplayName('darwin', runExec, getHostname)).toBe('Alice MBA');
    expect(runExec).toHaveBeenCalledWith('scutil --get ComputerName');
    expect(getHostname).not.toHaveBeenCalled();
  });

  it('on darwin: falls back to hostname if scutil throws', () => {
    const runExec = vi.fn().mockImplementation(() => {
      throw new Error('command not found');
    });
    const getHostname = vi.fn().mockReturnValue('alice-mba.local');
    expect(resolveDisplayName('darwin', runExec, getHostname)).toBe('alice-mba.local');
  });

  it('on darwin: falls back to hostname if scutil returns empty', () => {
    const runExec = vi.fn().mockReturnValue('');
    const getHostname = vi.fn().mockReturnValue('alice-mba.local');
    expect(resolveDisplayName('darwin', runExec, getHostname)).toBe('alice-mba.local');
  });

  it('on win32: uses hostname directly without calling scutil', () => {
    const runExec = vi.fn();
    const getHostname = vi.fn().mockReturnValue('DESKTOP-ABC123');
    expect(resolveDisplayName('win32', runExec, getHostname)).toBe('DESKTOP-ABC123');
    expect(runExec).not.toHaveBeenCalled();
  });

  it('on linux: uses hostname directly without calling scutil', () => {
    const runExec = vi.fn();
    const getHostname = vi.fn().mockReturnValue('thinkpad');
    expect(resolveDisplayName('linux', runExec, getHostname)).toBe('thinkpad');
    expect(runExec).not.toHaveBeenCalled();
  });

  it('falls back to "ClawNet" when every lookup is empty', () => {
    const runExec = vi.fn().mockReturnValue('');
    const getHostname = vi.fn().mockReturnValue('');
    expect(resolveDisplayName('darwin', runExec, getHostname)).toBe('ClawNet');
  });
});
