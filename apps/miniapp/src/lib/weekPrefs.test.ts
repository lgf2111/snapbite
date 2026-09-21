import { describe, expect, it } from 'vitest';
import { weekRange } from './weekPrefs';

describe('weekRange', () => {
  // 2026-02-04 is a Wednesday.
  const wed = '2026-02-04';

  it('rolling mode: anchor and the previous 6 days', () => {
    const r = weekRange(wed, { mode: 'rolling', weekStart: 'monday' });
    expect(r.startKey).toBe('2026-01-29'); // 6 days before Wed
    expect(r.endKey).toBe('2026-02-04'); // the anchor
    expect(r.dayKeys).toHaveLength(7);
    expect(r.dayKeys[0]).toBe('2026-01-29');
    expect(r.dayKeys[6]).toBe('2026-02-04');
  });

  it('calendar mode (Monday start): Mon–Sun containing the anchor', () => {
    const r = weekRange(wed, { mode: 'calendar', weekStart: 'monday' });
    expect(r.startKey).toBe('2026-02-02'); // Monday
    expect(r.endKey).toBe('2026-02-08'); // Sunday
    expect(r.dayKeys).toContain(wed);
  });

  it('calendar mode (Sunday start): Sun–Sat containing the anchor', () => {
    const r = weekRange(wed, { mode: 'calendar', weekStart: 'sunday' });
    expect(r.startKey).toBe('2026-02-01'); // Sunday
    expect(r.endKey).toBe('2026-02-07'); // Saturday
    expect(r.dayKeys).toContain(wed);
  });

  it('calendar mode: anchor on the start day stays at week start', () => {
    // 2026-02-02 is a Monday.
    const r = weekRange('2026-02-02', { mode: 'calendar', weekStart: 'monday' });
    expect(r.startKey).toBe('2026-02-02');
    expect(r.endKey).toBe('2026-02-08');
  });

  it('calendar mode crosses a month boundary correctly', () => {
    // 2026-03-01 is a Sunday; Monday-start week began the prior Feb 23.
    const r = weekRange('2026-03-01', { mode: 'calendar', weekStart: 'monday' });
    expect(r.startKey).toBe('2026-02-23');
    expect(r.endKey).toBe('2026-03-01');
  });
});
