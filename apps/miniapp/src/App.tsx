import { type TouchEvent as ReactTouchEvent, useEffect, useRef, useState } from 'react';
import { AnalyticsScreen } from './components/AnalyticsScreen.js';
import { HistoryScreen } from './components/HistoryScreen.js';
import { MealDetailScreen } from './components/MealDetailScreen.js';
import { SearchScreen } from './components/SearchScreen.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import { MacroLine } from './components/MacroLine.js';
import { ToastHost, useToasts } from './components/ToastHost.js';
import { type Backend, createBackend, type RecentMeal } from './lib/backend.js';
import { classifySwipe, nextTabIndex } from './lib/gesture.js';
import { summarizeToday } from './lib/summary.js';

const TABS = ['home', 'history', 'search', 'analytics', 'settings'] as const;
type Tab = (typeof TABS)[number];

type View = { name: 'tabs' } | { name: 'detail'; mealId: string };

const backend: Backend = createBackend();

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [view, setView] = useState<View>({ name: 'tabs' });
  const [recent, setRecent] = useState<RecentMeal[]>([]);
  const { toasts, notify, dismiss } = useToasts();
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  function onTabTouchStart(e: ReactTouchEvent) {
    const t = e.touches[0];
    swipeStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function onTabTouchEnd(e: ReactTouchEvent) {
    const start = swipeStart.current;
    const t = e.changedTouches[0];
    swipeStart.current = null;
    if (!start || !t) return;
    const dir = classifySwipe(start, { x: t.clientX, y: t.clientY });
    if (dir !== 'left' && dir !== 'right') return;
    const idx = TABS.indexOf(tab);
    const next = nextTabIndex(idx, dir, TABS.length);
    if (next !== idx) setTab(TABS[next] as Tab);
  }

  useEffect(() => {
    backend
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  if (view.name === 'detail') {
    return (
      <div className="app">
        <MealDetailScreen
          backend={backend}
          mealId={view.mealId}
          onBack={() => setView({ name: 'tabs' })}
          onChanged={() => {
            backend.recent().then(setRecent).catch(() => {});
          }}
          onToast={notify}
        />
        <ToastHost toasts={toasts} onDismiss={dismiss} />
      </div>
    );
  }

  const openMeal = (mealId: string) => setView({ name: 'detail', mealId });

  return (
    <div className="app">
      <div className="tab-content" onTouchStart={onTabTouchStart} onTouchEnd={onTabTouchEnd}>
      {tab === 'home' && (
        <>
          <div className="header">
            <h1>FoodLog</h1>
            <span className="muted">{recent.length} logged</span>
          </div>

          {(() => {
            const today = summarizeToday(recent);
            return (
              <div className="card summary-card">
                <div className="summary-stat">
                  <div className="summary-value">{today.totalKcal}</div>
                  <div className="muted">kcal today</div>
                </div>
                <div className="summary-stat">
                  <div className="summary-value">{today.mealCount}</div>
                  <div className="muted">{today.mealCount === 1 ? 'meal' : 'meals'}</div>
                </div>
              </div>
            );
          })()}

          <div className="card" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 40 }}>📷</div>
            <p className="food-name" style={{ margin: '8px 0 4px' }}>
              Log a meal by sending a photo to the bot
            </p>
            <p className="muted" style={{ marginTop: 0 }}>
              Snap your meal in the chat — it's analyzed and logged automatically, and the photo is
              kept. Come back here to review, edit, and see your history.
            </p>
          </div>

          {recent.length > 0 && (
            <div>
              <p className="muted">Recent</p>
              {recent.slice(0, 5).map((m) => (
                <button
                  type="button"
                  className="card saved-item"
                  key={m.id}
                  onClick={() => openMeal(m.id)}
                  style={{ marginBottom: 8, width: '100%', textAlign: 'left', cursor: 'pointer' }}
                >
                  {m.previewUrl && <img src={m.previewUrl} alt="" />}
                  <div>
                    <div className="food-name">{m.label}</div>
                    <div className="macro">
                      <MacroLine energyKcal={m.energyKcal} compact /> ·{' '}
                      {new Date(m.when).toLocaleDateString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && (
        <HistoryScreen backend={backend} onOpenMeal={openMeal} onToast={notify} />
      )}
      {tab === 'search' && <SearchScreen backend={backend} onOpenMeal={openMeal} />}
      {tab === 'analytics' && <AnalyticsScreen backend={backend} />}
      {tab === 'settings' && <SettingsScreen backend={backend} />}
      </div>

      <nav className="tabbar">
        <button
          type="button"
          className={tab === 'home' ? 'active' : ''}
          onClick={() => setTab('home')}
        >
          🏠 Home
        </button>
        <button
          type="button"
          className={tab === 'history' ? 'active' : ''}
          onClick={() => setTab('history')}
        >
          📅 History
        </button>
        <button
          type="button"
          className={tab === 'search' ? 'active' : ''}
          onClick={() => setTab('search')}
        >
          🔍 Search
        </button>
        <button
          type="button"
          className={tab === 'analytics' ? 'active' : ''}
          onClick={() => setTab('analytics')}
        >
          📊 Stats
        </button>
        <button
          type="button"
          className={tab === 'settings' ? 'active' : ''}
          onClick={() => setTab('settings')}
        >
          ⚙️ Settings
        </button>
      </nav>

      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
