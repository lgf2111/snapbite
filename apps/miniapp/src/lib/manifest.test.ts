import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicPath = (p: string) => resolve(process.cwd(), 'public', p.replace(/^\//, ''));
const manifest = JSON.parse(readFileSync(publicPath('manifest.webmanifest'), 'utf8')) as {
  icons: Array<{ src: string }>;
  shortcuts: Array<{
    name: string;
    short_name: string;
    url: string;
    icons: Array<{ src: string; sizes: string; type: string }>;
  }>;
  share_target: {
    action: string;
    method: string;
    enctype: string;
    params: { text?: string; files: Array<{ name: string; accept: string[] }> };
  };
};

describe('manifest.webmanifest', () => {
  it('has the three long-press shortcuts, with their URLs, short names and an existing icon', () => {
    expect(manifest.shortcuts.map((s) => [s.name, s.url])).toEqual([
      ['Take a photo', '/?capture=camera'],
      ['Upload a photo', '/?capture=library'],
      ['Log by hand', '/?capture=manual'],
    ]);
    for (const s of manifest.shortcuts) {
      expect(s.short_name.length).toBeLessThanOrEqual(12);
      expect(s.icons).toEqual([{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }]);
      expect(existsSync(publicPath(s.icons[0]?.src as string))).toBe(true);
      // Inside the app's scope, so the browser accepts it.
      expect(new URL(s.url, 'https://app.example').pathname).toBe('/');
    }
    // The icon reused is one the manifest already ships.
    expect(manifest.icons.map((i) => i.src)).toContain('/icon-192.png');
  });

  it('is a share target that takes a photo and text by POST, to a path the worker answers', () => {
    const t = manifest.share_target;
    expect(t.method).toBe('POST');
    expect(t.enctype).toBe('multipart/form-data');
    expect(t.params.text).toBe('text');
    expect(t.params.files).toEqual([{ name: 'photo', accept: ['image/*'] }]);
    // The service worker intercepts exactly this path.
    expect(readFileSync(publicPath('sw.js'), 'utf8')).toContain(`'${t.action}'`);
  });
});
