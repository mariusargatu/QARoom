/// <reference types="@vitest/browser/matchers" />
import { Component, type ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ThemeProvider, useTheme } from './ThemeProvider'

// ThemeProvider behaviour (ADR-0027). Browser env: it reads/writes localStorage and toggles the
// `.dark` class on documentElement. Tests seed localStorage so the initial theme is deterministic
// (a stored choice wins over the OS preference + the `initial` fallback), never relying on the
// headless browser's prefers-color-scheme.

function ThemeProbe() {
  const { theme, toggle } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" data-testid="toggle" onClick={toggle}>
        toggle
      </button>
    </div>
  )
}

test('toggle flips the theme, sets the .dark class, and persists the choice', async () => {
  localStorage.setItem('qaroom.theme', 'light')
  const screen = await render(
    <ThemeProvider initial="light">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('light')
  expect(document.documentElement.classList.contains('dark')).toBe(false)

  await screen.getByTestId('toggle').click()

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('dark')
  await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true))
  expect(localStorage.getItem('qaroom.theme')).toBe('dark')
})

test('a persisted theme choice wins over the initial fallback', async () => {
  localStorage.setItem('qaroom.theme', 'dark')
  const screen = await render(
    <ThemeProvider initial="light">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('dark')
})

// resolveInitialTheme's fallback ladder (ADR-0027): with NO stored choice the OS `prefers-color-scheme`
// decides, and only if that is absent does `initial` win. matchMedia is stubbed so the headless
// browser's real OS signal never leaks in; localStorage is forced to throw to prove the private-mode
// degrade path. afterEach undoes every stub so the suite's other tests see a pristine environment.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

test('with no stored choice, an OS dark preference resolves the initial theme to dark', async () => {
  localStorage.removeItem('qaroom.theme')
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  )
  const screen = await render(
    <ThemeProvider initial="light">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('dark')
})

test('with no stored choice and no OS dark preference, the initial fallback is used', async () => {
  localStorage.removeItem('qaroom.theme')
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  )
  const screen = await render(
    <ThemeProvider initial="light">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('light')
})

test('an unreadable localStorage degrades to the OS/initial preference instead of crashing', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('storage access blocked')
  })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  )
  const screen = await render(
    <ThemeProvider initial="dark">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('dark')
})

test('an absent matchMedia (no OS signal at all) resolves to the initial fallback', async () => {
  localStorage.removeItem('qaroom.theme')
  vi.stubGlobal('matchMedia', undefined)
  const screen = await render(
    <ThemeProvider initial="light">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('light')
})

test('a failing localStorage write still applies the theme without crashing', async () => {
  localStorage.setItem('qaroom.theme', 'light')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exceeded')
  })
  const screen = await render(
    <ThemeProvider initial="light">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('light')
  await screen.getByTestId('toggle').click()
  await expect.element(screen.getByTestId('theme')).toHaveTextContent('dark')
})

test('toggling from dark flips back to light (the other arm of the toggle)', async () => {
  localStorage.setItem('qaroom.theme', 'dark')
  const screen = await render(
    <ThemeProvider initial="dark">
      <ThemeProbe />
    </ThemeProvider>,
  )

  await expect.element(screen.getByTestId('theme')).toHaveTextContent('dark')
  await screen.getByTestId('toggle').click()
  await expect.element(screen.getByTestId('theme')).toHaveTextContent('light')
  await vi.waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(false))
})

// useTheme() outside a <ThemeProvider> is a programming error: the hook must throw a NAMED diagnostic
// rather than return null and crash later. A render error boundary captures the render-time throw.

class CaptureBoundary extends Component<
  { onError: (error: Error) => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override componentDidCatch(error: Error) {
    this.props.onError(error)
  }
  override render() {
    return this.state.failed ? <span data-testid="caught">caught</span> : this.props.children
  }
}

test('useTheme() outside a ThemeProvider throws a named diagnostic', async () => {
  let captured: Error | undefined
  const screen = await render(
    <CaptureBoundary
      onError={(error) => {
        captured = error
      }}
    >
      <ThemeProbe />
    </CaptureBoundary>,
  )

  await expect.element(screen.getByTestId('caught')).toBeVisible()
  expect(captured?.message).toBe('useTheme must be used within a ThemeProvider')
})
