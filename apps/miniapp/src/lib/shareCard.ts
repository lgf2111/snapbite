/**
 * Renders a shareable meal card to a PNG blob using the built-in Canvas 2D API
 * — no image/canvas libraries (keeps the bundle light per project principles).
 *
 * The design is SnapBite's own: a deep Telegram-blue backdrop (matching the app
 * and logo), a full-bleed meal photo that fades smoothly into the background, a
 * bold title, a hero calorie readout, three translucent macro pills with
 * brand-colored dots, and a drawn SnapBite mark + wordmark so it's branded even
 * without loading the logo file.
 */

export interface MealShareCardInput {
  /** Cross-origin-loadable image URL for the meal photo (may be null). */
  photoUrl?: string | null;
  /** Meal title/name. */
  title: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

// Canvas dimensions (portrait 9:16, Instagram-story friendly).
const W = 1080;
const H = 1920;

// SnapBite palette — derived from the logo (deep blue) + the app's dark theme.
const COLOR = {
  brand: '#1f4fd0', // logo blue
  brandBright: '#3aa0ff', // app primary / accents
  bgTop: '#0f1830', // deep navy (behind photo fade)
  bgBottom: '#0a1120', // near-black navy (bottom)
  ink: '#ffffff',
  sub: '#aebbd4', // muted blue-grey text
  pill: 'rgba(255,255,255,0.06)',
  pillBorder: 'rgba(255,255,255,0.10)',
  protein: '#fb7185',
  carbs: '#fbbf24',
  fat: '#a78bfa',
  kcal: '#ff7a59',
} as const;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load meal photo'));
    img.src = url;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Cover-crop an image into a rect (like CSS object-fit: cover). */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** Truncates text to a single line with an ellipsis when it exceeds maxWidth. */
function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const t = text.trim();
  if (ctx.measureText(t).width <= maxWidth) return t;
  let s = t;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s.trimEnd()}…`;
}

/** A macro pill: translucent rounded card, colored dot, label, and value. */
function drawMacroPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dotColor: string,
  label: string,
  value: string,
): void {
  ctx.fillStyle = COLOR.pill;
  roundRect(ctx, x, y, w, h, 30);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLOR.pillBorder;
  roundRect(ctx, x, y, w, h, 30);
  ctx.stroke();

  const cx = x + w / 2;
  // Colored dot + label centered on the top row.
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(x + 40, y + 52, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOR.sub;
  ctx.font = `600 30px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 40 + 26, y + 52);

  // Big value, centered.
  ctx.fillStyle = COLOR.ink;
  ctx.font = `800 62px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, cx, y + h - 42);
}

/** Draws the SnapBite mark (fork inside a ring/plate) at (cx,cy) with radius r. */
function drawBrandMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Blue disc.
  ctx.fillStyle = COLOR.brand;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // White plate ring.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();

  // White fork: handle + three tines.
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  const forkTop = cy - r * 0.34;
  const tineBot = cy - r * 0.02;
  const handleBot = cy + r * 0.4;
  // Handle.
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.05);
  ctx.lineTo(cx, handleBot);
  ctx.stroke();
  // Tines.
  ctx.lineWidth = r * 0.07;
  for (const dx of [-r * 0.16, 0, r * 0.16]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, forkTop);
    ctx.lineTo(cx + dx, tineBot);
    ctx.stroke();
  }
}

export async function renderMealShareCard(input: MealShareCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  // --- Background: deep navy gradient --------------------------------------
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, COLOR.bgTop);
  bg.addColorStop(1, COLOR.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // --- Photo (full-bleed top) that fades into the background ---------------
  const photoH = 1120;
  if (input.photoUrl) {
    try {
      const img = await loadImage(input.photoUrl);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, photoH);
      ctx.clip();
      drawImageCover(ctx, img, 0, 0, W, photoH);
      ctx.restore();
    } catch {
      drawPlaceholderPhoto(ctx, photoH);
    }
  } else {
    drawPlaceholderPhoto(ctx, photoH);
  }

  // Fade the bottom of the photo into the navy background (no hard seam).
  const fadeH = 340;
  const fade = ctx.createLinearGradient(0, photoH - fadeH, 0, photoH);
  fade.addColorStop(0, 'rgba(15,24,48,0)');
  fade.addColorStop(1, COLOR.bgTop);
  ctx.fillStyle = fade;
  ctx.fillRect(0, photoH - fadeH, W, fadeH);
  // A slim top scrim so the wordmark stays legible over bright photos.
  const topScrim = ctx.createLinearGradient(0, 0, 0, 220);
  topScrim.addColorStop(0, 'rgba(0,0,0,0.35)');
  topScrim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, W, 220);

  // --- Brand lockup (top-left): mark + wordmark ----------------------------
  drawBrandMark(ctx, 78, 88, 44);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 44px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('SnapBite', 138, 90);

  const pad = 72;
  const contentW = W - pad * 2;

  // --- Title (single line, truncated if long) ------------------------------
  ctx.fillStyle = COLOR.ink;
  ctx.font = `800 64px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const titleY = photoH + 40;
  ctx.fillText(truncateToWidth(ctx, input.title || 'Meal', contentW), pad, titleY);

  // --- Hero calories -------------------------------------------------------
  // Two clearly separated rows so nothing overlaps:
  //   row 1: flame chip + "CALORIES" label
  //   row 2: big number + "cal" unit (with a comfortable gap)
  const kcal = Math.round(input.calories);

  // Row 1 — header.
  const headerY = titleY + 92; // vertical center of the flame chip / label
  const chipR = 44;
  const chipCx = pad + chipR;
  ctx.fillStyle = 'rgba(255,122,89,0.16)';
  ctx.beginPath();
  ctx.arc(chipCx, headerY, chipR, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `52px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔥', chipCx, headerY + 2);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLOR.sub;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText('CALORIES', chipCx + chipR + 28, headerY);

  // Row 2 — big number + unit, on their own baseline well below the header.
  const numBaseline = headerY + chipR + 118;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLOR.ink;
  ctx.font = `800 138px ${FONT}`;
  ctx.fillText(String(kcal), pad, numBaseline);
  const numW = ctx.measureText(String(kcal)).width;
  ctx.fillStyle = COLOR.kcal;
  ctx.font = `700 50px ${FONT}`;
  ctx.fillText('cal', pad + numW + 40, numBaseline);

  // --- Macro pills row -----------------------------------------------------
  const pillY = numBaseline + 70;
  const gap = 26;
  const pillW = (contentW - gap * 2) / 3;
  const pillH = 190;
  drawMacroPill(ctx, pad, pillY, pillW, pillH, COLOR.protein, 'Protein', `${Math.round(input.proteinG)}g`);
  drawMacroPill(ctx, pad + pillW + gap, pillY, pillW, pillH, COLOR.carbs, 'Carbs', `${Math.round(input.carbsG)}g`);
  drawMacroPill(
    ctx,
    pad + (pillW + gap) * 2,
    pillY,
    pillW,
    pillH,
    COLOR.fat,
    'Fat',
    `${Math.round(input.fatG)}g`,
  );

  // --- Footer --------------------------------------------------------------
  ctx.fillStyle = COLOR.sub;
  ctx.font = `600 30px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Snap a photo · log your meal · SnapBite', W / 2, H - 56);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create image'))),
      'image/png',
    );
  });
}

/** Branded header used when there's no photo: blue gradient + the mark. */
function drawPlaceholderPhoto(ctx: CanvasRenderingContext2D, h: number): void {
  const grad = ctx.createLinearGradient(0, 0, W, h);
  grad.addColorStop(0, COLOR.brand);
  grad.addColorStop(1, COLOR.brandBright);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, h);
  drawBrandMark(ctx, W / 2, h / 2 - 30, 150);
}
