import { cn } from '@/lib/utils';
import { Camera, Home, Settings as SettingsIcon } from 'lucide-react';
import type * as React from 'react';

export type ShellTab = 'home' | 'settings';

interface Props {
  active: ShellTab;
  onNavigate: (tab: ShellTab) => void;
  onCapture: () => void;
  captureBusy?: boolean;
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
export function AppShell({ active, onNavigate, onCapture, captureBusy = false, children }: Props) {
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col bg-background">
      <main className="reserve-bar flex-1 px-4 pt-3">{children}</main>

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
              onClick={onCapture}
              disabled={captureBusy}
              aria-label="Log a meal"
              className={cn(
                'absolute -top-5 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl ring-4 ring-background transition-transform',
                'active:scale-95 disabled:opacity-60',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              )}
            >
              <Camera className="size-7" aria-hidden />
            </button>
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
        'flex min-w-16 flex-col items-center justify-center gap-1 rounded-md px-3 py-2 text-caption transition-colors',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        active ? 'text-primary-text' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
