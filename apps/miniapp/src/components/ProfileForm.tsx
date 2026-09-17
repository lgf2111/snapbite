import {
  type ActivityLevel,
  computeTargets,
  feetInchesToCm,
  type Goal,
  inchesToFeetInches,
  kgToLb,
  lbToKg,
  type Sex,
  type Units,
  type UserProfile,
} from '@foodlog/core';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { MacroLine } from './MacroLine.js';

interface ProfileFormProps {
  /** Existing profile to edit, or null for a fresh onboarding form. */
  initial: UserProfile | null;
  submitLabel: string;
  saving?: boolean;
  onSubmit: (profile: UserProfile) => void;
}

const SEXES: Array<{ value: Sex; label: string }> = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const ACTIVITIES: Array<{ value: ActivityLevel; label: string }> = [
  { value: 'sedentary', label: 'Sedentary' },
  { value: 'light', label: 'Light (1–3×/wk)' },
  { value: 'moderate', label: 'Moderate (3–5×/wk)' },
  { value: 'active', label: 'Active (6–7×/wk)' },
  { value: 'very_active', label: 'Very active' },
];

const GOALS: Array<{ value: Goal; label: string }> = [
  { value: 'lose', label: 'Lose' },
  { value: 'maintain', label: 'Maintain' },
  { value: 'gain', label: 'Gain' },
];

/** A segmented single-choice control. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="bg-muted flex flex-wrap gap-1 rounded-md p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded px-2 py-1.5 text-sm whitespace-nowrap transition-colors',
            value === o.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const num = (v: string, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Profile + goal form shared by onboarding and Settings. Collects sex, age,
 * height, weight (in the chosen units), activity, and goal; advanced mode adds
 * manual calorie/macro overrides. Shows a live preview of the computed targets.
 */
