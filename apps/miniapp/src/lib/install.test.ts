import { afterEach, describe, expect, it, vi } from 'vitest';
import { installPlatform, isIosSafari, isStandalone } from './install.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('installPlatform', () => {
  it('detects iPhone and iPod by user agent', () => {
    expect(installPlatform({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe('ios');
    expect(
      installPlatform({ userAgent: IPHONE.replace('iPhone', 'iPod'), maxTouchPoints: 5 }),
    ).toBe('ios');
  });

  it('detects iPadOS as a Macintosh with a touch screen, and a real Mac as desktop', () => {
    expect(installPlatform({ userAgent: MAC, maxTouchPoints: 5 })).toBe('ios');
    expect(installPlatform({ userAgent: MAC, maxTouchPoints: 0 })).toBe('other');
  });

  it('detects Android', () => {
    expect(installPlatform({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe('android');
  });

  it('gives desktop nothing', () => {
    expect(installPlatform({ userAgent: WINDOWS, maxTouchPoints: 0 })).toBe('other');
  });
});

describe('isIosSafari', () => {
  it('is true for Safari and false for other iOS browsers and in-app views', () => {
    expect(isIosSafari({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(
      isIosSafari({ userAgent: IPHONE.replace('Version/17.4', 'CriOS/124.0'), maxTouchPoints: 5 }),
    ).toBe(false);
    expect(isIosSafari({ userAgent: IPHONE.replace(' Safari/604.1', ''), maxTouchPoints: 5 })).toBe(
      false,
    );
  });
});

describe('isStandalone', () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => {
    window.matchMedia = realMatchMedia;
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
  });
  const media = (matches: boolean) => {
    window.matchMedia = vi.fn((q: string) => ({
      matches: matches && q.includes('standalone'),
      media: q,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  };

  it('reads the display-mode media query', () => {
    media(true);
    expect(isStandalone()).toBe(true);
    media(false);
    expect(isStandalone()).toBe(false);
  });

  it("reads iOS's navigator.standalone", () => {
    media(false);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
  });
});
