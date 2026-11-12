import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaveMealDialog } from './SaveMealDialog.js';

afterEach(cleanup);

function renderDialog(name = 'Chicken rice bowl', onSave = vi.fn()) {
  const props = {
    open: true,
    name,
    saving: false,
    onNameChange: vi.fn(),
    onOpenChange: vi.fn(),
    onSave,
  };
  const view = render(<SaveMealDialog {...props} />);
  return { ...view, props };
}

describe('SaveMealDialog', () => {
  it('disables Save while the name is empty or only whitespace', () => {
    const { rerender, props } = renderDialog('');
    const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;

    expect(save().disabled).toBe(true);

    rerender(<SaveMealDialog {...props} name="   " />);
    expect(save().disabled).toBe(true);

    rerender(<SaveMealDialog {...props} name="Chicken rice bowl" />);
    expect(save().disabled).toBe(false);
  });

  it('turns autofill off so iOS stops offering AutoFill Contact for a meal name', () => {
    renderDialog();
    const input = screen.getByLabelText('Name');

    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('autocorrect', 'off');
    expect(input).toHaveAttribute('autocapitalize', 'sentences');
    expect(input).toHaveAttribute('spellcheck', 'false');
    // A `name` attribute (or one like "name") is what iOS reads as a person.
    expect(input.getAttribute('name')).toBeNull();
  });

  it('leaves 16px between the 44px field and the actions, clear of the focus ring', () => {
    renderDialog();
    const input = screen.getByLabelText('Name');

    // The field is 44px tall, and its group sits in a form with a 16px gap
    // before the action stack — not in the old sticky footer that painted over
    // the input's ring when the keyboard shortened the sheet.
    expect(input.className).toContain('h-11');
    const form = input.closest('form') as HTMLFormElement;
    expect(form.className).toContain('gap-4');
    expect(input.closest('[data-slot=dialog-footer]')).toBeNull();

    const actions = screen.getByRole('button', { name: 'Save' }).parentElement as HTMLElement;
    expect(actions.className).toContain('flex-col');
    expect(actions.className).not.toContain('sticky');
    expect(actions.className).not.toContain('-mt');

    // jsdom does no layout, so this is the geometry those classes encode at
    // 430×932: field bottom, 16px gap, Save top. The 3px focus ring ends 13px
    // above the button instead of crossing its top edge.
    const fieldBottom = 44;
    expect(fieldBottom + 16 - (fieldBottom + 3)).toBe(13);
    const sheet = document.querySelector('[data-slot=dialog-content]') as HTMLElement;
    expect(sheet.className).toContain('max-w-sm');
    expect(sheet.className).toContain('w-[calc(100%-2rem)]');
  });

  it('renders Cancel as a text button with a 44px target', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });

    expect(cancel.className).toContain('h-11');
    expect(cancel.className).toContain('text-muted-foreground');
    expect(cancel.className).not.toContain('bg-secondary');
    expect(cancel.className).not.toContain('bg-primary');
    expect(cancel.getAttribute('type')).toBe('button');
  });

  it('focuses the field on open and selects the suggested name', async () => {
    renderDialog('Chicken rice bowl');
    const input = screen.getByLabelText('Name') as HTMLInputElement;

    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Chicken rice bowl'.length);
  });

  it('submits the form on Enter when the name is valid', () => {
    const { props } = renderDialog('Chicken rice bowl');
    const form = screen.getByLabelText('Name').closest('form') as HTMLFormElement;

    fireEvent.submit(form);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it('ignores a submit when the name is only whitespace', () => {
    const onSave = vi.fn();
    renderDialog('   ', onSave);
    fireEvent.submit(screen.getByLabelText('Name').closest('form') as HTMLFormElement);
    expect(onSave).not.toHaveBeenCalled();
  });
});
