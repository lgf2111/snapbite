/**
 * Renders a shareable meal card to a PNG blob using the built-in Canvas 2D API
 * — no image/canvas libraries (keeps the bundle light per project principles).
 *
 * Layout (portrait, Instagram-story friendly): the meal photo fills a rounded
 * area at the top, then a light panel below shows the meal name, a calories
 * block, and three macro chips (protein / carbs / fat), with a small SnapBite
 * wordmark. Everything is drawn at a fixed resolution so the output looks crisp
 * when shared or saved.
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

// Canvas dimensions (portrait 9:16-ish).
const W = 1080;
const H = 1920;

// Palette (mirrors the app's light card look).
const COLOR = {
  pageBg: '#f4f1ec',
  card: '#ffffff',
  ink: '#141414',
  muted: '#8a8f98',
  brand: '#3aa0ff',
  protein: '#f43f5e',
  carbs: '#f59e0b',
  fat: '#8b5cf6',
} as const;

/** Loads an image with CORS enabled so the canvas stays exportable. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load meal photo'));
    img.src = url;
  });
}

/** Rounded-rectangle path helper. */
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

/** Draws an image cover-cropped into a rounded rect (like CSS object-fit:cover). */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

/** Word-wraps text to a max width, returning up to `maxLines` lines (last ellipsized). */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines) lines.push(line);
  // Ellipsize the last line if the whole title didn't fit.
  const used = lines.join(' ');
  if (used.length < text.trim().length && lines.length) {
    let last = lines[lines.length - 1] ?? '';
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

/** Draws a macro chip (rounded card with a colored dot, label, and value). */
function drawMacroChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  dotColor: string,
  label: string,
  value: string,
): void {
  ctx.fillStyle = COLOR.card;
  roundRect(ctx, x, y, w, h, 28);
  ctx.fill();

  // Header row: colored dot + label.
  const padX = 32;
  const dotR = 12;
  const headerY = y + 48;
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(x + padX + dotR, headerY, dotR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COLOR.muted;
  ctx.font = '500 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + padX + dotR * 2 + 16, headerY);

  // Value.
  ctx.fillStyle = COLOR.ink;
  ctx.font = '700 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, x + padX, y + h - 40);
}

/**
 * Composes the meal card and returns it as a PNG blob. Works without a photo
 * (draws a branded placeholder header instead).
 */
export async function renderMealShareCard(input: MealShareCardInput): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  // Background.
  ctx.fillStyle = COLOR.pageBg;
  ctx.fillRect(0, 0, W, H);

  // --- Photo header ---------------------------------------------------------
  const photoH = 1040;
  if (input.photoUrl) {
    try {
      const img = await loadImage(input.photoUrl);
      drawImageCover(ctx, img, 0, 0, W, photoH, 0);
    } catch {
      drawPlaceholderHeader(ctx, photoH);
    }
  } else {
    drawPlaceholderHeader(ctx, photoH);
  }

  // Small SnapBite wordmark over the photo (top-left).
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  roundRect(ctx, 40, 40, 220, 66, 33);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('SnapBite', 66, 40 + 34);

  // --- Content panel --------------------------------------------------------
  const panelX = 48;
  const panelY = photoH - 60;
  const panelW = W - panelX * 2;
  const panelH = H - panelY - 48;
  ctx.fillStyle = COLOR.pageBg;
  // (panel shares the page bg; we just lay out content on it)

  // Title.
  ctx.fillStyle = COLOR.ink;
  ctx.font = '800 66px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const titleLines = wrapText(ctx, input.title || 'Meal', panelW, 3);
  let ty = panelY + 96;
  const titleLineH = 80;
  for (const l of titleLines) {
    ctx.fillText(l, panelX, ty);
    ty += titleLineH;
  }

  // Calories block (white rounded card).
  const calY = ty + 24;
  const calH = 220;
  ctx.fillStyle = COLOR.card;
  roundRect(ctx, panelX, calY, panelW, calH, 36);
  ctx.fill();

  // Little flame badge.
  ctx.fillStyle = '#ffe3e0';
  ctx.beginPath();
  ctx.arc(panelX + 74, calY + calH / 2, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '52px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔥', panelX + 74, calY + calH / 2 + 4);

  ctx.textAlign = 'left';
  ctx.fillStyle = COLOR.muted;
  ctx.font = '600 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('CALORIES', panelX + 150, calY + 80);
  ctx.fillStyle = COLOR.ink;
  ctx.font = '800 96px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'alphabetic';
  const kcal = Math.round(input.calories);
  ctx.fillText(String(kcal), panelX + 150, calY + 180);
  const kcalW = ctx.measureText(String(kcal)).width;
  ctx.fillStyle = COLOR.muted;
  ctx.font = '500 40px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('cal', panelX + 150 + kcalW + 18, calY + 180);

  // Macro chips row.
  const chipY = calY + calH + 28;
  const gap = 24;
  const chipW = (panelW - gap * 2) / 3;
  const chipH = 200;
  drawMacroChip(ctx, panelX, chipY, chipW, chipH, COLOR.protein, 'Protein', `${Math.round(input.proteinG)} g`);
  drawMacroChip(ctx, panelX + chipW + gap, chipY, chipW, chipH, COLOR.carbs, 'Carbs', `${Math.round(input.carbsG)} g`);
  drawMacroChip(
    ctx,
    panelX + (chipW + gap) * 2,
    chipY,
    chipW,
    chipH,
    COLOR.fat,
    'Fats',
    `${Math.round(input.fatG)} g`,
  );

  // Footer wordmark.
  ctx.fillStyle = COLOR.muted;
  ctx.font = '500 30px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Logged with SnapBite', W / 2, H - 40);

  void panelH; // panel height reserved for layout clarity

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create image'))),
      'image/png',
    );
  });
}

/** A branded gradient header used when there's no photo. */
function drawPlaceholderHeader(ctx: CanvasRenderingContext2D, h: number): void {
  const grad = ctx.createLinearGradient(0, 0, W, h);
  grad.addColorStop(0, '#2b6fb0');
  grad.addColorStop(1, '#3aa0ff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, h);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '120px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🍽️', W / 2, h / 2);
}
