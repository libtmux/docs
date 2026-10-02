import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseManual } from '../../scripts/gen-tmux-reference.mjs'
import { buildsTmuxReference, tmuxCommandsFor, tmuxGuidesFor, tmuxManualHtml, tmuxPageHeadings, tmuxReference, tmuxReferenceUrl } from '../src/lib/tmux-reference'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

describe('versioned tmux reference', () => {
  it('keeps version-specific commands and flags separate', () => {
    const old = tmuxReference('3.2a')
    const current = tmuxReference('latest')
    expect(old.commands).toHaveLength(87)
    expect(current.commands).toHaveLength(91)
    expect(current).toBe(tmuxReference('3.7c'))
    expect(old.commands.some((command) => command.name === 'new-pane')).toBe(false)
    expect(current.commands.some((command) => command.name === 'new-pane')).toBe(true)
    const capture = (version: string) => tmuxReference(version).commands.find((command) => command.name === 'capture-pane')!
    expect(capture('3.2a').usage.split(']')[0]).not.toContain('F')
    expect(capture('3.7c').usage.split(']')[0]).toContain('F')
    expect(() => tmuxReference('3.99')).toThrow('Unknown tmux reference version')
  })

  it('stays in the selected version and the root build', () => {
    expect(buildsTmuxReference({})).toBe(true)
    expect(buildsTmuxReference({ LIBTMUX_DOCS_PORT: 'go' })).toBe(false)
    expect(buildsTmuxReference({ LIBTMUX_DOCS_LOCALE: 'ja' })).toBe(false)
    const html = tmuxManualHtml(tmuxReference('latest').manual, 'latest')
    expect(html).toContain(`href="${tmuxReferenceUrl('latest', 'capture-pane')}"`)
    expect(html).not.toContain('/tmux/3.7c/')
  })

  it('links commands and retains upstream descriptions and license', () => {
    const commands = [{ name: 'capture-pane', alias: 'capturep', usage: '[-p]' }]
    const html = '<section class="Sh"><h1 id="PANES">Panes</h1><dl><dt><code class="Ic">capture-pane</code></dt><dd><div class="Bd">(alias: capturep)</div>Capture visible lines. See <a href="#FORMATS">formats</a> and <code class="Ic">capturep</code>.</dd></dl></section>'
    const result = parseManual(html, commands, '3.7c')
    expect(result.commands[0].summary).toBe('Capture visible lines.')
    expect(result.commands[0].html).not.toContain('(alias:')
    expect(result.commands[0].html).toContain('/tmux/3.7c/reference/manual/#FORMATS')
    expect(result.commands[0].html).toContain('/tmux/3.7c/reference/capture-pane/')
    const older = html.replace('(alias: capturep)</div>', '(alias: capturep</div>\n    ) ')
    expect(parseManual(older, commands, '3.2a').commands[0].summary).toBe('Capture visible lines.')
    expect(tmuxReference('latest').license).toContain('Permission to use, copy, modify, and distribute')
    expect(() => parseManual(html.replace('capture-pane</code>', 'unknown</code>'), commands, '3.7c')).toThrow('Command absent from the manual')
  })

  it('excludes the formatter build date and host from the pinned manual', () => {
    const manual = '<section class="Sh"><h1 id="DESCRIPTION">Description</h1><p>tmux usage.</p></section>'
    const first = `${manual}<table class="foot"><tr><td>October 1, 2026</td><td>Debian</td></tr></table>`
    const second = `${manual}<table class="foot"><tr><td>October 2, 2026</td><td>OpenBSD</td></tr></table>`
    expect(parseManual(first, [], '3.7c')).toEqual(parseManual(second, [], '3.7c'))
    expect(parseManual(first, [], '3.7c').manual).not.toContain('October')
  })

  it('links translated pages to the English reference inside the preview', async () => {
    vi.stubEnv('LIBTMUX_DOCS_ROOT', '/pr-42/ja')
    vi.stubEnv('LIBTMUX_DOCS_PORT_ROOT', '/pr-42/en')
    vi.resetModules()
    const { tmuxReferenceUrl: referenceUrl } = await import('../src/lib/tmux-reference')
    expect(referenceUrl('3.2a', 'capture-pane')).toBe('/pr-42/en/tmux/3.2a/reference/capture-pane/')
  })

  it('links verified API concepts without inferring behavior from similar names', () => {
    expect(tmuxCommandsFor('ts', 'pane.Pane.capture').map((command) => command.name)).toEqual(['capture-pane'])
    expect(tmuxCommandsFor('ts', 'server.Server.sessions').map((command) => command.name)).toEqual(['list-sessions'])
    expect(tmuxCommandsFor('ts', 'Unrelated.capture')).toEqual([])
    expect(tmuxCommandsFor('ts', 'server.Server.windows').map((command) => command.name)).toEqual(['list-windows'])
    expect(tmuxCommandsFor('ts', 'pane.Pane.split').map((command) => command.name)).toEqual(['split-window'])
  })

  it('exports the same command sections and related guides as the page', () => {
    expect(tmuxPageHeadings('latest', 'capture-pane').map((heading) => heading.slug))
      .toEqual(['syntax', 'behavior', 'guides', 'libraries'])
    expect(tmuxPageHeadings('latest', 'server-access').map((heading) => heading.slug))
      .toEqual(['syntax', 'behavior'])
    expect(tmuxGuidesFor('capture-pane').map((guide) => guide.href))
      .toEqual([tmuxReferenceUrl().replace('/tmux/latest/reference/', '/guides/capturing-output/')])
    expect(tmuxPageHeadings('3.2a', 'manual').some((heading) => heading.slug === 'COMMANDS')).toBe(true)
  })
})
