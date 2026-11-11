import type { DailyTargets } from '@snapbite/core';
import { Home, Settings as SettingsIcon } from 'lucide-react';
import { Suspense, lazy, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CaptureButton } from './components/CaptureButton.js';
import { HomeScreen } from './components/HomeScreen.js';
import { Skeleton } from './components/ui/skeleton';
import { Toaster } from './components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import type { SettingsView } from './lib/api.js';
import { type Backend, type RecentMeal, createBackend } from './lib/backend.js';
import { cacheKey, getCached, revalidate } from './lib/cache.js';
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

type Tab = 'home' | 'settings';

const backend: Backend = createBackend();

const NAV: Array<{ id: Tab; label: string; Icon: typeof Home }> = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

const toastFn = (kind: 'success' | 'error' | 'info', msg: string) =>
  toast[kind === 'error' ? 'error' : 'success'](msg);

function ScreenFallback() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-32 rounded-md" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

export function App() {
  // Navigation is the URL (see lib/router.ts), so a reload keeps your place.
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const tab: Tab = route.name === 'settings' ? 'settings' : 'home';
  const detailId = route.name === 'meal' ? route.id : null;
  const [detailMeal, setDetailMeal] = useState<RecentMeal | null>(null);
  // Bumped to tell Home to revalidate after a detail-screen edit/delete.
  // (A signal, NOT a remount key — so Home keeps its selected day/view.)
  const [homeVersion, setHomeVersion] = useState(0);
  // Home's selected day comes from the URL; the view toggle stays in memory.
  const [homeDate, setHomeDate] = useState(() =>
    route.name === 'day' ? route.date : todayKey(),
  );
  const [homeView, setHomeView] = useState<'daily' | 'weekly'>('daily');
  // In-app capture: analysing a just-taken photo, then logging it with the image.
  const [capturing, setCapturing] = useState(false);

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
        // Profile saved but no key yet: the person was mid-onboarding, so reopen
        // straight at the key step instead of making them redo their details.
        if (s.profile && !s.connected) {
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

  // First-run onboarding (skippable): show once when we know there's no profile.
  useEffect(() => {
    if (hasProfile === false && !onboardingSkipped) setShowOnboarding(true);
  }, [hasProfile, onboardingSkipped]);

  const openMeal = (meal: RecentMeal) => {
    setDetailMeal(meal);
    navigate({ name: 'meal', id: meal.id });
  };

  if (showOnboarding) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col p-4">
        <Suspense fallback={<ScreenFallback />}>
          <OnboardingScreen
            backend={backend}
            startAtKeyStep={resumeKeyStep}
            onDone={(t) => {
              setTargets(t);
              setHasProfile(true);
              setShowOnboarding(false);
              setResumeKeyStep(false);
              setHomeVersion((v) => v + 1);
            }}
            onSkip={() => {
              setOnboardingSkipped(true);
              setShowOnboarding(false);
              setResumeKeyStep(false);
            }}
            onToast={toastFn}
          />
        </Suspense>
        <Toaster />
      </div>
    );
  }

  if (detailId) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col p-4">
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
        <Toaster />
      </div>
    );
  }

  /**
   * Analyze a photo taken in the app, then log it with the image itself.
   * One user gesture, two calls: /analyze (AI) then POST /meals with the bytes.
   */
  async function logFromPhoto(
    photo: { base64: string; mimeType: string; eatenAt?: string },
    _file: Blob,
  ): Promise<void> {
    setCapturing(true);
    try {
      const draft = await backend.analyze(photo.base64, photo.mimeType, photo.eatenAt);
      await backend.logWithPhoto(draft, { base64: photo.base64, mimeType: photo.mimeType });
      setHomeVersion((v) => v + 1);
      toast.success(`Logged ${Math.round(draft.total.energyKcal)} kcal`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not log that photo');
      throw err;
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => navigate(v === 'settings' ? { name: 'settings' } : { name: 'home' })}
        className="flex min-h-svh flex-col gap-0"
      >
        <div className="flex-1 overflow-y-auto p-4 pb-24">
          <TabsContent value="home">
            <div className="mb-3">
              <CaptureButton busy={capturing} onAnalyze={logFromPhoto} />
            </div>
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
              onToast={toastFn}
            />
          </TabsContent>
          <TabsContent value="settings">
            <Suspense fallback={<ScreenFallback />}>
              <SettingsScreen backend={backend} onProfileSaved={refreshProfile} />
            </Suspense>
          </TabsContent>
        </div>

        <TabsList className="fixed inset-x-0 bottom-0 z-40 mx-auto h-16 max-w-md rounded-none border-t bg-background p-0">
          {NAV.map(({ id, label, Icon }) => (
            <TabsTrigger
              key={id}
              value={id}
              className="flex h-full flex-col gap-1 rounded-none data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"
            >
              <Icon className="size-5" />
              <span className="text-[10px]">{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Toaster />
    </div>
  );
}
