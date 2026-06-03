// src/renderer/features/audit/ui/category-chip.tsx
//
// Mirrors macOS CategoryChip (SecurityEventCenter.swift:192-212).

interface Props {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}

export function CategoryChip({ label, isSelected, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: '3px 8px',
        borderRadius: 'var(--radius-sm)',
        background: isSelected ? 'var(--color-brand-50)' : 'var(--color-bg-surface-2)',
        border: `1px solid ${isSelected ? 'var(--color-brand-500)' : 'transparent'}`,
        color: isSelected ? 'var(--color-brand-500)' : 'var(--color-text-primary)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}
