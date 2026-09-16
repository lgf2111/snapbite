import type { MealResult } from '@foodlog/core';
import { useEffect, useRef, useState } from 'react';
import { AnalyticsScreen } from './components/AnalyticsScreen.js';
import { ConfirmScreen } from './components/ConfirmScreen.js';
import { HistoryScreen } from './components/HistoryScreen.js';
import { MealDetailScreen } from './components/MealDetailScreen.js';
import { SearchScreen } from './components/SearchScreen.js';
import { SettingsScreen } from './components/SettingsScreen.js';
import { type Backend, createBackend, type RecentMeal } from './lib/backend.js';
import { downscaleImage } from './lib/image.js';

type Tab = 'home' | 'history' | 'search' | 'analytics' | 'settings';

type View =
  | { name: 'tabs' }
  | { name: 'analyzing' }
  | { name: 'confirm'; meal: MealResult; previewUrl: string }
  | { name: 'detail'; mealId: string }
  | { name: 'error'; message: string };

const backend: Backend = createBackend();

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [view, setView] = useState<View>({ name: 'tabs' });
  const [recent, setRecent] = useState<RecentMeal[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    backend
      .recent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  async function refreshRecent() {
    try {
      setRecent(await backend.recent());
    } catch {
      // keep existing list
    }
  }

  async function handleFile(file: File) {
    setView({ name: 'analyzing' });
    try {
      const image = await downscaleImage(file);
      const meal = await backend.processor.analyze(image);
      setView({ name: 'confirm', meal, previewUrl: image.previewUrl });
    } catch (err) {
      setView({ name: 'error', message: err instanceof Error ? err.message : 'Something failed' });
    }
  }

  async function handleSave(meal: MealResult) {
    const previewUrl = view.name === 'confirm' ? view.previewUrl : undefined;
    try {
      await backend.save(meal, previewUrl);
      await refreshRecent();
      setTab('home');
      setView({ name: 'tabs' });
    } catch (err) {
      setView({ name: 'error', message: err instanceof Error ? err.message : 'Could not save' });
    }
  }

  // Full-screen flows take over the whole view.
  if (view.name === 'analyzing') {
    return (
      <div className="app">
        <div className="center">
          <div className="spinner" />
          <p className="muted">Analyzing your meal…</p>
        </div>
      </div>
    );
  }

  if (view.name === 'confirm') {
    return (
      <div className="app">
        <ConfirmScreen
          initial={view.meal}
          previewUrl={view.previewUrl}
          onSave={handleSave}
          onRetake={() => setView({ name: 'tabs' })}
        />
      </div>
    );
  }

  if (view.name === 'detail') {
    return (
      <div className="app">
        <MealDetailScreen
          backend={backend}
          mealId={view.mealId}
          onBack={() => setView({ name: 'tabs' })}
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

          <label className="camera-cta">
            <span className="icon">📷</span>
            <span>Take a photo of your meal</span>
            <span className="muted">or tap to choose a photo</span>
            <input
              ref={fileInputRef}
              className="hidden-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = '';
              }}
            />
          </label>

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
