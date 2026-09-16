import { useState } from 'react';
import type { Backend, RecentMeal } from '../lib/backend.js';

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
    <div>
      <h1>Search</h1>
      <input
        aria-label="Search meals"
        className="food-name"
        placeholder="Search by food…"
        value={query}
        onChange={(e) => void runSearch(e.target.value)}
        style={{
          width: '100%',
          padding: 12,
          borderRadius: 8,
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          marginBottom: 12,
        }}
      />

      {busy && <p className="muted">Searching…</p>}
      {results && results.length === 0 && !busy && <p className="muted">No matches.</p>}
      {results?.map((m) => (
        <button
          type="button"
          className="card saved-item"
          key={m.id}
          onClick={() => onOpenMeal(m.id)}
          style={{ marginBottom: 8, width: '100%', textAlign: 'left', cursor: 'pointer' }}
        >
          <div>
            <div className="food-name">{m.label}</div>
            <div className="macro">
              {m.energyKcal ?? '—'} kcal · {new Date(m.when).toLocaleDateString()}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
