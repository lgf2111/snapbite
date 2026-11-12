import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ApiError } from '@/lib/api';
import type { Backend } from '@/lib/backend';
import type {
  AdvancedReport,
  ReportCard as ReportCardData,
  ReportProjection,
  ReportRange,
  ReportTimeOfDay,
  ReportTrendPoint,
  ReportWeek,
  ReportWeekday,
} from '@snapbite/core';
import { ArrowLeft, ChevronRight, Lock, TrendingUp } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';

interface ReportsScreenProps {
  backend: Backend;
  onBack: () => void;
  onSeeCredits: () => void;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const NUM = new Intl.NumberFormat('en-US');

function shortDate(key: string): string {
  const [, month = '1', day = '1'] = key.split('-');
  return `${MONTHS[Number(month) - 1] ?? ''} ${Number(day)}`;
}

function longDate(key: string): string {
  const [year = '', month = '1', day = '1'] = key.split('-');
  return `${MONTHS[Number(month) - 1] ?? ''} ${Number(day)}, ${year}`;
}

function gradeFor(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-surface border border-border bg-card p-4">
      <div>
        <h2 className="font-display text-body font-medium">{title}</h2>
        {hint && <p className="text-muted-foreground text-caption">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-caption">{label}</dt>
      <dd className="tabular font-display text-body font-medium">{value}</dd>
    </div>
  );
}

function ProjectionLine({ projection }: { projection: ReportProjection | null }) {
  if (!projection) {
    return (
      <p className="text-muted-foreground text-caption">
        Log three days in the last two weeks to see a projection.
      </p>
    );
  }

  if (projection.goal === 'maintain') {
    return (
      <p className="text-caption">
        {projection.onPace ? 'Holding steady' : 'Off target'}:{' '}
        <span className="tabular">{NUM.format(projection.avgKcal)}</span> kcal/day vs a{' '}
        <span className="tabular">{NUM.format(projection.targetKcal)}</span> target.
      </p>
    );
  }

  const rate = `${Math.abs(projection.kgPerWeek).toFixed(1)} kg/week`;
  const direction = projection.goal === 'lose' ? 'loss' : 'gain';

  if (projection.projectedDateKey && projection.milestoneWeightKg != null) {
    return (
      <p className="text-caption">
        At <span className="tabular">{rate}</span> of {direction}, your 5% milestone (
        <span className="tabular">{projection.milestoneWeightKg}</span> kg) lands around{' '}
        <span className="font-medium">{longDate(projection.projectedDateKey)}</span>.
      </p>
    );
  }

  return (
    <p className="text-caption">
      {projection.onPace ? 'On pace, but the rate is too slow to date' : 'Not on pace'}:{' '}
      <span className="tabular">
        {projection.deltaKcalPerDay > 0 ? '+' : ''}
        {NUM.format(projection.deltaKcalPerDay)}
      </span>{' '}
      kcal/day vs target.
      {projection.milestoneWeightKg != null && (
        <>
          {' '}
          The 5% milestone is <span className="tabular">{projection.milestoneWeightKg}</span> kg.
        </>
      )}
    </p>
  );
}

function ReportCardSection({
  card,
  projection,
}: {
  card: ReportCardData;
  projection: ReportProjection | null;
}) {
  const grade = gradeFor(card.scorePct);
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-muted-foreground text-caption tracking-wide uppercase">
              Report card · last 7 days
            </p>
            <p className="font-display text-title mt-0.5">
              {card.daysLogged === 0
                ? 'No meals logged'
                : `${card.daysOnTarget} of 7 days on target`}
            </p>
          </div>
          {grade && (
            <span
              aria-label={`Grade ${grade}`}
              className="bg-secondary text-primary-text font-display flex size-11 shrink-0 items-center justify-center rounded-control text-xl font-semibold"
            >
              {grade}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Logged" value={`${card.daysLogged}/7`} />
          <Stat label="Avg kcal" value={card.daysLogged > 0 ? NUM.format(card.avgKcal) : '—'} />
          <Stat label="Avg protein" value={card.daysLogged > 0 ? `${card.avgProteinG} g` : '—'} />
        </dl>

        {card.scorePct == null && (
          <p className="text-muted-foreground text-caption">
            Set a goal in Settings to score calorie and protein adherence.
          </p>
        )}
        <ProjectionLine projection={projection} />
      </CardContent>
    </Card>
  );
}

function TrendSection({ points, range }: { points: ReportTrendPoint[]; range: ReportRange }) {
  const max = Math.max(1, ...points.map((point) => point.energyKcal));
  const logged = points.filter((point) => point.meals > 0).length;

  return (
    <Section
      title="Trend"
      hint={range === '90d' ? 'Daily kcal · last 90 days' : 'Monthly kcal · last 12 months'}
    >
      <div
        className="flex h-28 items-end gap-[2px]"
        role="img"
        aria-label={`${range === '90d' ? 'Daily' : 'Monthly'} calorie trend`}
      >
        {points.map((point) => (
          <div
            key={point.key}
            className="flex h-full min-w-0 flex-1 items-end"
            title={`${point.label}: ${NUM.format(point.energyKcal)} kcal`}
          >
            <div
              className={`w-full rounded-none ${point.meals > 0 ? 'bg-primary' : 'bg-muted'}`}
              style={{ height: `${Math.max(2, (point.energyKcal / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground text-caption flex justify-between gap-2">
        <span>{points[0]?.label}</span>
        <span>
          {logged} logged {range === '90d' ? 'days' : 'months'}
        </span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </Section>
  );
}

function AdherenceSection({ weeks }: { weeks: ReportWeek[] }) {
  const shown = weeks.slice(-8);
  const latest = shown.at(-1);

  return (
    <Section title="Adherence" hint="Weeks that hit both calorie and protein targets">
      <div className="flex flex-col gap-2">
        {shown.map((week) => (
          <div
            key={week.weekStartKey}
            className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2"
          >
            <span className="text-muted-foreground text-caption">
              {shortDate(week.weekStartKey)}
            </span>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${week.scorePct ?? 0}%` }}
              />
            </div>
            <span className="tabular text-caption text-right">
              {week.scorePct == null ? '—' : `${week.scorePct}%`}
            </span>
          </div>
        ))}
      </div>
      {latest && (
        <p className="text-muted-foreground text-caption">
          This week: {latest.loggedDays} of {latest.daysInWindow} days logged ·{' '}
          {latest.proteinHitDays} protein hits.
        </p>
      )}
    </Section>
  );
}

function WeekdaySection({ weekdays }: { weekdays: ReportWeekday[] }) {
  const ordered = [1, 2, 3, 4, 5, 6, 0]
    .map((index) => weekdays[index])
    .filter((day): day is ReportWeekday => day != null);
  const max = Math.max(1, ...ordered.map((day) => day.avgKcal));
  const highest = ordered
    .filter((day) => day.loggedDays > 0)
    .reduce<ReportWeekday | null>(
      (best, day) => (best == null || day.avgKcal > best.avgKcal ? day : best),
      null,
    );

  return (
    <Section title="Weekday pattern" hint="Average kcal on days you logged">
      <div className="flex h-24 items-end gap-2">
        {ordered.map((day) => (
          <div key={day.weekday} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end">
              <div
                className={`w-full rounded-none ${day.loggedDays > 0 ? 'bg-primary/80' : 'bg-muted'}`}
                style={{
                  height: `${day.loggedDays > 0 ? Math.max(3, (day.avgKcal / max) * 100) : 3}%`,
                }}
                title={`${day.label}: ${NUM.format(day.avgKcal)} kcal`}
              />
            </div>
            <span className="text-muted-foreground text-[10px]">{day.label}</span>
          </div>
        ))}
      </div>
      {highest && (
        <p className="text-muted-foreground text-caption">
          {WEEKDAY_NAMES[highest.weekday]} runs highest at{' '}
          <span className="tabular">{NUM.format(highest.avgKcal)}</span> kcal.
        </p>
      )}
    </Section>
  );
}

function TimeOfDaySection({ buckets }: { buckets: ReportTimeOfDay[] }) {
  return (
    <Section title="Time of day" hint="When your meals land">
      <div className="flex flex-col gap-2">
        {buckets.map((bucket) => (
          <div key={bucket.bucket} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2">
            <span className="text-caption">{bucket.label}</span>
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${bucket.sharePct}%` }}
              />
            </div>
            <span className="tabular text-caption text-right">{bucket.meals}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DishesSection({
  dishes,
  drift,
}: { dishes: AdvancedReport['dishes']; drift: AdvancedReport['portionDrift'] }) {
  if (dishes.length === 0) return null;
  return (
    <Section title="Dishes" hint="Most logged foods, and how portions moved">
      <ul className="flex flex-col gap-1.5">
        {dishes.slice(0, 6).map((dish) => (
          <li key={dish.name} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{dish.name}</span>
            <span className="text-muted-foreground text-caption tabular shrink-0">
              {dish.meals} meals · {dish.sharePct}%
            </span>
          </li>
        ))}
      </ul>
      {drift.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <p className="text-muted-foreground text-caption tracking-wide uppercase">
            Portion drift
          </p>
          {drift.map((item) => (
            <p key={item.name} className="text-caption flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate">{item.name}</span>
              <span className="text-muted-foreground tabular shrink-0">
                {item.deltaPct > 0 ? '+' : ''}
                {item.deltaPct}% · {item.firstWeightG} → {item.lastWeightG} g
              </span>
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

/**
 * Advanced reports. The Worker is the gate: a signed-in account without the
 * supporter tag gets a 403, which becomes a real locked state rather than a
 * blurred preview. Local/demo mode computes the same report in the browser.
 */
export function ReportsScreen({ backend, onBack, onSeeCredits }: ReportsScreenProps) {
  const [range, setRange] = useState<ReportRange>('90d');
  const [report, setReport] = useState<AdvancedReport | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'locked' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` deliberately re-runs the same request
  useEffect(() => {
    let live = true;
    setStatus('loading');
    backend
      .analytics(range)
      .then((next) => {
        if (!live) return;
        setReport(next);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (!live) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setStatus('locked');
          return;
        }
        setMessage(error instanceof Error ? error.message : 'Could not load the report.');
        setStatus('error');
      });
    return () => {
      live = false;
    };
  }, [backend, range, reload]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-title truncate">Reports</h1>
          <p className="text-muted-foreground text-caption">Your log, read across time.</p>
        </div>
      </header>

      <ToggleGroup
        type="single"
        value={range}
        onValueChange={(value) => value && setRange(value as ReportRange)}
        block
        aria-label="Report range"
      >
        <ToggleGroupItem value="90d">90 days</ToggleGroupItem>
        <ToggleGroupItem value="12m">12 months</ToggleGroupItem>
      </ToggleGroup>

      {status === 'loading' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-36 w-full rounded-surface" />
          <Skeleton className="h-40 w-full rounded-surface" />
          <Skeleton className="h-32 w-full rounded-surface" />
        </div>
      )}

      {status === 'locked' && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="bg-secondary text-primary-text flex size-10 items-center justify-center rounded-control">
              <Lock className="size-5" />
            </div>
            <div>
              <h2 className="font-display text-title">Reports are part of the supporter tag</h2>
              <p className="text-muted-foreground text-caption mt-1">
                Buy any credit pack once — or start the trial — and advanced analytics stay unlocked
                permanently. Credits run the AI; the tag does not expire.
              </p>
            </div>
            <Button onClick={onSeeCredits}>
              See credits and supporter
              <ChevronRight className="size-4" />
            </Button>
            <button
              type="button"
              className="text-muted-foreground text-caption min-h-11 text-left underline-offset-4 hover:underline"
              onClick={() => setReload((value) => value + 1)}
            >
              I already bought a pack — check again
            </button>
            <p className="text-muted-foreground text-caption">
              The daily rings, weekly view, recap and streak stay free.
            </p>
          </CardContent>
        </Card>
      )}

      {status === 'error' && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="text-muted-foreground size-5" />
              <h2 className="font-display text-body font-medium">Could not load the report</h2>
            </div>
            <p className="text-muted-foreground text-caption">{message}</p>
            <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {status === 'ready' && report && (
        <>
          <ReportCardSection card={report.card} projection={report.projection} />

          {report.totals.meals === 0 ? (
            <Card>
              <CardContent className="flex flex-col gap-2 p-4">
                <h2 className="font-display text-body font-medium">Nothing to report yet</h2>
                <p className="text-muted-foreground text-caption">
                  Log a few meals and this page fills in: trends, weekly adherence, weekday
                  patterns, recurring dishes and a projection.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <TrendSection points={report.series} range={report.range} />
              <AdherenceSection weeks={report.weeks} />
              <WeekdaySection weekdays={report.weekdays} />
              <TimeOfDaySection buckets={report.timeOfDay} />
              <DishesSection dishes={report.dishes} drift={report.portionDrift} />
            </>
          )}
        </>
      )}
    </div>
  );
}
