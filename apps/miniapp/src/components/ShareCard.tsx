import { cleanTitle } from '@/lib/shareCard';

export interface ShareCardProps {
  /** Cross-origin-loadable image URL for the meal photo (may be null). */
  photoUrl?: string | null;
  title: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * The meal card the user previews before sharing.
 *
 * 4:5, the photo owns the top 60%, and nothing but the wordmark pill sits over
 * it. Below the photo the content follows one fixed rhythm — 12 after the
 * photo, 8 after the title, 16 after the calories, 8 after the macros — so the
 * card never develops a dead gap between the title and the numbers.
 *
 * The macro row is a real three-column grid: every column is the same width and
 * both the label and the value are centred in it, so Protein, Carbs and Fat read
 * as one row rather than three boxes with drifting numbers.
 */
export function ShareCard({ photoUrl, title, calories, proteinG, carbsG, fatG }: ShareCardProps) {
  const macros: Array<[string, number]> = [
    ['Protein', proteinG],
    ['Carbs', carbsG],
    ['Fat', fatG],
  ];

  return (
    <article
      data-testid="share-card"
      aria-label="Meal card"
      className="bg-card text-card-foreground flex aspect-[4/5] w-full shrink-0 flex-col overflow-hidden"
    >
      <div
        data-testid="share-card-photo"
        className="bg-secondary relative h-[60%] w-full shrink-0 overflow-hidden rounded-t-xl"
      >
        {photoUrl ? (
          <img
            data-testid="share-card-photo-img"
            src={photoUrl}
            alt=""
            className="size-full object-cover"
          />
        ) : (
          // No photo is a plain panel with the wordmark, never a broken frame.
          <div className="flex size-full items-center justify-center gap-2.5">
            <img src="/icon.png" alt="" className="size-10 rounded-full" />
            <span className="text-base font-bold">SnapBite</span>
          </div>
        )}

        {photoUrl && (
          <div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/40 py-1 pr-2.5 pl-1 text-white backdrop-blur-sm">
            <img src="/icon.png" alt="" className="size-5 rounded-full" />
            <span className="text-[0.6875rem] font-bold tracking-tight">SnapBite</span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-3">
        <h3 className="truncate text-base leading-tight font-semibold">{cleanTitle(title)}</h3>

        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="font-display tabular text-[2rem] leading-none">
            {Math.round(calories)}
          </span>
          <span className="text-caption text-muted-foreground">kcal</span>
        </p>

        <dl data-testid="share-card-macros" className="mt-4 grid grid-cols-3 gap-1 text-center">
          {macros.map(([label, grams]) => (
            <div key={label} className="min-w-0 text-center">
              <dt className="text-caption text-muted-foreground">{label}</dt>
              <dd className="tabular mt-1 text-sm font-semibold">{Math.round(grams)}g</dd>
            </div>
          ))}
        </dl>

        <p className="text-caption text-muted-foreground truncate pt-2">
          Snap a photo · log your meal · SnapBite
        </p>
      </div>
    </article>
  );
}
