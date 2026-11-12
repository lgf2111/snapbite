import { cn } from '@/lib/utils';
import { Camera, Home, Plus, Settings as SettingsIcon } from 'lucide-react';
import type * as React from 'react';

export type ShellTab = 'home' | 'settings';

interface Props {
  active: ShellTab;
  onNavigate: (tab: ShellTab) => void;
  /** The add-a-meal menu is open: the camera button shows its quiet × state. */
  menuOpen: boolean;
  onToggleMenu: () => void;
  /** The camera button; the menu grows out of it and returns focus to it. */
  captureRef: React.Ref<HTMLButtonElement>;
  /** A multi-photo upload is running ("Uploading 2 of 4"): shown under the button, which is disabled. */
  captureStatus?: string | null;
  children: React.ReactNode;
}

/**
 * The app chrome, owned in one place.
 *
 * Before this, the bottom bar was a Radix `TabsList` doubling as the router, and
 * screens that returned early (meal detail, onboarding) had no bar at all. The
 * shell sits above the route branches so the bar, the capture action, the
 * safe-area inset and the scroll reserve are properties of the app, not of a
 * screen. Capture is a sibling button, not a tab: it opens a sheet and owns no
 * panel.
 */
export function AppShell({
  active,
  onNavigate,
  menuOpen,
  onToggleMenu,
  captureRef,
  captureStatus = null,
  children,
}: Props) {
  return (
    <div className="pt-top mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <main className="reserve-bar flex-1 px-4 pt-5">{children}</main>

      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t border-border bg-background/95 backdrop-blur"
      >
        <div className="relative flex h-[var(--spacing-bar)] items-stretch justify-around px-2">
          <NavButton
            label="Home"
            icon={<Home className="size-5" aria-hidden />}
            active={active === 'home'}
            onClick={() => onNavigate('home')}
          />

          {/*
            The capture button is deliberately larger than the bar and breaks out
            of it: a control that is the same height as the chrome competes with
            navigation, one that overshoots it reads as the primary action. The
            negative top offset is calm on purpose — it clears the bar edge
            without touching the safe area or the last row of content.
          */}
          <div className="relative flex w-20 items-start justify-center">
            <button
              type="button"
              ref={captureRef}
              onClick={onToggleMenu}
              disabled={captureStatus != null}
              aria-label={
                menuOpen
                  ? 'Close add-meal menu'
                  : 'Add a meal — tap for options, hold and slide to choose'
              }
              aria-expanded={menuOpen}
              aria-haspopup="true"
              className={cn(
                'absolute -top-5 flex size-16 items-center justify-center rounded-full shadow-xl ring-4 ring-background transition-[transform,box-shadow,background-color,color] duration-[160ms] ease-[var(--ease-spring)] hover:shadow-2xl',
                'active:scale-90 motion-reduce:transition-none motion-reduce:active:scale-100',
                'disabled:pointer-events-none disabled:opacity-60',
                // Press-and-hold-and-slide lives on this button only: no page pan, text
                // selection or iOS callout from the long press.
                'touch-none select-none [-webkit-touch-callout:none]',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                // Open: a quiet ×, not a second loud button.
                menuOpen
                  ? 'bg-card text-foreground border border-border'
                  : 'bg-primary text-primary-foreground',
              )}
            >
              {/* The camera turns 45deg into a ×: the plus is the ×'s other half. */}
              <span
                className={cn(
                  'relative flex size-7 items-center justify-center transition-transform duration-200 ease-[var(--ease-spring)] motion-reduce:transition-none',
                  menuOpen && 'rotate-45 motion-reduce:rotate-0',
                )}
              >
                <Camera
                  className={cn(
                    'absolute size-7 transition-opacity duration-150 motion-reduce:transition-none',
                    menuOpen ? 'opacity-0' : 'opacity-100',
                  )}
                  aria-hidden
                />
                <Plus
                  className={cn(
                    'absolute size-7 transition-opacity duration-150 motion-reduce:transition-none',
                    menuOpen ? 'opacity-100 motion-reduce:rotate-45' : 'opacity-0',
                  )}
                  aria-hidden
                />
              </span>
            </button>
            {/* Under the button, in the bar's own space: honest about a running batch. */}
            {captureStatus != null && (
              <output className="text-muted-foreground text-caption absolute top-[calc(2.75rem+0.125rem)] left-1/2 -translate-x-1/2 whitespace-nowrap">
                {captureStatus}
              </output>
            )}
          </div>

          <NavButton
            label="Settings"
            icon={<SettingsIcon className="size-5" aria-hidden />}
            active={active === 'settings'}
            onClick={() => onNavigate('settings')}
          />
        </div>
      </nav>
    </div>
  );
}

function NavButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-20 flex-col items-center justify-center gap-1 rounded-control px-3 py-2 text-caption transition-[transform,color] duration-[140ms] ease-[var(--ease-out-quint)] active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        active ? 'text-primary-text' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
