/**
 * The page side of the boot splash that `splashPlugin` puts into index.html: change its message
 * while the app loads, then fade it out once the first view is ready.
 */

const splash = () => document.getElementById('app-splash');

/** Changes the line under the bricks. Does nothing once the splash is gone. */
export function setSplashMessage(message: string) {
  const label = splash()?.querySelector('[data-splash-message]');
  if (label && label.textContent !== message) label.textContent = message;
}

/** Fades the splash out and removes it. Safe to call more than once. */
export function dismissSplash() {
  const overlay = splash();
  if (!overlay || overlay.dataset.done !== undefined) return;
  overlay.dataset.done = '';
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
  // Fallback for when the transition never runs (reduced motion, hidden tab).
  setTimeout(() => overlay.remove(), 400);
}
