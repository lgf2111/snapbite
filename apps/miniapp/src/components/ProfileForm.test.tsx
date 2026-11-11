import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileForm } from './ProfileForm.js';

afterEach(cleanup);

describe('ProfileForm segmented controls', () => {
  it('uses the shared sliding ToggleGroup for units and sex', () => {
    render(<ProfileForm initial={null} submitLabel="Go" onSubmit={vi.fn()} />);

    for (const name of ['Units', 'Sex']) {
      const group = screen.getByRole('radiogroup', { name });
      expect(group.querySelector('[data-slot="toggle-group-indicator"]')).toBeTruthy();
    }
    // Same component as Home: no hand-rolled twin left in the form.
    expect(document.querySelectorAll('[data-slot="toggle-group"]').length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
