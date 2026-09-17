import { Camera } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { RecentMeal } from '@/lib/backend';
import { summarizeToday } from '@/lib/summary';
import { MacroLine } from './MacroLine.js';

interface HomeScreenProps {
  recent: RecentMeal[];
  onOpenMeal: (id: string) => void;
}

export function HomeScreen({ recent, onOpenMeal }: HomeScreenProps) {
  const today = summarizeToday(recent);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">FoodLog</h1>
        <span className="text-muted-foreground text-sm">{recent.length} logged</span>
      </div>

      <Card>
        <CardContent className="flex justify-around text-center">
          <div>
            <div className="text-2xl font-bold">{today.totalKcal}</div>
            <div className="text-muted-foreground text-xs">kcal today</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{today.mealCount}</div>
            <div className="text-muted-foreground text-xs">
              {today.mealCount === 1 ? 'meal' : 'meals'}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col items-center gap-2 text-center">
          <Camera className="text-primary size-9" />
          <p className="font-medium">Log a meal by sending a photo to the bot</p>
          <p className="text-muted-foreground text-sm">
            Snap your meal in the chat — it's analyzed and logged automatically, and the photo is
            kept. Come back here to review, edit, and see your history.
          </p>
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">Recent</p>
          {recent.slice(0, 5).map((m) => (
            <Card key={m.id} onClick={() => onOpenMeal(m.id)} className="cursor-pointer">
              <CardContent className="flex items-center gap-3">
                {m.previewUrl && (
                  <img src={m.previewUrl} alt="" className="size-12 rounded-md object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.label}</div>
                  <div className="text-muted-foreground text-xs">
                    <MacroLine energyKcal={m.energyKcal} compact /> ·{' '}
                    {new Date(m.when).toLocaleDateString()}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
