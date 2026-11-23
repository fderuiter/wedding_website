const GUEST_SESSION_CHANGED_EVENT = 'guest-session-changed';

export function notifyGuestSessionChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUEST_SESSION_CHANGED_EVENT));
}

export function subscribeGuestSessionChanged(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(GUEST_SESSION_CHANGED_EVENT, listener);
  return () => {
    window.removeEventListener(GUEST_SESSION_CHANGED_EVENT, listener);
  };
}
