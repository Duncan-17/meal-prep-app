/**
 * "Add to home screen".
 *
 * Two different worlds, so two branches:
 *
 * - **Chromium** fires `beforeinstallprompt`, which can be captured and
 *   replayed from a button of our own.
 * - **iOS Safari fires nothing.** There is no API; installing is a manual
 *   Share → Add to Home Screen. So iOS gets instructions rather than a button
 *   that could never work.
 *
 * Dismissal is remembered in `localStorage`, which is the right storage for it:
 * per-device, per-browser, and worthless to back up.
 */

import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'mealprep.installDismissed';

/** The Chromium-only event, which TypeScript's DOM lib does not describe. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => readDismissed());

  useEffect(() => {
    function capture(event: Event) {
      // Stop the browser's own mini-infobar so ours is the only offer.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', () => setDeferred(null));
    return () => window.removeEventListener('beforeinstallprompt', capture);
  }, []);

  if (dismissed || isStandalone()) return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Private mode or blocked storage — the banner just returns next visit.
    }
  }

  if (deferred !== null) {
    return (
      <div className="notice install">
        <div>
          <p className="notice__title">Install Meal Prep</p>
          <p className="notice__body">Runs full screen and works offline.</p>
        </div>
        <div className="install__actions">
          <button type="button" className="btn" onClick={dismiss}>
            Not now
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              void deferred.prompt().finally(() => {
                setDeferred(null);
                dismiss();
              });
            }}
          >
            Install
          </button>
        </div>
      </div>
    );
  }

  if (isIos()) {
    return (
      <div className="notice install">
        <div>
          <p className="notice__title">Add to your home screen</p>
          <p className="notice__body">
            In Safari, tap Share then <strong>Add to Home Screen</strong>. It then runs full screen
            and works offline. (Safari offers no button for this — it has to be the menu.)
          </p>
        </div>
        <div className="install__actions">
          <button type="button" className="btn" onClick={dismiss}>
            Got it
          </button>
        </div>
      </div>
    );
  }

  return null;
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Already installed — no point offering. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS's own non-standard flag.
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
