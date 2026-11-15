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
 * it. The photo frame and the image share one box (`inset-0 size-full`,
 * `object-cover`, `object-center`), so a 9:16, 1:1 or 16:9 source fills the
 * frame: no letterboxing, no distortion, no crop of the card's own text.
 *
 * The card is its own inline-size container. Every type size below the photo is
 * expressed in `cqw`, and so is every gap in that block, so the title, kcal and
 * the three macro columns keep the same composition on a 375 px and a 430 px
 * phone; no type size is set against the viewport. The macro row is a
 * three-column grid with one-line cells, so Protein, Carbs and Fat never wrap.
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
      className="bg-card text-card-foreground flex aspect-[4/5] w-full shrink-0 flex-col overflow-hidden [container-type:inline-size]"
    >
      <div
        data-testid="share-card-photo"
        className="bg-secondary relative h-[60%] w-full shrink-0 overflow-hidden rounded-t-surface"
      >
        {photoUrl ? (
          <img
            data-testid="share-card-photo-img"
            src={photoUrl}
            alt=""
            className="absolute inset-0 size-full object-cover object-center"
          />
        ) : (
          // No photo is a plain panel with the wordmark, never a broken frame.
          <div className="flex size-full items-center justify-center gap-[2.5cqw]">
            <img src="/icon.png" alt="" className="size-[10cqw] rounded-control" />
            <span className="text-[4.2cqw] leading-[1.2] font-semibold">SnapBite</span>
          </div>
        )}

        {photoUrl && (
          <div
            data-testid="share-card-wordmark"
            className="bg-background text-foreground absolute top-3 left-3 flex max-w-[40%] items-center gap-[1.4cqw] rounded-control py-[1.1cqw] pr-[2.4cqw] pl-[1.1cqw]"
          >
            <img src="/icon.png" alt="" className="size-[5.2cqw] shrink-0 rounded-control" />
            <span className="min-w-0 truncate text-[3.2cqw] leading-none font-semibold">
              SnapBite
            </span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-[max(12px,4.5cqw)] pt-[4cqw] pb-[4cqw]">
        <h3 className="text-[4.2cqw] leading-[1.2] truncate font-medium">{cleanTitle(title)}</h3>

        <p className="mt-[1.5cqw] flex items-baseline gap-[1.4cqw]">
          <span className="font-display tabular text-[7.4cqw] leading-none">
            {Math.round(calories)}
          </span>
          <span className="text-[3.2cqw] leading-[1.3] text-muted-foreground">kcal</span>
        </p>

        {/* Keeps the numbers anchored to the foot of the text block: no dead gap. */}
        <div className="flex-1" aria-hidden />

        <dl data-testid="share-card-macros" className="grid grid-cols-3 gap-[1.5cqw] text-center">
          {macros.map(([label, grams]) => (
            <div key={label} className="min-w-0 text-center">
              <dt className="text-[3.2cqw] leading-[1.3] whitespace-nowrap text-muted-foreground">
                {label}
              </dt>
              <dd className="tabular mt-[0.8cqw] text-[4.2cqw] leading-[1.2] font-medium whitespace-nowrap">
                {Math.round(grams)}g
              </dd>
            </div>
          ))}
        </dl>

        <p className="truncate pt-[2.4cqw] text-[3cqw] leading-[1.3] text-muted-foreground">
          Snap a photo · log your meal · SnapBite
        </p>
      </div>
    </article>
  );
}
