import { BarChart3, Home, Search as SearchIcon, Settings as SettingsIcon, UtensilsCrossed } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AnalyticsScreen } from './components/AnalyticsScreen.js';
import { HistoryScreen } from './components/HistoryScreen.js';
import { HomeScreen } from './components/HomeScreen.js';
import { MealDetailScreen } from './components/MealDetailScreen.js';
import { SearchScreen } from './components/SearchScreen.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Toaster } from './components/ui/sonner';
import { type Backend, createBackend, type RecentMeal } from './lib/backend.js';

type Tab = 'home' | 'history' | 'search' | 'analytics' | 'settings';

const backend: Backend = createBackend();

const NAV: Array<{ id: Tab; label: string; Icon: typeof Home }> = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'history', label: 'History', Icon: UtensilsCrossed },
  { id: 'search', label: 'Search', Icon: SearchIcon },
  { id: 'analytics', label: 'Stats', Icon: BarChart3 },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentMeal[]>([]);

  const refreshRecent = () => {
    backend
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  };

  useEffect(refreshRecent, []);

  const openMeal = (id: string) => setDetailId(id);

  if (detailId) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md flex-col p-4">
        <MealDetailScreen
          backend={backend}
          mealId={detailId}
          onBack={() => setDetailId(null)}
          onChanged={refreshRecent}
          onToast={(kind, msg) => toast[kind === 'error' ? 'error' : 'success'](msg)}
        />
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
            <HomeScreen recent={recent} onOpenMeal={openMeal} />
          </TabsContent>
          <TabsContent value="history">
            <HistoryScreen
              backend={backend}
              onOpenMeal={openMeal}
              onToast={(kind, msg) => toast[kind === 'error' ? 'error' : 'success'](msg)}
              onChanged={refreshRecent}
            />
          </TabsContent>
          <TabsContent value="search">
            <SearchScreen backend={backend} onOpenMeal={openMeal} />
          </TabsContent>
          <TabsContent value="analytics">
            <AnalyticsScreen backend={backend} />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsScreen backend={backend} />
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
