/** Who the server thinks this browser is (`GET /api/auth/me`). */
export interface Me {
  signedIn: boolean;
  via: string | null;
  /** How the session was opened; `'email'` only for historical sessions. */
  method?: 'google' | 'email' | null;
  email: string | null;
  userId: string | null;
}

/**
 * Ask the server who we are. Resolves null when it cannot be reached or answers
 * an error: callers fall back to the anonymous behaviour rather than guessing
 * that someone is signed in.
 */
export async function fetchMe(apiBase: string): Promise<Me | null> {
  try {
    const res = await fetch(`${apiBase}/api/auth/me`, { credentials: 'include' });
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
}

/* ---- the `?auth=` the sign-in redirect lands on ---- */

let taken: { value: string | null } | null = null;

/**
 * Read `?auth=…` from the landing URL once and remove it from the address bar,
 * so it is acted on (see `authNotice`) and not left behind to be re-read after
 * a refresh. Memoised: React StrictMode runs effects twice in development.
 */
export function takeAuthStatus(): string | null {
  if (taken) return taken.value;
  const url = new URL(window.location.href);
  const value = url.searchParams.get('auth');
  if (value !== null) {
    url.searchParams.delete('auth');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }
  taken = { value };
  return value;
}

/** Test seam. */
export function resetAuthStatus(): void {
  taken = null;
}

export interface AuthNotice {
  kind: 'success' | 'error';
  message: string;
}

/**
 * What to tell someone who has just come back from signing in. "ok" is only
 * believed once the server confirms the session; otherwise the cookie did not
 * stick, which is worth saying plainly.
 */
export function authNotice(status: string | null, me: Me | null): AuthNotice | null {
  switch (status) {
    case null:
      return null;
    case 'ok':
      return me?.signedIn
        ? { kind: 'success', message: `Signed in${me.email ? ` as ${me.email}` : ''}` }
        : {
            kind: 'error',
            message: 'We signed you in, but this browser did not keep the session. Try again.',
          };
    case 'state':
      return { kind: 'error', message: 'The sign-in was interrupted. Please try again.' };
    case 'unverified':
      return { kind: 'error', message: 'That email is not verified with the provider.' };
    case 'conflict':
      return { kind: 'error', message: 'That address already belongs to another account.' };
    default:
      return { kind: 'error', message: 'Sign-in did not complete. Please try again.' };
  }
}
