import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { type PushState, disablePush, enablePush, pushState, sendTestPush } from '../lib/push.js';
import { Button } from './ui/button.js';

/** One line of truth per state: what is going on, and what (if anything) to do. */
const STATE_COPY: Record<PushState, string> = {
  'needs-install': 'Add SnapBite to your Home Screen first, then turn reminders on here.',
  unsupported: 'This browser can’t show notifications.',
  default: 'Off. Turn it on to get a notification at your reminder times.',
  denied:
    'Notifications are blocked for SnapBite. Allow them in your phone’s Settings, then come back here.',
  granted: 'Notifications are allowed, but this phone isn’t signed up yet. Turn it on to finish.',
  subscribed: 'On for this phone.',
};

/**
 * "Reminders on this phone": the switch that subscribes this device to web push,
 * with an honest line for whatever state it is in. Lives inside the Meal
 * reminders card; the times and slots there are what it delivers.
 */
export function PushReminders() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => setState(await pushState()), []);
  useEffect(() => {
    void refresh();
    // Coming back from the phone's Settings after allowing notifications.
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      // Straight from the tap: iOS only shows the permission prompt for a gesture.
      setState(on ? await enablePush() : await disablePush());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not change reminders on this phone');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const { delivered } = await sendTestPush();
      toast.success(
        delivered > 0
          ? 'Sent. It should arrive in a moment.'
          : 'The phone did not accept it. Try turning reminders off and on.',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send the test notification');
    } finally {
      setBusy(false);
    }
  }

  const canToggle = state === 'default' || state === 'granted' || state === 'subscribed';

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <p className="text-muted-foreground text-caption">
        Reminders arrive as notifications from SnapBite, not from Telegram. On iPhone they only work
        once the app is on your Home Screen.
      </p>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="push-reminders" className="font-medium">
          Reminders on this phone
        </Label>
        <Switch
          id="push-reminders"
          checked={state === 'subscribed'}
          disabled={!canToggle || busy}
          onCheckedChange={(on) => void toggle(on)}
        />
      </div>

      {state && (
        <p className="text-caption" data-testid="push-state">
          {STATE_COPY[state]}
        </p>
      )}

      {state === 'subscribed' && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={() => void test()}
        >
          Send a test notification
        </Button>
      )}

      <p className="text-muted-foreground text-caption">
        Not guaranteed: iOS can drop reminders if the app was force-quit or Low Power Mode is on.
      </p>
    </div>
  );
}
