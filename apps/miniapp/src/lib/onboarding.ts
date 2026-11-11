/**
 * Whether the optional AI-key step has been dealt with on this device.
 *
 * The onboarding gate reopens whenever a profile exists but no key is connected,
 * which is right after a reload mid-setup — and wrong the moment someone chooses
 * "track meals manually", because that choice then never sticks and the key step
 * returns on every open. Recording the decision locally keeps the gate useful
 * without re-asking a question the user already answered.
 */
const KEY = 'snapbite.onboarding.keyDecision';

export type KeyDecision = 'skipped' | 'set';

export function markKeyDecision(decision: KeyDecision): void {
  try {
    localStorage.setItem(KEY, decision);
  } catch {
    // Private mode: the gate simply behaves as before.
  }
}

export function keyDecision(): KeyDecision | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === 'skipped' || raw === 'set' ? raw : null;
  } catch {
    return null;
  }
}