export function ProfileForm({ initial, submitLabel, saving, onSubmit }: ProfileFormProps) {
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'male');
  const [age, setAge] = useState<number>(initial?.age ?? 30);
  const [activity, setActivity] = useState<ActivityLevel>(initial?.activity ?? 'moderate');
  const [goal, setGoal] = useState<Goal>(initial?.goal ?? 'maintain');
  const [units, setUnits] = useState<Units>(initial?.units ?? 'metric');
  const [advanced, setAdvanced] = useState<boolean>(initial?.mode === 'advanced');

  // Canonical metric values.
  const [heightCm, setHeightCm] = useState<number>(initial?.heightCm ?? 175);
  const [weightKg, setWeightKg] = useState<number>(initial?.weightKg ?? 75);

  // Advanced overrides.
  const [calOverride, setCalOverride] = useState<string>(
    initial?.calorieTargetOverride ? String(initial.calorieTargetOverride) : '',
  );
  const [pOverride, setPOverride] = useState<string>(
    initial?.macroOverride ? String(initial.macroOverride.proteinG) : '',
  );
  const [cOverride, setCOverride] = useState<string>(
    initial?.macroOverride ? String(initial.macroOverride.carbsG) : '',
  );
  const [fOverride, setFOverride] = useState<string>(
    initial?.macroOverride ? String(initial.macroOverride.fatG) : '',
  );

  const profile = useMemo<UserProfile>(() => {
    const macroFilled = advanced && pOverride && cOverride && fOverride;
    return {
      sex,
      age,
      heightCm,
      weightKg,
      activity,
      goal,
      units,
      mode: advanced ? 'advanced' : 'simple',
      ...(advanced && calOverride ? { calorieTargetOverride: num(calOverride) } : {}),
      ...(macroFilled
        ? {
            macroOverride: {
              proteinG: num(pOverride),
              carbsG: num(cOverride),
              fatG: num(fOverride),
            },
          }
        : {}),
    };
  }, [sex, age, heightCm, weightKg, activity, goal, units, advanced, calOverride, pOverride, cOverride, fOverride]);

  const targets = useMemo(() => computeTargets(profile), [profile]);

  const imperial = units === 'imperial';
  const { feet, inches } = inchesToFeetInches(heightCm / 2.54);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Units</Label>
        <Segmented
          value={units}
          onChange={setUnits}
          options={[
            { value: 'metric', label: 'Metric (kg/cm)' },
            { value: 'imperial', label: 'Imperial (lb/ft)' },
          ]}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Sex</Label>
        <Segmented value={sex} onChange={setSex} options={SEXES} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="age">Age</Label>
          <Input
            id="age"
            type="number"
            min={13}
            max={100}
            value={age}
            onChange={(e) => setAge(Math.round(num(e.target.value, 30)))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="weight">Weight ({imperial ? 'lb' : 'kg'})</Label>
          <Input
            id="weight"
            type="number"
            min={1}
            value={imperial ? Math.round(kgToLb(weightKg)) : Math.round(weightKg)}
            onChange={(e) => {
              const v = num(e.target.value, 1);
              setWeightKg(imperial ? lbToKg(v) : v);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Height</Label>
        {imperial ? (
          <div className="flex gap-2">
            <div className="flex items-center gap-1">
              <Input
                aria-label="Height feet"
                type="number"
                min={1}
                value={feet}
                onChange={(e) => setHeightCm(feetInchesToCm(Math.round(num(e.target.value, 5)), inches))}
                className="w-20"
              />
              <span className="text-muted-foreground text-sm">ft</span>
            </div>
            <div className="flex items-center gap-1">
              <Input
                aria-label="Height inches"
                type="number"
                min={0}
                max={11}
                value={inches}
                onChange={(e) => setHeightCm(feetInchesToCm(feet, Math.round(num(e.target.value, 0))))}
                className="w-20"
              />
              <span className="text-muted-foreground text-sm">in</span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Input
              aria-label="Height cm"
              type="number"
              min={1}
              value={Math.round(heightCm)}
              onChange={(e) => setHeightCm(num(e.target.value, 175))}
              className="w-28"
            />
            <span className="text-muted-foreground text-sm">cm</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Activity</Label>
        <div className="flex flex-col gap-1">
          {ACTIVITIES.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => setActivity(a.value)}
              className={cn(
                'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                activity === a.value ? 'border-primary bg-primary/10' : 'border-input',
              )}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Goal</Label>
        <Segmented value={goal} onChange={setGoal} options={GOALS} />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="advanced">Advanced (manual targets)</Label>
        <button
          id="advanced"
          type="button"
          role="switch"
          aria-checked={advanced}
          onClick={() => setAdvanced((v) => !v)}
          className={cn(
            'relative h-6 w-11 rounded-full transition-colors',
            advanced ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'bg-background absolute top-0.5 size-5 rounded-full shadow transition-transform',
              advanced ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
        </button>
      </div>

      {advanced && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cal">Calorie target (kcal)</Label>
            <Input
              id="cal"
              type="number"
              min={0}
              placeholder={`auto: ${targets.energyKcal}`}
              value={calOverride}
              onChange={(e) => setCalOverride(e.target.value)}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Leave macros blank to auto-calculate. Fill all three to override.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="p">🥩 g</Label>
              <Input id="p" type="number" min={0} value={pOverride} onChange={(e) => setPOverride(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="c">🍚 g</Label>
              <Input id="c" type="number" min={0} value={cOverride} onChange={(e) => setCOverride(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="f">🧈 g</Label>
              <Input id="f" type="number" min={0} value={fOverride} onChange={(e) => setFOverride(e.target.value)} />
            </div>
          </div>
        </div>
      )}

      <div className="bg-muted/50 flex flex-col gap-1 rounded-md p-3">
        <span className="text-muted-foreground text-xs">Your daily targets</span>
        <MacroLine
          energyKcal={targets.energyKcal}
          proteinG={targets.proteinG}
          carbsG={targets.carbsG}
          fatG={targets.fatG}
        />
      </div>

      <Button disabled={saving} onClick={() => onSubmit(profile)}>
        {saving ? 'Saving…' : submitLabel}
      </Button>
    </div>
  );
}
