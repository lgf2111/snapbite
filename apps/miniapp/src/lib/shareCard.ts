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

/**
 * Cleans an AI-written meal title for display: drops leading filler like
 * "Identified as " / "This is " / "A photo of " and capitalizes the first
 * letter. Falls back to "Meal" when empty.
 */
function cleanTitle(raw: string | undefined): string {
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

/**
 * Word-wraps text into at most `maxLines` lines at the current font. Long
 * single words are allowed to overflow rather than break mid-word; if the text
 * needs more than `maxLines`, the last line is ellipsized.
 */
function wrapToLines(
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
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  // If content remains beyond maxLines, ellipsize the last line to fit.
  const shown = lines.join(' ');
  if (shown.replace(/\s+/g, ' ').length < text.trim().replace(/\s+/g, ' ').length) {
    lines[lines.length - 1] = truncateToWidth(ctx, lines[lines.length - 1] ?? '', maxWidth);
  }
  return lines;
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

  // Top row: colored dot + label, centered together as a group.
  ctx.font = `600 30px ${FONT}`;
  const labelW = ctx.measureText(label).width;
  const dotR = 11;
  const dotGap = 16;
  const groupW = dotR * 2 + dotGap + labelW;
  const groupLeft = cx - groupW / 2;
  const rowY = y + 58;
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(groupLeft + dotR, rowY, dotR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = COLOR.sub;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, groupLeft + dotR * 2 + dotGap, rowY);

  // Big value, centered.
  ctx.fillStyle = COLOR.ink;
  ctx.font = `800 62px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(value, cx, y + h - 44);
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
  // Hold a constant bgTop through the upper ~65% (where the photo dissolves)
  // so the dissolve's end color matches the page bg exactly — no seam — then
  // ease to a slightly darker bottom.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, COLOR.bgTop);
  bg.addColorStop(0.65, COLOR.bgTop);
  bg.addColorStop(1, COLOR.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // --- Photo (full-bleed top) that dissolves into the background -----------
  // The photo is drawn a bit TALLER than the visible area, then dissolved to
  // transparent over a long span so it blends continuously into the underlying
  // background gradient — no hard photo edge and no solid-color seam.
  const photoH = 1180; // where the photo has fully dissolved into the bg
  const photoDraw = photoH + 60; // draw slightly past so the fade has image to work on
  if (input.photoUrl) {
    try {
      const img = await loadImage(input.photoUrl);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, photoDraw);
      ctx.clip();
      drawImageCover(ctx, img, 0, 0, W, photoDraw);
      ctx.restore();
    } catch {
      drawPlaceholderPhoto(ctx, photoDraw);
    }
  } else {
    drawPlaceholderPhoto(ctx, photoDraw);
  }

  // Dissolve the photo into the background with a SINGLE smooth gradient (no
  // stepping — stepping produced visible horizontal banding). We fade to the
  // solid background color at the photo's bottom; because the page background
  // is essentially this same navy there, the transition is seamless.
  const fadeTop = photoH - 620;
  const dissolve = ctx.createLinearGradient(0, fadeTop, 0, photoDraw);
  dissolve.addColorStop(0, 'rgba(15,24,48,0)');
  dissolve.addColorStop(0.6, 'rgba(13,20,40,0.55)');
  dissolve.addColorStop(1, COLOR.bgTop);
  ctx.fillStyle = dissolve;
  ctx.fillRect(0, fadeTop, W, photoDraw - fadeTop);
  // Cover any sliver below the photo down to where content begins with the
  // solid bg color, so there's no seam between the fade and the page bg.
  ctx.fillStyle = COLOR.bgTop;
  ctx.fillRect(0, photoDraw, W, 40);

  // A slim top scrim so the wordmark stays legible over bright photos.
  const topScrim = ctx.createLinearGradient(0, 0, 0, 240);
  topScrim.addColorStop(0, 'rgba(0,0,0,0.38)');
  topScrim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, W, 240);

  // --- Brand lockup (top-left): mark + wordmark ----------------------------
  drawBrandMark(ctx, 78, 88, 44);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 44px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('SnapBite', 138, 90);

  const pad = 72;
  const contentW = W - pad * 2;

  // --- Title: show it in full, wrapping up to 2 lines and shrinking to fit --
  // Prefer showing the whole name. Try 68px on up to 2 lines; if it still
  // doesn't fit, step the size down; ellipsize only in the extreme case.
  ctx.fillStyle = COLOR.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const titleTop = photoH + 44;
  const rawTitle = cleanTitle(input.title);
  const maxTitleLines = 2;
  let titleSize = 68;
  const minTitleSize = 48;
  let titleLines: string[] = [];
  for (;;) {
    ctx.font = `800 ${titleSize}px ${FONT}`;
    titleLines = wrapToLines(ctx, rawTitle, contentW, maxTitleLines);
    const fits = titleLines.every((l) => ctx.measureText(l).width <= contentW);
    const wholeShown = titleLines.join(' ').replace(/…$/, '').length >= rawTitle.length - 1;
    if ((fits && wholeShown) || titleSize <= minTitleSize) break;
    titleSize -= 2;
  }
  const titleLineH = titleSize * 1.16;
  ctx.font = `800 ${titleSize}px ${FONT}`;
  titleLines.forEach((line, i) => {
    ctx.fillText(line, pad, titleTop + titleSize + i * titleLineH);
  });
  const titleBottom = titleTop + titleSize + (titleLines.length - 1) * titleLineH;

  // --- Hero calories -------------------------------------------------------
  // Two clearly separated rows so nothing overlaps:
  //   row 1: flame chip + "CALORIES" label
  //   row 2: big number + "kcal" unit (with a comfortable gap)
  const kcal = Math.round(input.calories);

  // Row 1 — header.
  const headerY = titleBottom + 92; // vertical center of the flame chip / label
  const chipR = 44;
  const chipCx = pad + chipR;
  ctx.fillStyle = 'rgba(255,122,89,0.16)';
  ctx.beginPath();
  ctx.arc(chipCx, headerY, chipR, 0, Math.PI * 2);
  ctx.fill();
  // Emoji don't sit on the geometric center with textBaseline alone; using
  // alphabetic baseline + a measured vertical nudge centers it in the chip.
  ctx.font = `48px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const flameMetrics = ctx.measureText('🔥');
  const flameH =
    (flameMetrics.actualBoundingBoxAscent || 34) + (flameMetrics.actualBoundingBoxDescent || 6);
  const flameBaseline = headerY + flameH / 2 - (flameMetrics.actualBoundingBoxDescent || 6);
  ctx.fillText('🔥', chipCx, flameBaseline);

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
  const numFont = `800 138px ${FONT}`;
  ctx.font = numFont;
  const numText = String(kcal);
  ctx.fillText(numText, pad, numBaseline);
  // Measure with the SAME font that drew the number, then place "kcal" after a
  // clear gap so they never overlap.
  ctx.font = numFont;
  const numW = ctx.measureText(numText).width;
  ctx.fillStyle = COLOR.kcal;
  ctx.font = `700 50px ${FONT}`;
  ctx.fillText('kcal', pad + numW + 18, numBaseline);

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
