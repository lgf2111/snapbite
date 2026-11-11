import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Me } from '../lib/account.js';
import { AccountCard } from './AccountCard.js';
import { Button } from './ui/button.js';

interface Props {
  onBack: () => void;
  /** The account behind this browser changed from anonymous to signed in. */
  onSignedIn: (me: Me) => void;
}

/**
 * The sign-in surface for people who already have an account, shown as a
 * full-screen layer over the (still mounted) onboarding panels rather than as a
 * dialog, so going back finds the welcome and anything typed exactly as left.
 * The sign-in methods themselves are the existing AccountCard.
 */
export function SignInScreen({ onBack, onSignedIn }: Props) {
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      data-testid="onboarding-signin"
      className="absolute inset-0 z-10 overflow-y-auto overscroll-contain bg-background pt-[env(safe-area-inset-top)] pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-4">
        <div className="flex items-center gap-1">
          <Button
            ref={back}
            variant="ghost"
            size="icon"
            aria-label="Back to welcome"
            onClick={onBack}
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Button>
          <h1 className="text-title">Sign in</h1>
        </div>
        <p className="text-muted-foreground text-caption">
          Sign in to bring your goals and meals onto this device.
        </p>
        <AccountCard onSignedIn={onSignedIn} />
      </div>
    </div>
  );
}
