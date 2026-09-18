import { describe, expect, it } from 'vitest';
import { APP_VERSION, broadcastMessage, CHANGELOG, CURRENT_CHANGELOG } from './version.js';

describe('changelog', () => {
  it('APP_VERSION matches the newest entry', () => {
    expect(APP_VERSION).toBe(CHANGELOG[0]?.version);
    expect(CURRENT_CHANGELOG).toBe(CHANGELOG[0]);
  });

  it('every entry has a version, date, and at least one note', () => {
    for (const e of CHANGELOG) {
      expect(e.version).toMatch(/\d+\.\d+\.\d+/);
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.notes.length).toBeGreaterThan(0);
    }
  });
});

describe('broadcastMessage', () => {
  const entry = { version: '1.2.3', date: '2026-01-01', notes: ['Thing A', 'Thing B'] };

  it('includes the version, all notes, and beta framing', () => {
    const msg = broadcastMessage(entry);
    expect(msg).toContain('v1.2.3');
    expect(msg).toContain('Thing A');
    expect(msg).toContain('Thing B');
    expect(msg.toLowerCase()).toContain('beta');
  });
});
