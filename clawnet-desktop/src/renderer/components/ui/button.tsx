import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  primary:
    'bg-(--color-brand-500) text-white hover:bg-(--color-brand-600) active:bg-(--color-brand-700)',
  secondary:
    'bg-(--color-bg-surface-2) text-(--color-text-primary) hover:bg-(--color-bg-overlay) border border-(--color-border-subtle)',
  ghost:
    'bg-transparent text-(--color-text-primary) hover:bg-(--color-bg-overlay)',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      {...props}
      className={[
        'inline-flex items-center justify-center gap-2',
        'rounded-(--radius-md) font-medium',
        'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring-color)',
        'disabled:opacity-50 disabled:pointer-events-none',
        variantClass[variant],
        sizeClass[size],
        className ?? '',
      ].join(' ')}
    />
  ),
);
Button.displayName = 'Button';
