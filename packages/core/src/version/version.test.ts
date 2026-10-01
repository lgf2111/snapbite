import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  CHANGELOG,
  CURRENT_CHANGELOG,
  broadcastMessage,
  broadcastMessageSince,
} from './version.js';

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

describe('broadcastMessageSince (append-on-edit)', () => {
  // Guard once so the rest of the suite can use plain indexing without `!`.
  if (CHANGELOG.length < 4) throw new Error('these tests expect >= 4 changelog entries');
  const [c0, c1, c2, c3] = CHANGELOG;
  const currentMessage = broadcastMessage(c0);

  it('falls back to a single current entry when sinceVersion is missing', () => {
    expect(broadcastMessageSince(undefined)).toBe(currentMessage);
    expect(broadcastMessageSince(null)).toBe(currentMessage);
  });

  it('falls back to the current entry when sinceVersion is unknown', () => {
    expect(broadcastMessageSince('99.99.99')).toBe(currentMessage);
  });

  it('is a single-entry message when exactly one release is newer', () => {
    // The version immediately after the current one → only the current is newer.
    expect(broadcastMessageSince(c1.version)).toBe(currentMessage);
  });

  it('stacks every release newer than sinceVersion (append, not rewrite)', () => {
    // From the 3rd-newest, the two newer releases stack.
    const msg = broadcastMessageSince(c2.version);
    expect(msg).toContain(`v${c0.version}`);
    expect(msg).toContain(`v${c1.version}`);
    // The one we're already on is NOT re-listed as a new block.
    expect(msg).not.toContain(`v${c2.version}`);
    // Uses the stacked header, not the single-version one.
    expect(msg).toContain('SnapBite updates');
    expect(msg).not.toBe(currentMessage);
  });

  it('never includes the current version twice', () => {
    const msg = broadcastMessageSince(c3.version);
    const occurrences = msg.split(`v${c0.version}`).length - 1;
    expect(occurrences).toBe(1);
  });
});
