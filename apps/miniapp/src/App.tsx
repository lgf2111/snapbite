import type { MealResult } from '@foodlog/core';
import { useRef, useState } from 'react';
import { ConfirmScreen } from './components/ConfirmScreen.js';
import { downscaleImage } from './lib/image.js';
import { LocalMealProcessor, type MealProcessor } from './lib/processor.js';
import { loadMeals, saveMeal, type SavedMeal } from './lib/store.js';

type View =
  | { name: 'home' }
  | { name: 'analyzing' }
  | { name: 'confirm'; meal: MealResult; previewUrl: string }
  | { name: 'error'; message: string };

const processor: MealProcessor = new LocalMealProcessor();

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [meals, setMeals] = useState<SavedMeal[]>(() => loadMeals());
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setView({ name: 'analyzing' });
    try {
      const image = await downscaleImage(file);
      const meal = await processor.analyze(image);
      setView({ name: 'confirm', meal, previewUrl: image.previewUrl });
    } catch (err) {
      setView({ name: 'error', message: err instanceof Error ? err.message : 'Something failed' });
    }
  }

  function handleSave(meal: MealResult) {
    const previewUrl = view.name === 'confirm' ? view.previewUrl : undefined;
    const saved = saveMeal(meal, previewUrl);
    setMeals((prev) => [saved, ...prev]);
    setView({ name: 'home' });
  }

  return (
    <div className="app">
      {view.name === 'home' && (
        <>
          <div className="header">
            <h1>FoodLog</h1>
            <span className="muted">{meals.length} logged</span>
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

          {meals.length > 0 && (
            <div>
              <p className="muted">Recent</p>
              {meals.slice(0, 10).map((m) => (
                <div className="card saved-item" key={m.id} style={{ marginBottom: 8 }}>
                  {m.previewUrl && <img src={m.previewUrl} alt="" />}
                  <div>
                    <div className="food-name">
                      {m.meal.foods.map((f) => f.food.name).join(', ')}
                    </div>
                    <div className="macro">
                      {m.meal.total.energyKcal} kcal · {new Date(m.savedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view.name === 'analyzing' && (
        <div className="center">
          <div className="spinner" />
          <p className="muted">Analyzing your meal…</p>
        </div>
      )}

      {view.name === 'confirm' && (
        <ConfirmScreen
          initial={view.meal}
          previewUrl={view.previewUrl}
          onSave={handleSave}
          onRetake={() => setView({ name: 'home' })}
        />
      )}

      {view.name === 'error' && (
        <div className="center">
          <p className="warn">{view.message}</p>
          <button type="button" className="btn" onClick={() => setView({ name: 'home' })}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}
