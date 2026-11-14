import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ecConfig from '../ec.config.mjs'

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

/** Code sizes of the design (07-visual-foundations, 15-typesetting; records 0022 and 0032). */
describe('code size', () => {
  it('sets frame code at 13px with a 1.7 line height', () => {
    expect(ecConfig.styleOverrides).toMatchObject({ codeFontSize: '0.8125rem', codeLineHeight: '1.7' })
  })

  it('fits the home program between 12.5px and 14px, and sets the Run panel frames at 12.5px', () => {
    const home = source('components/HomeExample.astro')
    expect(home).toContain('clamp(.78125rem, calc((100cqi - 2rem) / (var(--home-code-columns) * .625)), .875rem)')
    expect(home).toMatch(/\.home-example-run :global\(\.expressive-code\) \{ --ec-codeFontSize: \.78125rem; \}/)
    expect(source('components/CoreShowcase.astro')).toContain('clamp(.78125rem, calc((100cqi - 2rem) / (var(--home-code-columns, 80) * .625)), .875rem)')
  })

  it('leaves no program or excerpt sized at 15px', () => {
    for (const path of ['components/HomeExample.astro', 'components/CoreShowcase.astro', 'components/PortLanding.astro']) {
      expect(source(path), path).not.toContain('.9375rem')
    }
  })

  it.each([
    ['components/widgets/package-install.css', /\.lm-pkg-install__code code \{[^}]*font-size: 0\.8125rem;[^}]*line-height: 1\.7;/],
    ['components/widgets/mcp-install.css', /\.lm-mcp-install__code code \{[^}]*font-size: 0\.8125rem;[^}]*line-height: 1\.7;/],
    ['components/widgets/AgentPrompt.astro', /\.lm-agent-prompt__code code \{[^}]*font-size: 0\.8125rem;[^}]*line-height: 1\.7;/],
  ])('sets the code of %s at 13px and 1.7', (path, pattern) => {
    expect(source(path)).toMatch(pattern)
  })
})
