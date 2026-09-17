import { useEffect, useState } from 'react';
import type { AnalyticsSummary } from '../lib/api.js';
import type { Backend } from '../lib/backend.js';

interface AnalyticsScreenProps {
  backend: Backend;
}

/** Analytics from stored data (no AI). Simple CSS bar charts for the kcal trend. */
export function AnalyticsScreen({ backend }: AnalyticsScreenProps) {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend
      .analytics(30)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [backend]);

  if (error) return <p className="warn">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (data.totalMeals === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📊</div>
        <p className="food-name">No data yet</p>
        <p className="muted">Log a few meals via the bot to see your trends here.</p>
      </div>
    );
  }

  const maxKcal = Math.max(1, ...data.daily.map((d) => d.kcal));
  // Chart oldest -> newest so it reads left to right.
  const chart = [...data.daily].reverse();

  return (
    <div>
      <h1>Analytics</h1>
      <p className="muted">Last {data.days} days · estimates from your logs</p>

      <div className="card" style={{ display: 'flex', gap: 12, justifyContent: 'space-around' }}>
        <Stat label="Meals" value={String(data.totalMeals)} />
        <Stat label="Total kcal" value={String(data.totalKcal)} />
        <Stat label="Avg / meal" value={String(data.avgKcalPerMeal)} />
      </div>

      <p className="muted" style={{ marginBottom: 4 }}>
        Daily calories (estimate)
      </p>
      <div className="chart">
        {chart.map((d) => (
          <div className="chart-col" key={d.date} title={`${d.date}: ${d.kcal} kcal`}>
            <div className="chart-bar" style={{ height: `${(d.kcal / maxKcal) * 100}%` }} />
            <span className="chart-label">{d.date.slice(5)}</span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Avg macros / meal (estimate)
        </p>
        <div className="macro">
          P {data.macroAverages.proteinG}g · C {data.macroAverages.carbsG}g · F{' '}
          {data.macroAverages.fatG}g
        </div>
      </div>

      {data.commonFoods.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            Most logged foods
          </p>
          {data.commonFoods.map((f) => (
            <div className="food-row" key={f.name}>
              <span className="food-name">{f.name}</span>
              <span className="muted">×{f.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="food-name" style={{ fontSize: 20 }}>
        {value}
      </div>
      <div className="muted">{label}</div>
    </div>
  );
}
