import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

interface NumberFieldProps {
  /** Current numeric value (canonical). */
  value: number;
  /** Called with a clamped number when the user commits (blur / Enter). */
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  /** Fallback applied when the field is left empty on blur. */
  fallback: number;
  className?: string;
  'aria-label'?: string;
  id?: string;
}

/**
 * A numeric input that may be temporarily blank while editing. It holds its own
 * string state so deleting all digits shows an empty field (not "0"); on blur
 * (or Enter) it parses, clamps to [min, max], and commits — falling back to
 * `fallback` when left empty. Reflects external value changes when not focused.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  fallback,
  className,
  id,
  ...aria
}: NumberFieldProps & React.AriaAttributes) {
  const [text, setText] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);

  // Keep the display in sync with external changes (e.g. unit switch) when the
  // user isn't actively typing.
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);

  function commit() {
    setFocused(false);
    const raw = text.trim();
    if (raw === '') {
      onCommit(fallback);
      setText(String(fallback));
      return;
    }
    let n = Number(raw);
    if (!Number.isFinite(n)) n = fallback;
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    onCommit(n);
    setText(String(n));
  }

  return (
    <Input
      id={id}
      type="number"
      inputMode="numeric"
      value={text}
      className={className}
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      {...(min != null ? { min } : {})}
      {...(max != null ? { max } : {})}
      {...aria}
    />
  );
}
