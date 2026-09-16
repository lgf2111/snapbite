#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  type AIProvider,
  DeepSeekProvider,
  formatMealResult,
  type MealImage,
  MockAIProvider,
  resolveMeal,
} from '@foodlog/core';
import { HELP_TEXT, mimeTypeForPath, parseArgs } from './args.js';

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    console.log(HELP_TEXT);
    return 0;
  }

  // Choose the provider. Real mode requires an image + a key; mock mode can
  // run with no image at all (handy for a zero-setup demo).
  let provider: AIProvider;
  let image: MealImage;

  if (opts.real) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.error('--real requires DEEPSEEK_API_KEY in the environment.');
      return 1;
    }
    if (!opts.imagePath) {
      console.error('--real requires an image path.');
      return 1;
    }
    provider = new DeepSeekProvider({ apiKey });
    image = await loadImage(opts.imagePath);
    console.error(`Analyzing "${opts.imagePath}" with the real DeepSeek API...`);
  } else {
    provider = new MockAIProvider();
    if (opts.imagePath) {
      image = await loadImage(opts.imagePath);
    } else {
      // Mock ignores bytes; supply a placeholder so the pipeline runs.
      image = { base64: '', mimeType: 'image/jpeg' };
      console.error('No image given — using the mock provider with a canned analysis.');
    }
  }

  const analysis = await provider.analyzeMeal(image, opts.hint ? { hint: opts.hint } : {});
  const meal = resolveMeal(analysis);
  console.log(formatMealResult(meal));
  return 0;
}

async function loadImage(path: string): Promise<MealImage> {
  const mimeType = mimeTypeForPath(path);
  const bytes = await readFile(path);
  return { base64: bytes.toString('base64'), mimeType };
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const e = err as { name?: string; kind?: string; status?: number; message?: string };
    const suffix = e.kind ? ` (kind=${e.kind}${e.status ? `, status=${e.status}` : ''})` : '';
    console.error(`Error: ${e.message ?? String(err)}${suffix}`);
    process.exit(1);
  });
