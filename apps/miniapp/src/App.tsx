import type { DailyTargets } from '@snapbite/core';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AppShell, type ShellTab } from './components/AppShell.js';
import { CaptureSheet } from './components/CaptureSheet.js';
import { HomeScreen } from './components/HomeScreen.js';
import { SetupLayer } from './components/SetupLayer.js';
import { Skeleton } from './components/ui/skeleton';
import { Toaster } from './components/ui/sonner';
import { type Me, authNotice, fetchMe, takeAuthStatus } from './lib/account.js';
import type { SettingsView } from './lib/api.js';
import { type Backend, type RecentMeal, createBackend } from './lib/backend.js';
import { cacheKey, getCached, revalidate } from './lib/cache.js';
import { readConfig } from './lib/config.js';
import { markKeyDecision } from './lib/onboarding.js';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const cameraRef = useRef<HTMLButtonElement>(null);

  // Profile/targets drive the Home rings + onboarding gate.
  const [targets, setTargets] = useState<DailyTargets | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  // What the SERVER said about this account, as opposed to `hasProfile`, which a
  // cached copy may have seeded. Only this opens the welcome: a cache written by
  // another account (the anonymous one, before signing in) must not.
  const [serverProfile, setServerProfile] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);

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
        // An account with a profile never sees setup on launch, whatever this
        // device remembers: a missing AI key is not a reason to start over.
        setServerProfile(Boolean(s.profile));
      })
      .catch(() => {
        // Could not reach the server: we do not know whether this account has a
        // profile, so do not guess "no" and greet a returning user with the
        // welcome. Home's "Set goal" card is the way in until we can tell.
      });
  };

  useEffect(refreshProfile, []);

  // Who is this browser? Asked once at boot, alongside the settings fetch. The
  // welcome waits for the answer, so a signed-in account is never shown it, and
  // `?auth=` (where the sign-in redirect lands) is read, acted on and removed.
  // If the question cannot be answered we behave as anonymous: never guess.
  const askMe = backend.mode === 'worker' && readConfig().hasBackend;
  const [me, setMe] = useState<Me | null>(null);
  const [meSettled, setMeSettled] = useState(!askMe);
  useEffect(() => {
    const status = takeAuthStatus();
    if (!askMe) {
      const note = authNotice(status, null);
      if (note) toastFn(note.kind, note.message);
      return;
    }
    let live = true;
    void fetchMe(readConfig().apiBase).then((answer) => {
      if (!live) return;
      setMe(answer);
      setMeSettled(true);
      const note = authNotice(status, answer);
      if (note) toastFn(note.kind, note.message);
    });
    return () => {
      live = false;
    };
  }, [askMe]);

  // Back/forward and in-app navigation both land here.
  useEffect(
    () =>
      onRouteChange((next) => {
        setRoute(next);
        // Navigating (tab bar, Back) leaves the add-meal menu behind.
        setMenuOpen(false);
        if (next.name === 'day') setHomeDate(next.date);
      }),
    [],
  );

  // Welcome: shown on every launch where the account has nothing at all (no
  // profile and no targets). The account decides, not a flag in localStorage.
  // `onboardingSkipped` is in-memory on purpose: Skip hides setup for this
  // session, and the next launch shows the welcome again. A profile without
  // targets lands on Home with the "Set goal" card instead. Signed-in or not is
  // decided before this opens (`meSettled`), so setup mounts already knowing
  // whether to start on the form.
  useEffect(() => {
    if (meSettled && serverProfile === false && targets === null && !onboardingSkipped) {
      setShowOnboarding(true);
    }
  }, [meSettled, serverProfile, targets, onboardingSkipped]);

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
    // Skipping persists nothing: the key step records its own decision, and a
    // skipped welcome must come back next launch.
    if (opts.skipped) setOnboardingSkipped(true);
    else {
      markKeyDecision('set');
      if (opts.targets) setTargets(opts.targets);
      setHasProfile(true);
      setServerProfile(true);
    }
    setShowOnboarding(false);
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
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((v) => !v)}
          captureRef={cameraRef}
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
        open={menuOpen}
        onOpenChange={setMenuOpen}
        triggerRef={cameraRef}
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
              account={me?.signedIn ? { email: me.email } : null}
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
