import { expect, it } from 'vitest'
import { demoConfig, demoUrl } from '../src/lib/sidebar-demo'

it('round trips a configuration without losing locale or preview context', () => {
  const base = new URL('https://libtmux.org/pr-42/ja/demo/sidebar/?version=latest')
  const config = demoConfig(new URLSearchParams('variant=grouped&language=kotlin&symbol=Session.Companion&viewport=phone&theme=light&width=330'))
  const url = demoUrl(base, config)
  expect(url.pathname).toBe('/pr-42/ja/demo/sidebar/')
  expect(url.searchParams.get('version')).toBe('latest')
  expect(demoConfig(url.searchParams)).toEqual(config)
})

it('defaults invalid controls and bounds the requested sidebar width', () => {
  expect(demoConfig(new URLSearchParams('variant=unknown&language=bad&viewport=bad&theme=bad&width=9999')))
    .toMatchObject({ variant: 'outline', language: 'csharp', viewport: 'desktop', theme: 'dark', width: 380 })
  expect(demoConfig(new URLSearchParams('width=nan')).width).toBe(296)
})
