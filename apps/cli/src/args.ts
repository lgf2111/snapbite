import { extname } from 'node:path';
import type { MealImage } from '@snapbite/core';

export interface CliOptions {
  imagePath?: string;
  real: boolean;
  hint?: string;
  help: boolean;
}

/** Parses argv (excluding node + script) into structured options. */
export function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = { real: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--real') opts.real = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--hint') {
      i += 1;
      opts.hint = argv[i];
    } else if (!arg?.startsWith('-') && opts.imagePath === undefined) {
      opts.imagePath = arg;
    }
  }
  return opts;
}

const MIME_BY_EXT: Record<string, MealImage['mimeType']> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/** Maps a file extension to a supported MIME type, or throws. */
export function mimeTypeForPath(path: string): MealImage['mimeType'] {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) {
    throw new Error(
      `Unsupported image type for "${path}". Use one of: jpg, jpeg, png, gif, webp.`,
    );
  }
  return mime;
}

export const HELP_TEXT = `snapbite — analyze a meal photo end-to-end

Usage:
  snapbite <image-path> [--real] [--hint "text"]

Options:
  --real          Call the real DeepSeek API (requires DEEPSEEK_API_KEY).
                  Without this flag, a deterministic mock provider is used.
  --hint "text"   Optional context passed to the analyzer.
  -h, --help      Show this help.

Examples:
  snapbite lunch.jpg
  snapbite lunch.jpg --real --hint "chicken teriyaki bowl"`;
