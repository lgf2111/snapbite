import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface InfoDisclosureProps {
  /** The clickable summary label. */
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * A compact, accessible expandable ("learn more") built on the native
 * <details>/<summary> element — no extra deps, keyboard-accessible, and it
 * animates the chevron. Used to surface explanations (target formula, how to
 * get an API key) right where they're relevant without cluttering the UI.
 */
export function InfoDisclosure({ title, children, className }: InfoDisclosureProps) {
  return (
    <details className={cn('group border-input rounded-md border px-3 py-2', className)}>
      <summary className="text-muted-foreground flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="text-muted-foreground mt-2 flex flex-col gap-1 text-xs leading-relaxed">
        {children}
      </div>
    </details>
  );
}
