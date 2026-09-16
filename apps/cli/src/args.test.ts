import {
  DEFAULT_MOCK_ANALYSIS,
  formatMealResult,
  MockAIProvider,
  resolveMeal,
} from '@foodlog/core';
import { describe, expect, it } from 'vitest';
import { mimeTypeForPath, parseArgs } from './args.js';

describe('parseArgs', () => {
  it('defaults to mock mode with no args', () => {
    const opts = parseArgs([]);
    expect(opts.real).toBe(false);
    expect(opts.imagePath).toBeUndefined();
    expect(opts.help).toBe(false);
  });

  it('parses an image path and --real', () => {
    const opts = parseArgs(['lunch.jpg', '--real']);
    expect(opts.imagePath).toBe('lunch.jpg');
    expect(opts.real).toBe(true);
  });

  it('parses --hint with its value', () => {
    const opts = parseArgs(['lunch.jpg', '--hint', 'chicken bowl']);
    expect(opts.hint).toBe('chicken bowl');
  });

  it('recognizes help flags', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it('takes only the first positional as the image path', () => {
    const opts = parseArgs(['a.jpg', 'b.jpg']);
    expect(opts.imagePath).toBe('a.jpg');
  });
});

describe('mimeTypeForPath', () => {
  it('maps known extensions (case-insensitive)', () => {
    expect(mimeTypeForPath('x.JPG')).toBe('image/jpeg');
    expect(mimeTypeForPath('x.png')).toBe('image/png');
    expect(mimeTypeForPath('x.webp')).toBe('image/webp');
  });

  it('throws on an unsupported extension', () => {
    expect(() => mimeTypeForPath('x.bmp')).toThrow();
  });
});

describe('end-to-end (mock provider)', () => {
  it('analyzes and formats a mixed-source meal', async () => {
    const provider = new MockAIProvider();
    const analysis = await provider.analyzeMeal({ base64: '', mimeType: 'image/jpeg' });
    const meal = resolveMeal(analysis);
    const output = formatMealResult(meal);

    // rice from table + curry from AI estimate => mixed total.
    expect(meal.total.source).toBe('mixed');
    expect(output).toContain('white rice');
    expect(output).toContain('chicken curry');
    expect(output).toContain('TOTAL:');
    expect(output).toContain('estimated');
    // Sanity: default mock has two foods.
    expect(meal.foods).toHaveLength(DEFAULT_MOCK_ANALYSIS.foods.length);
  });
});
