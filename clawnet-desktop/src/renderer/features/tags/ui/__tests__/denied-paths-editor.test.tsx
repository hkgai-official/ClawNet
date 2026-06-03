// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { DeniedPathsEditor } from '../denied-paths-editor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

beforeEach(() => cleanup());

function setup(initial: string[] = []) {
  const onChange = vi.fn();
  const result = render(<DeniedPathsEditor value={initial} onChange={onChange} />);
  return { onChange, ...result };
}

describe('DeniedPathsEditor', () => {
  it('renders empty-state hint when no paths', () => {
    setup([]);
    expect(screen.getByText('noDeniedPaths')).toBeTruthy();
  });

  it('lists current paths with a remove button each', () => {
    setup(['/a/b', '/c/d']);
    expect(screen.getByText('/a/b')).toBeTruthy();
    expect(screen.getByText('/c/d')).toBeTruthy();
    // Two × buttons (one per row).
    expect(screen.getAllByLabelText('remove').length).toBe(2);
  });

  it('adds a path via the Add button when input is non-empty', () => {
    const { onChange } = setup([]);
    const input = screen.getByPlaceholderText('deniedPathPlaceholder');
    fireEvent.change(input, { target: { value: '/etc/secrets' } });
    fireEvent.click(screen.getByText('add'));
    expect(onChange).toHaveBeenCalledWith(['/etc/secrets']);
  });

  it('adds a path via Enter key', () => {
    const { onChange } = setup([]);
    const input = screen.getByPlaceholderText('deniedPathPlaceholder');
    fireEvent.change(input, { target: { value: '**/.env' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['**/.env']);
  });

  it('trims whitespace and ignores empty input', () => {
    const { onChange } = setup([]);
    const input = screen.getByPlaceholderText('deniedPathPlaceholder');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not duplicate an existing path; clears input instead', () => {
    const { onChange } = setup(['/dup']);
    const input = screen.getByPlaceholderText('deniedPathPlaceholder');
    fireEvent.change(input, { target: { value: '/dup' } });
    fireEvent.click(screen.getByText('add'));
    expect(onChange).not.toHaveBeenCalled();
    // Input cleared (state reset) — re-read its value.
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('removes a path when × is clicked', () => {
    const { onChange } = setup(['/a/b', '/c/d']);
    const xButtons = screen.getAllByLabelText('remove');
    fireEvent.click(xButtons[0]!);
    expect(onChange).toHaveBeenCalledWith(['/c/d']);
  });

  it('disables the Add button while input is empty', () => {
    setup([]);
    const addBtn = screen.getByText('add').closest('button');
    expect(addBtn?.disabled).toBe(true);
  });
});
