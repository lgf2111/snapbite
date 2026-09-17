import type * as React from 'react';
import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

/**
 * A small accessible toggle switch. Track is 44×24 (w-11 h-6); the 20px thumb
 * slides between 2px (off) and 22px (on) so it always stays inside the track.
 */
export function Switch({ checked, onCheckedChange, disabled, id, ...aria }: SwitchProps & React.AriaAttributes) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
      {...aria}
    >
      <span
        className={cn(
          'bg-background pointer-events-none block size-5 rounded-full shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
