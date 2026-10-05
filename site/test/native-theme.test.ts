import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'

const nativeScript = readFileSync(new URL('../public/_shell/shell.js', import.meta.url), 'utf8')
const astroSource = readFileSync(new URL('../src/components/ThemeScript.astro', import.meta.url), 'utf8')
const astroScript = /<script is:inline>([\s\S]*?)<\/script>/.exec(astroSource)![1]
const windows: Window[] = []
const keys = ['color-scheme', 'theme', 'libtmux-theme']

function page(storage: Record<string, string> = {}, system = 'light') {
  const window = new Window({
    url: 'https://libtmux.org/en/py/latest/api/libtmux.session/',
    settings: { device: { prefersColorScheme: system } },
  })
  windows.push(window)
  for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  window.matchMedia = () => media
  window.fetch = (async () => ({ ok: true, json: async () => ({ schema: 1, ports: {}, defaultVersion: {} }) })) as unknown as typeof window.fetch
  return { window, media }
}

function preferences(window: Window) {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = window.localStorage.getItem(key)
    return value === null ? [] : [[key, value]]
  }))
}

async function native(window: Window) {
  window.eval(nativeScript)
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'))
  await window.happyDOM.waitUntilComplete()
}

function astro(window: Window) {
  window.eval(astroScript)
}

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()))
})

describe('theme preference across Astro and native pages', () => {
  it.each(['light', 'dark', 'system'])('previews %s without changing the saved Astro preference', (preview) => {
    const { window } = page({ 'color-scheme': 'dark' }, 'light')
    window.document.documentElement.setAttribute('data-home-scheme-preview', preview)
    astro(window)
    expect(window.document.documentElement.getAttribute('data-theme-mode')).toBe(preview === 'system' ? 'light' : preview)
    expect(window.document.documentElement.getAttribute('data-color-scheme')).toBe('dark')
    expect(window.localStorage.getItem('color-scheme')).toBe('dark')
    window.document.documentElement.removeAttribute('data-home-scheme-preview')
    window.eval('applyTheme()')
    expect(window.document.documentElement.getAttribute('data-theme-mode')).toBe('dark')
  })

  it.each([
    ['', '', null],
    ['', 'ruby', 'ruby'],
    ['?port=lua', 'ruby', 'lua'],
    ['?port=unknown', 'ruby', 'ruby'],
    ['?port=unknown', 'missing', null],
  ])('resolves a homepage icon before paint: URL %s, saved %s', (query, saved, expected) => {
    const { window } = page(saved ? { 'libtmux-docs.package-install.port': saved } : {})
    window.location.href = `https://libtmux.org/en/${query}`
    window.document.documentElement.setAttribute('data-home-ports', 'py ruby lua')
    astro(window)
    expect(window.document.documentElement.getAttribute('data-home-selected-port')).toBe(expected)
  })

  it.each([
    ['dark', 'light', 'dark'], ['light', 'dark', 'light'],
    ['system', 'dark', 'dark'], ['system', 'light', 'light'],
  ])('carries Astro %s into a native page with a %s OS preference', async (choice, system, resolved) => {
    const first = page({ 'color-scheme': choice, theme: 'light', 'libtmux-theme': 'dark' }, system).window
    astro(first)
    expect(first.document.documentElement.getAttribute('data-theme-mode')).toBe(resolved)

    const second = page(preferences(first), system).window
    second.document.body.setAttribute('data-theme', 'light')
    await native(second)
    const nativeChoice = choice === 'system' ? 'auto' : choice
    expect(second.document.body.getAttribute('data-theme')).toBe(nativeChoice)
    expect(second.document.documentElement.getAttribute('data-theme')).toBe(choice === 'system' ? null : choice)
    expect(second.document.documentElement.getAttribute('data-theme-mode')).toBe(resolved)
    expect(second.document.documentElement.style.colorScheme).toBe(resolved)
    expect(preferences(second)).toEqual({ 'color-scheme': choice, theme: nativeChoice, 'libtmux-theme': nativeChoice })
  })

  it.each(['light', 'dark', 'auto'])('carries a native %s toggle back into Astro', async (choice) => {
    const first = page({ 'color-scheme': choice === 'light' ? 'dark' : 'light' }, 'dark').window
    await native(first)
    first.document.body.setAttribute('data-theme', choice)
    first.localStorage.setItem('theme', choice)
    await first.happyDOM.waitUntilComplete()

    const second = page(preferences(first), 'dark').window
    astro(second)
    const siteChoice = choice === 'auto' ? 'system' : choice
    expect(preferences(first)).toEqual({ 'color-scheme': siteChoice, theme: choice, 'libtmux-theme': choice })
    expect(second.document.documentElement.getAttribute('data-color-scheme')).toBe(siteChoice)
    expect(second.document.documentElement.getAttribute('data-theme-mode')).toBe(choice === 'auto' ? 'dark' : choice)
  })

  it.each([
    [{ theme: 'dark', 'libtmux-theme': 'light' }, 'dark'],
    [{ 'libtmux-theme': 'auto' }, 'system'],
  ] as const)('migrates a legacy native preference: %j', async (stored, choice) => {
    const { window } = page(stored)
    await native(window)
    expect(window.localStorage.getItem('color-scheme')).toBe(choice)
  })

  it('follows OS changes in auto mode and retains an explicit choice', async () => {
    const { window, media } = page({ 'color-scheme': 'system' })
    await native(window)
    window.happyDOM.settings.device.prefersColorScheme = 'dark'
    media.dispatchEvent(new window.Event('change'))
    expect(window.document.documentElement.getAttribute('data-theme-mode')).toBe('dark')
    expect(window.document.body.getAttribute('data-theme')).toBe('auto')

    window.document.body.setAttribute('data-theme', 'dark')
    await window.happyDOM.waitUntilComplete()
    window.happyDOM.settings.device.prefersColorScheme = 'light'
    media.dispatchEvent(new window.Event('change'))
    expect(window.document.documentElement.getAttribute('data-theme-mode')).toBe('dark')
  })

  it('applies an Astro choice from another tab to the native renderer', async () => {
    const { window } = page({ theme: 'light' })
    await native(window)
    window.localStorage.setItem('color-scheme', 'dark')
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'color-scheme', newValue: 'dark' }))
    await window.happyDOM.waitUntilComplete()
    expect(window.document.body.getAttribute('data-theme')).toBe('dark')
    expect(window.document.documentElement.getAttribute('data-theme-mode')).toBe('dark')
  })

  it('keeps the native toggle usable when storage is blocked', async () => {
    const { window } = page()
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked') } })
    await native(window)
    window.document.body.setAttribute('data-theme', 'dark')
    await window.happyDOM.waitUntilComplete()
    expect(window.document.documentElement.getAttribute('data-theme-mode')).toBe('dark')
    expect(window.document.documentElement.getAttribute('data-color-scheme')).toBe('dark')
  })
})
