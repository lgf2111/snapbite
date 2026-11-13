import type { ReactNode } from 'react';

interface SectionProps {
  title: string;
  hint?: string;
  level?: 2 | 3;
  children: ReactNode;
}

/**
 * A ruled block of content: a hairline above it, 16px of air below the rule,
 * and a sans heading in body 500. The first section in a column drops both the
 * rule and its padding, so a group never opens with a stray line.
 */
export function Section({ title, hint, level = 2, children }: SectionProps) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <Heading className="text-body font-medium">{title}</Heading>
        {hint && <p className="text-muted-foreground text-caption">{hint}</p>}
      </div>
      {children}
    </section>
  );
}
