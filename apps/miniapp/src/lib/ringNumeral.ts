/**
 * Sizing the number inside the big ring.
 *
 * The ring's inner circle is fixed (about 108px at hero size) and the numeral is
 * a display serif at 2.75rem. Four digits fit, which is all a day ever needed; a
 * weekly total is five ("12,810") and spilled over the stroke. So the size is
 * driven by how wide the text is: never wider than four digits at the base size
 * (the width that is known to fit), whatever the font draws a digit or a comma
 * at, because the comparison is in units of "one digit".
 */

/** The size four digits have always been drawn at. */
export const HERO_BASE_REM = 2.75;
/** The widest the numeral may be, in digit-widths. */
export const FIT_DIGITS = 4;
/**
 * A comma is about this much of a digit across. Measured on the real font
 * (New York, tabular numerals): a comma takes ~0.85 of a digit, not the 0.4 a
 * proportional serif would suggest, so grouping costs real width.
 */
export const COMMA_DIGITS = 0.9;

/** Digits, grouped by thousands from five digits up (Daily's four stay as they are). */
export function formatRingNumeral(value: number): string {
  const digits = String(Math.max(0, Math.round(value)));
  return digits.length >= 5 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : digits;
}

/** The text's width in digit-widths. */
export function numeralUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += ch === ',' ? COMMA_DIGITS : 1;
  return units;
}

/** Font size in rem: the base up to four digits, scaled down so wider text is no wider. */
export function ringNumeralSizeRem(text: string): number {
  return HERO_BASE_REM * Math.min(1, FIT_DIGITS / numeralUnits(text));
}
