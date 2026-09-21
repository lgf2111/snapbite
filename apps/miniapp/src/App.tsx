import type { DailyTargets } from '@snapbite/core';
import { Home, Settings as SettingsIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { HomeScreen } from './components/HomeScreen.js';
import { Skeleton } from './components/ui/skeleton';
import { Toaster } from './components/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import type { SettingsView } from './lib/api.js';
import { type Backend, createBackend } from './lib/backend.js';
import { cacheKey, getCached, revalidate } from './lib/cache.js';

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
  const [tab, setTab] = useState<Tab>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailAiInstruction, setDetailAiInstruction] = useState<string | null>(null);
  // Bump to force Home to refetch after a detail-screen edit/delete.
  const [homeVersion, setHomeVersion] = useState(0);

  // Profile/targets drive the Home rings + onboarding gate.
  const [targets, setTargets] = useState<DailyTargets | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
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
      })
      .catch(() => {
        if (!cached) {
          setTargets(null);
          setHasProfile(false);
        }
      });
  };

  useEffect(refreshProfile, []);

  // First-run onboarding (skippable): show once when we know there's no profile.
  useEffect(() => {
    if (hasProfile === false && !onboardingSkipped) setShowOnboarding(true);
  }, [hasProfile, onboardingSkipped]);

  const openMeal = (id: string) => {
    setDetailAiInstruction(null);
    setDetailId(id);
  };
  const openMealWithAi = (id: string) => {
    setDetailAiInstruction('');
    setDetailId(id);
  };

  if (showOnboarding) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col p-4">
        <Suspense fallback={<ScreenFallback />}>
          <OnboardingScreen
            backend={backend}
            onDone={(t) => {
              setTargets(t);
              setHasProfile(true);
              setShowOnboarding(false);
              setHomeVersion((v) => v + 1);
            }}
            onSkip={() => {
              setOnboardingSkipped(true);
              setShowOnboarding(false);
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
            onBack={() => setDetailId(null)}
            onChanged={() => setHomeVersion((v) => v + 1)}
            onToast={toastFn}
            initialAiInstruction={detailAiInstruction}
          />
        </Suspense>
        <Toaster />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="flex min-h-svh flex-col gap-0"
      >
        <div className="flex-1 overflow-y-auto p-4 pb-24">
          <TabsContent value="home">
            <HomeScreen
              key={homeVersion}
              backend={backend}
              targets={targets}
              onOpenMeal={openMeal}
              onOpenMealWithAi={openMealWithAi}
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
