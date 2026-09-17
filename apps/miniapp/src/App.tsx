import { useEffect, useState } from 'react';
import { AnalyticsScreen } from './components/AnalyticsScreen.js';
import { HistoryScreen } from './components/HistoryScreen.js';
import { MealDetailScreen } from './components/MealDetailScreen.js';
import { SearchScreen } from './components/SearchScreen.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import { type Backend, createBackend, type RecentMeal } from './lib/backend.js';

type Tab = 'home' | 'history' | 'search' | 'analytics' | 'settings';

type View = { name: 'tabs' } | { name: 'detail'; mealId: string } | { name: 'error'; message: string };

const backend: Backend = createBackend();

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [view, setView] = useState<View>({ name: 'tabs' });
  const [recent, setRecent] = useState<RecentMeal[]>([]);

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
        />
      </div>
    );
  }

  if (view.name === 'error') {
    return (
      <div className="app">
        <div className="center">
          <p className="warn">{view.message}</p>
          <button type="button" className="btn" onClick={() => setView({ name: 'tabs' })}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const openMeal = (mealId: string) => setView({ name: 'detail', mealId });

  return (
    <div className="app">
      {tab === 'home' && (
        <>
          <div className="header">
            <h1>FoodLog</h1>
            <span className="muted">{recent.length} logged</span>
          </div>

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
                      {m.energyKcal ?? '—'} kcal · {new Date(m.when).toLocaleString()}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'history' && <HistoryScreen backend={backend} onOpenMeal={openMeal} />}
      {tab === 'search' && <SearchScreen backend={backend} onOpenMeal={openMeal} />}
      {tab === 'analytics' && <AnalyticsScreen backend={backend} />}
      {tab === 'settings' && <SettingsScreen backend={backend} />}

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
    </div>
  );
}
