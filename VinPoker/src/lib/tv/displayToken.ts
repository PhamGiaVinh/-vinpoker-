// Device-local display identity (contract: docs/agent-handoffs/tv-display-pairing.md).
// try/catch everywhere — kiosk browsers in private mode may block storage.

const TOKEN_KEY = "vinpoker.tv.token";

export function getStoredDisplayToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeDisplayToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — direct /display/:token links still work */
  }
}

export function clearDisplayToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
