/**
 * Renders a shareable meal card to a JPEG blob using the built-in Canvas 2D API
 * — no image/canvas libraries (keeps the bundle light per project principles).
 *
 * JPEG rather than PNG: the card is a photo card, so lossless encoding only
 * inflates the file (a full-resolution PNG ran ~1.9 MB) and slows the share
 * sheet. Quality 0.9 is visually indistinguishable and a few hundred KB.
 *
 * The card mirrors the in-app preview (`ShareCard`): 4:5, the photo fills the
 * top 60%, and a fixed rhythm below it carries the title, calories, three equal
 * macro columns and one caption line. Nothing but the wordmark sits over the
 * photo. Colours are read from the app's CSS tokens, so the shared image matches
 * the sheet the user previewed in light or dark mode.
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

// 4:5, the portrait crop social apps show without letterboxing.
const W = 1080;
const H = 1350;
/** The photo owns the top 60%; content owns the rest. */
const PHOTO_H = Math.round(H * 0.6);

/**
 * The preview card is 384 px wide on a 430 px screen, so the export is 2.81×
 * that width. These sizes are the preview's rhythm scaled up: 12/8/16/8 becomes
 * 34/23/45/23, and every text size keeps the same optical size on a phone.
 */
const PAD = 45;
const GAP_AFTER_PHOTO = 34;
const GAP_TITLE_KCAL = 23;
const GAP_KCAL_MACROS = 45;
const GAP_MACROS_FOOTER = 23;

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const DISPLAY_FONT = 'ui-serif, "New York", Georgia, "Times New Roman", serif';
const BRAND = '#1f4fd0';

interface CardTheme {
  card: string;
  foreground: string;
  muted: string;
  secondary: string;
  border: string;
}

/** A themed colour, falling back when there is no CSSOM (tests, exotic hosts). */
function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback;
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}

function readTheme(): CardTheme {
  return {
    card: themeColor('--card', '#edf2fb'),
    foreground: themeColor('--foreground', '#0f172a'),
    muted: themeColor('--muted-foreground', '#5a6780'),
    secondary: themeColor('--secondary', '#e3eaf7'),
    border: themeColor('--border', '#b6c7e3'),
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load meal photo'));
    img.src = url;
  });
}

// The real SnapBite logo (bundled at /icon.png, same-origin). Cached across
// renders. Falls back to the drawn mark if it can't load.
let logoPromise: Promise<HTMLImageElement | null> | null = null;
function loadLogo(): Promise<HTMLImageElement | null> {
  if (!logoPromise) {
    logoPromise = loadImage('/icon.png').catch(() => null);
  }
  return logoPromise;
}

