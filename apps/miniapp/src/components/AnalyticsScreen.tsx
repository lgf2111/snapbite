import { BarChart3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AnalyticsSummary } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface AnalyticsScreenProps {
  backend: Backend;
}

/** Analytics from stored data (no AI). Simple bar chart for the kcal trend. */
export function AnalyticsScreen({ backend }: AnalyticsScreenProps) {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    backend
      .analytics(30)
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, [backend]);

  if (error) return <p className="text-destructive text-sm">{error}</p>;
  if (!data) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-36 w-full" />
      </div>
    );
  }
  if (data.totalMeals === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 py-12 text-center">
        <BarChart3 className="size-10" />
        <p className="text-foreground font-medium">No data yet</p>
        <p>Log a few meals via the bot to see your trends here.</p>
      </div>
    );
  }

  const maxKcal = Math.max(1, ...data.daily.map((d) => d.kcal));
  const chart = [...data.daily].reverse();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Analytics</h1>
      <p className="text-muted-foreground text-sm">Last {data.days} days · estimates from your logs</p>

      <Card>
        <CardContent className="flex justify-around text-center">
          <Stat label="Meals" value={String(data.totalMeals)} />
          <Stat label="Total kcal" value={String(data.totalKcal)} />
          <Stat label="Avg / meal" value={String(data.avgKcalPerMeal)} />
        </CardContent>
      </Card>

      <div>
        <p className="text-muted-foreground mb-1 text-sm">Daily calories (estimate)</p>
        <Card>
          <CardContent className="flex h-36 items-end gap-1 overflow-x-auto">
            {chart.map((d) => (
              <div key={d.date} className="flex h-full min-w-6 flex-1 flex-col items-center justify-end gap-1" title={`${d.date}: ${d.kcal} kcal`}>
                <div
                  className="bg-primary w-full rounded-t"
                  style={{ height: `${(d.kcal / maxKcal) * 100}%` }}
                />
                <span className="text-muted-foreground text-[9px] whitespace-nowrap">
                  {d.date.slice(5)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <p className="text-muted-foreground mb-1 text-sm">Avg macros / meal (estimate)</p>
          <p className="text-sm">
            🥩 {data.macroAverages.proteinG}g · 🍚 {data.macroAverages.carbsG}g · 🧈{' '}
            {data.macroAverages.fatG}g
          </p>
        </CardContent>
      </Card>

      {data.commonFoods.length > 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground mb-2 text-sm">Most logged foods</p>
            <div className="flex flex-col gap-1">
              {data.commonFoods.map((f) => (
                <div key={f.name} className="flex justify-between text-sm">
                  <span>{f.name}</span>
                  <span className="text-muted-foreground">×{f.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  );
}
