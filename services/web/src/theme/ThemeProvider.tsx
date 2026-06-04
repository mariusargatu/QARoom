import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

/** Light/dark mode. The default is dark (`:root`); `.light` flips the same semantic tokens. */
export type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  toggle: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * A thin theme provider that toggles ONLY the `.light` class on the document root and holds
 * NO styles of its own (ADR-0005). All visual values live in the semantic tokens; this just
 * flips which set is active.
 */
export function ThemeProvider({
  children,
  initial = 'dark',
}: {
  children: ReactNode
  initial?: Theme
}) {
  const [theme, setTheme] = useState<Theme>(initial)

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
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