/** Draws the SnapBite logo image (or the drawn fallback) as a disc at (cx,cy). */
function drawLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  cx: number,
  cy: number,
  r: number,
): void {
  if (!logo) {
    drawBrandMark(ctx, cx, cy, r);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(logo, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
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

/**
 * Cleans an AI-written meal title for display: drops leading filler like
 * "Identified as " / "This is " / "A photo of " and capitalizes the first
 * letter. Falls back to "Meal" when empty. Shared by the preview and the JPEG.
 */
export function cleanTitle(raw: string | undefined): string {
  let t = (raw ?? '').trim();
  // Strip common AI lead-ins, e.g. "Identified as ...", "Identified ...",
  // "Detected ...", "This is ...", "A photo of ...", "Looks like ...".
  t = t.replace(
    /^(identified(?:\s+as)?|detected|recognized(?:\s+as)?|this (?:is|appears to be)|appears to be|looks like|a (?:photo|picture|plate) of|photo of|image of|the meal is|meal:)\s+/i,
    '',
  );
  t = t.trim().replace(/^["'“”]+|["'“”]+$/g, '');
  if (!t) return 'Meal';
  return t.charAt(0).toUpperCase() + t.slice(1);
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

/** Draws the SnapBite mark (fork inside a ring/plate) at (cx,cy) with radius r. */
function drawBrandMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  // Blue disc.
  ctx.fillStyle = BRAND;
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

/** A small wordmark pill over the top-left of the photo. */
function drawWordmarkPill(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null): void {
  const x = 40;
  const y = 40;
  const h = 76;
  const padX = 18;
  const r = 26;
  const gap = 12;

  ctx.font = `700 30px ${FONT}`;
  const textW = ctx.measureText('SnapBite').width;
  const w = padX + r * 2 + gap + textW + padX;

  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();

  drawLogo(ctx, logo, x + padX + r, y + h / 2, r);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 30px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('SnapBite', x + padX + r * 2 + gap, y + h / 2 + 1);
}

/** The no-photo panel: a plain secondary surface with the wordmark, centred. */
function drawEmptyPhoto(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement | null,
  theme: CardTheme,
): void {
  ctx.fillStyle = theme.secondary;
  ctx.fillRect(0, 0, W, PHOTO_H);

  const r = 52;
  const gap = 18;
  ctx.font = `700 44px ${FONT}`;
  const textW = ctx.measureText('SnapBite').width;
  const totalW = r * 2 + gap + textW;
  const logoCx = W / 2 - totalW / 2 + r;

  drawLogo(ctx, logo, logoCx, PHOTO_H / 2, r);
  ctx.fillStyle = theme.foreground;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('SnapBite', logoCx + r + gap, PHOTO_H / 2 + 1);
}

export async function renderMealShareCard(input: MealShareCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  const theme = readTheme();
  const logo = await loadLogo();

  // --- Card surface ---------------------------------------------------------
  ctx.fillStyle = theme.card;
  ctx.fillRect(0, 0, W, H);

  // --- Photo: top 60%, cover-cropped, no meal text over it ------------------
  let hasPhoto = false;
  if (input.photoUrl) {
    try {
      const img = await loadImage(input.photoUrl);
      drawImageCover(ctx, img, 0, 0, W, PHOTO_H);
      hasPhoto = true;
    } catch {
      drawEmptyPhoto(ctx, logo, theme);
    }
  } else {
    drawEmptyPhoto(ctx, logo, theme);
  }
  if (hasPhoto) drawWordmarkPill(ctx, logo);

  // --- Title: one line, ellipsis -------------------------------------------
  const titleTop = PHOTO_H + GAP_AFTER_PHOTO;
  const titleLineH = 45 * 1.2;
  ctx.fillStyle = theme.foreground;
  ctx.font = `600 45px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(truncateToWidth(ctx, cleanTitle(input.title), W - PAD * 2), PAD, titleTop);

  // --- Calories: display-serif number, caption unit on the same line --------
  const kcalTop = titleTop + titleLineH + GAP_TITLE_KCAL;
  const kcalText = String(Math.round(input.calories));
  ctx.fillStyle = theme.foreground;
  ctx.font = `400 90px ${DISPLAY_FONT}`;
  ctx.fillText(kcalText, PAD, kcalTop);
  const kcalW = ctx.measureText(kcalText).width;
  ctx.fillStyle = theme.muted;
  ctx.font = `400 37px ${FONT}`;
  // Sit the unit on the number's baseline (the number's ascent is ~0.8em).
  ctx.fillText('kcal', PAD + kcalW + 12, kcalTop + 42);

  // --- Macros: three equal columns, label and value centred in each ---------
  const macrosTop = kcalTop + 92 + GAP_KCAL_MACROS;
  const colW = (W - PAD * 2) / 3;
  const macros: Array<[string, number]> = [
    ['Protein', input.proteinG],
    ['Carbs', input.carbsG],
    ['Fat', input.fatG],
  ];
  for (const [i, [label, grams]] of macros.entries()) {
    const cx = PAD + colW * i + colW / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.muted;
    ctx.font = `400 37px ${FONT}`;
    ctx.fillText(label, cx, macrosTop);
    ctx.fillStyle = theme.foreground;
    ctx.font = `600 40px ${FONT}`;
    ctx.fillText(`${Math.round(grams)}g`, cx, macrosTop + 61);
  }

  // --- Footer caption -------------------------------------------------------
  const footerTop = macrosTop + 109 + GAP_MACROS_FOOTER;
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.muted;
  ctx.font = `400 37px ${FONT}`;
  ctx.fillText('Snap a photo · log your meal · SnapBite', PAD, footerTop);

  // Hairline edge, so the card still reads as a card on a white background.
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create image'))),
      'image/jpeg',
      0.9,
    );
  });
}
