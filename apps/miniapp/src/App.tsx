import type { DailyTargets } from '@snapbite/core';
import { Suspense, lazy, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AppShell, type ShellTab } from './components/AppShell.js';
import { CaptureSheet } from './components/CaptureSheet.js';
import { HomeScreen } from './components/HomeScreen.js';
import { SetupLayer } from './components/SetupLayer.js';
import { Skeleton } from './components/ui/skeleton';
import { Toaster } from './components/ui/sonner';
import type { SettingsView } from './lib/api.js';
import { type Backend, type RecentMeal, createBackend } from './lib/backend.js';
import { cacheKey, getCached, revalidate } from './lib/cache.js';
import { keyDecision, markKeyDecision } from './lib/onboarding.js';
import { type Route, navigate, onRouteChange, parseRoute } from './lib/router.js';
import { todayKey } from './lib/weekPrefs.js';

// Lazy-loaded so they don't bloat the initial (Home) bundle.
const SettingsScreen = lazy(() =>
  import('./components/SettingsScreen.js').then((m) => ({ default: m.SettingsScreen })),
);
const MealDetailScreen = lazy(() =>
  import('./components/MealDetailScreen.js').then((m) => ({ default: m.MealDetailScreen })),
);
const OnboardingScreen = lazy(() =>
  import('./components/OnboardingScreen.js').then((m) => ({ default: m.OnboardingScreen })),
);

const backend: Backend = createBackend();

const toastFn = (kind: 'success' | 'error' | 'info', msg: string): void => {
  toast[kind === 'error' ? 'error' : 'success'](msg);
};

function ScreenFallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-32 rounded-md" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-24 w-full rounded-lg" />
    </div>
  );
}

export function App() {
  // Navigation is the URL (see lib/router.ts), so a reload keeps your place.
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const tab: ShellTab = route.name === 'settings' ? 'settings' : 'home';
  const detailId = route.name === 'meal' ? route.id : null;
  const [detailMeal, setDetailMeal] = useState<RecentMeal | null>(null);
  // Bumped to tell Home to revalidate after a detail-screen edit/delete.
  // (A signal, NOT a remount key — so Home keeps its selected day/view.)
  const [homeVersion, setHomeVersion] = useState(0);
  // Home's selected day comes from the URL; the view toggle stays in memory.
  const [homeDate, setHomeDate] = useState(() => (route.name === 'day' ? route.date : todayKey()));
  const [homeView, setHomeView] = useState<'daily' | 'weekly'>('daily');
  const [captureOpen, setCaptureOpen] = useState(false);

  // Profile/targets drive the Home rings + onboarding gate.
  const [targets, setTargets] = useState<DailyTargets | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  // True when the profile is saved but the optional AI key is still missing and
  // the user had reached that step — a reload must not restart the flow.
  const [resumeKeyStep, setResumeKeyStep] = useState(false);

  const refreshProfile = () => {
    // Seed instantly from cache (no flash of the onboarding gate on reopen),
    // then revalidate and only update if the settings actually changed.
    const cached = getCached<SettingsView>(cacheKey.settings());
    if (cached) {
      setTargets(cached.targets ?? null);
      setHasProfile(Boolean(cached.profile));
    }
    revalidate<SettingsView>(cacheKey.settings(), () => backend.getSettings())
      .then((s) => {
        setTargets(s.targets ?? null);
        setHasProfile(Boolean(s.profile));
        // Profile saved but no key yet: reopen at the key step — unless the
        // person already answered that question, in which case asking again on
        // every launch is the bug this guards.
        if (s.profile && !s.connected && keyDecision() === null) {
          setResumeKeyStep(true);
          setShowOnboarding(true);
        }
      })
      .catch(() => {
        if (!cached) {
          setTargets(null);
          setHasProfile(false);
        }
      });
  };

  useEffect(refreshProfile, []);

  // Back/forward and in-app navigation both land here.
  useEffect(
    () =>
      onRouteChange((next) => {
        setRoute(next);
        if (next.name === 'day') setHomeDate(next.date);
      }),
    [],
  );

  // First-run onboarding (skippable): open on the first load with no profile.
  // Dismissing records a decision, so later launches land on Home with the
  // "Set goal" card instead of re-opening the sheet every time.
  useEffect(() => {
    if (hasProfile === false && !onboardingSkipped && keyDecision() === null) {
      setShowOnboarding(true);
    }
  }, [hasProfile, onboardingSkipped]);

  const openMeal = (meal: RecentMeal) => {
    setDetailMeal(meal);
    navigate({ name: 'meal', id: meal.id });
  };

  /**
   * Onboarding is a full-screen layer over a Home that stays mounted (inert),
   * so finishing or skipping reveals the day exactly as it was. Every way out
   * (Skip, Escape, Back) is a skip, so nobody is trapped in setup.
   */
  const finishOnboarding = (opts: { targets?: DailyTargets | null; skipped?: boolean } = {}) => {
    markKeyDecision(opts.skipped ? 'skipped' : 'set');
    if (opts.skipped) setOnboardingSkipped(true);
    else {
      if (opts.targets) setTargets(opts.targets);
      setHasProfile(true);
    }
    setShowOnboarding(false);
    setResumeKeyStep(false);
    setHomeVersion((v) => v + 1);
  };

  return (
    <>
      {/* Home stays mounted but unreachable while setup covers it. */}
      <div inert={showOnboarding}>
        <AppShell
          active={tab}
          onNavigate={(next) =>
            navigate(next === 'settings' ? { name: 'settings' } : { name: 'day', date: homeDate })
          }
          onCapture={() => setCaptureOpen(true)}
          captureBusy={captureOpen}
        >
          {detailId ? (
            <Suspense fallback={<ScreenFallback />}>
              <MealDetailScreen
                backend={backend}
                mealId={detailId}
                initialMeal={detailMeal}
                onBack={() => {
                  setDetailMeal(null);
                  // Return to the day the meal belongs to, not always today.
                  navigate({ name: 'day', date: homeDate }, { replace: true });
                }}
                onChanged={() => setHomeVersion((v) => v + 1)}
                onToast={toastFn}
              />
            </Suspense>
          ) : tab === 'settings' ? (
            <Suspense fallback={<ScreenFallback />}>
              <SettingsScreen backend={backend} onProfileSaved={refreshProfile} />
            </Suspense>
          ) : (
            <HomeScreen
              backend={backend}
              targets={targets}
              date={homeDate}
              onDateChange={(d) => {
                setHomeDate(d);
                navigate({ name: 'day', date: d });
              }}
              view={homeView}
              onViewChange={setHomeView}
              refreshSignal={homeVersion}
              onOpenMeal={openMeal}
              onSetGoal={() => setShowOnboarding(true)}
              hideInstallGuide={showOnboarding}
              onToast={toastFn}
            />
          )}
        </AppShell>
      </div>

      <CaptureSheet
        backend={backend}
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        onLogged={() => setHomeVersion((v) => v + 1)}
        onManualLogged={() => setHomeVersion((v) => v + 1)}
        onToast={toastFn}
      />

      {showOnboarding && (
        <SetupLayer onDismiss={() => finishOnboarding({ skipped: true })}>
          <Suspense
            fallback={
              <div className="mx-auto max-w-md px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
                <ScreenFallback />
              </div>
            }
          >
            <OnboardingScreen
              backend={backend}
              startAtKeyStep={resumeKeyStep}
              onDone={(t) => finishOnboarding({ targets: t })}
              onSkip={() => finishOnboarding({ skipped: true })}
              onToast={toastFn}
            />
          </Suspense>
        </SetupLayer>
      )}

      <Toaster />
    </>
  );
}
