import { expect, it } from 'vitest'
import { demoConfig, demoUrl } from '../src/lib/sidebar-demo'
import { API_MODEL_PORTS } from '../src/lib/ports'

const languages = [...API_MODEL_PORTS.map((port) => port.slug), 'tmux']

it('offers every library port and the tmux CLI without changing their URL identities', () => {
  for (const language of languages) {
    expect(demoConfig(new URLSearchParams({ language }), languages).language).toBe(language)
  }
})

it('round trips a configuration without losing locale or preview context', () => {
  const base = new URL('https://libtmux.org/pr-42/ja/demo/sidebar/?version=latest')
  const config = demoConfig(new URLSearchParams('variant=grouped&language=kotlin&symbol=Session.Companion&viewport=phone&theme=light&width=330'), languages)
  const url = demoUrl(base, config)
  expect(url.pathname).toBe('/pr-42/ja/demo/sidebar/')
  expect(url.searchParams.get('version')).toBe('latest')
  expect(demoConfig(url.searchParams, languages)).toEqual(config)
})

it('defaults invalid controls and bounds the requested sidebar width', () => {
  expect(demoConfig(new URLSearchParams('variant=unknown&language=bad&viewport=bad&theme=bad&width=9999'), languages))
    .toMatchObject({ variant: 'outline', language: 'csharp', viewport: 'desktop', theme: 'dark', width: 380 })
  expect(demoConfig(new URLSearchParams('width=nan'), languages).width).toBe(296)
})
