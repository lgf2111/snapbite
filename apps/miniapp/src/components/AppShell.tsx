import { Camera, Home, Settings as SettingsIcon } from 'lucide-react';
import type * as React from 'react';
import { cn } from '@/lib/utils';

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
        <div className="flex h-[var(--spacing-bar)] items-stretch justify-around px-2">
          <NavButton
            label="Home"
            icon={<Home className="size-5" aria-hidden />}
            active={active === 'home'}
            onClick={() => onNavigate('home')}
          />

          <div className="flex w-16 items-start justify-center">
            <button
              type="button"
              onClick={onCapture}
              disabled={captureBusy}
              aria-label="Log a meal photo"
              className={cn(
                'mt-1.5 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform',
                'active:scale-95 disabled:opacity-60',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
              )}
            >
              <Camera className="size-6" aria-hidden />
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
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
