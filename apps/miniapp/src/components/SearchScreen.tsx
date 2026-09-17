import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Backend, RecentMeal } from '@/lib/backend';
import { MacroLine } from './MacroLine.js';

interface SearchScreenProps {
  backend: Backend;
  onOpenMeal: (id: string) => void;
}

/** Search past meals by food name. Deterministic — no AI call. */
export function SearchScreen({ backend, onOpenMeal }: SearchScreenProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RecentMeal[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function runSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults(null);
      return;
    }
    setBusy(true);
    try {
      setResults(await backend.search(q));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Search</h1>
      <Input
        aria-label="Search meals"
        placeholder="Search by food…"
        value={query}
        onChange={(e) => void runSearch(e.target.value)}
      />

      {busy && <p className="text-muted-foreground text-sm">Searching…</p>}

      {results && results.length === 0 && !busy && (
        <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
          <SearchX className="size-10" />
          <p>No matches.</p>
        </div>
      )}

      {results?.map((m) => (
        <Card key={m.id} onClick={() => onOpenMeal(m.id)} className="cursor-pointer">
          <CardContent className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{m.label}</div>
              <div className="text-muted-foreground text-xs">
                <MacroLine energyKcal={m.energyKcal} compact /> ·{' '}
                {new Date(m.when).toLocaleDateString()}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
