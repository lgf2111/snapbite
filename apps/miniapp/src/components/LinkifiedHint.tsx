import { ExternalLink } from './ExternalLink.js';

/**
 * Renders a provider's key hint, turning any domain or URL in it into a real
 * link.
 *
 * The hints come from `PROVIDER_PRESETS` as plain text ("Get a free key at
 * aistudio.google.com"), which left the most important instruction on the screen
 * untappable. Splitting on URLs keeps the copy in one place (core) while making
 * the address a link.
 */
const URL_IN_TEXT = /((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?)/gi;

export function LinkifiedHint({ text, className }: { text: string; className?: string }) {
  const parts: Array<{ value: string; isUrl: boolean }> = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ value: text.slice(last, start), isUrl: false });
    parts.push({ value: match[0], isUrl: true });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ value: text.slice(last), isUrl: false });

  return (
    <p className={className}>
      {parts.map((part, i) =>
        part.isUrl ? (
          <ExternalLink
            key={`${part.value}-${i}`}
            href={part.value.startsWith('http') ? part.value : `https://${part.value}`}
            className="text-primary underline underline-offset-2"
          >
            {part.value}
          </ExternalLink>
        ) : (
          <span key={`t-${i}`}>{part.value}</span>
        ),
      )}
    </p>
  );
}
