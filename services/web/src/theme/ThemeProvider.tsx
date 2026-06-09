import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

/** Light/dark mode. Warm light is the default (`:root`); `.dark` flips the same semantic tokens. */
export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const STORAGE_KEY = 'qaroom.theme'

/**
 * Resolve the starting theme: a previously-persisted choice wins; otherwise honour the OS
 * `prefers-color-scheme`; otherwise fall back to the caller's `initial`. SSR-safe — every `window`
 * access is guarded, and a thrown storage access (private mode, disabled cookies) degrades to
 * `initial` rather than crashing the app.
 */
function resolveInitialTheme(initial: Theme): Theme {
  if (typeof window === 'undefined') return initial
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    // ignore unavailable storage; fall through to the OS preference
  }
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return initial
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * A thin theme provider that toggles ONLY the `.dark` class on the document root and holds
 * NO styles of its own (ADR-0005). All visual values live in the semantic tokens; this just
 * flips which set is active. Warm light is the resting default.
 */
export function ThemeProvider({
  children,
  initial = 'light',
}: {
  children: ReactNode
  initial?: Theme
}) {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme(initial))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // persistence is best-effort; a write failure must not break theming
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
