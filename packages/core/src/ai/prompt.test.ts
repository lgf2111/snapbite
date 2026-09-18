import { describe, expect, it } from 'vitest';
import { buildRevisePrompt, buildUserPrompt, REVISE_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompt.js';

describe('SYSTEM_PROMPT', () => {
  it('requires strict JSON and the per-100g nutrition basis', () => {
    expect(SYSTEM_PROMPT).toContain('PER 100 GRAMS');
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('json');
  });

  it('instructs the model to prefer a nutrition label, then barcode, then visual estimate', () => {
    expect(SYSTEM_PROMPT).toContain('NUTRITION LABEL');
    expect(SYSTEM_PROMPT).toContain('BARCODE');
    expect(SYSTEM_PROMPT).toContain('VISUAL ESTIMATE');
    // Label instruction must tell the model to use the exact values.
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('exact');
  });
});

describe('buildUserPrompt', () => {
  it('returns a base prompt with no hint', () => {
    expect(buildUserPrompt()).toContain('Analyze this meal photo');
  });
  it('appends a hint as data, not instructions', () => {
    const p = buildUserPrompt('leftover pizza');
    expect(p).toContain('leftover pizza');
    expect(p.toLowerCase()).toContain('hint');
  });
});

describe('buildRevisePrompt', () => {
  it('includes the current meal json and the instruction as data', () => {
    const p = buildRevisePrompt('{"foods":[]}', 'add a coke');
    expect(p).toContain('{"foods":[]}');
    expect(p).toContain('add a coke');
  });
});

describe('REVISE_SYSTEM_PROMPT', () => {
  it('tells the model to change only what the instruction asks', () => {
    expect(REVISE_SYSTEM_PROMPT.toLowerCase()).toContain('change only');
  });
});
