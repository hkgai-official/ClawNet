import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-(--color-bg-surface-2)', className)}
      {...props}
    />
  );
}

export { Skeleton };
