const KEY = 'thirdeye.token'

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

export function getToken(): string | null {
  return safe(() => localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY), null)
}

/** "Remember me" keeps the token across browser restarts (localStorage); otherwise it lasts for the tab session. */
export function setToken(token: string, remember: boolean): void {
  clearToken()
  safe(() => (remember ? localStorage : sessionStorage).setItem(KEY, token), undefined)
}

export function clearToken(): void {
  safe(() => localStorage.removeItem(KEY), undefined)
  safe(() => sessionStorage.removeItem(KEY), undefined)
}
