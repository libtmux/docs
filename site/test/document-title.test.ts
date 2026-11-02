import { describe, expect, it } from 'vitest'
import {
  DESCRIPTION_BUDGET, documentationTitle, SITE_NAME, stripSiteSuffix, TITLE_BUDGET, type TitleSubject,
} from '../src/lib/branding'
import { PORTS, portHomeTitle } from '../src/lib/ports'

/**
 * Every kind of page the site publishes, with the tab it gets. The table is
 * the scheme: page name first, then language, product and kind, then the site.
 */
export const SCHEME: [string, TitleSubject, string][] = [
  ['site home', { title: 'libtmux: pilot tmux in your language', pagePath: '' }, 'libtmux: pilot tmux in your language'],
  ['language home', { title: 'libtmux-rs: Rust-based tmux client', pagePath: '', portSlug: 'rs' }, 'libtmux-rs: Rust-based tmux client'],
  ['core library page', { title: 'tmux client library for TypeScript', pagePath: 'core', portSlug: 'ts' }, 'tmux client library for TypeScript | libtmux.org'],
  ['guide', { title: 'Sending keys', pagePath: 'guides/sending-keys', portSlug: 'rs' }, 'Sending keys | Rust guide | libtmux.org'],
  ['guides index', { title: 'Guides', pagePath: 'guides', portSlug: 'java' }, 'Guides | Java docs | libtmux.org'],
  ['topic', { title: 'Errors and exceptions', pagePath: 'topics/errors-and-exceptions', portSlug: 'rs' }, 'Errors and exceptions | Rust topic | libtmux.org'],
  ['concept', { title: 'Control mode vs one-shot', pagePath: 'concepts/transports', portSlug: 'cxx' }, 'Control mode vs one-shot | C++ concept | libtmux.org'],
  ['example', { title: 'Attach and send keys', pagePath: 'examples/attach-and-send-keys', portSlug: 'go' }, 'Attach and send keys | Go example | libtmux.org'],
  ['core API reference page', { title: 'libtmux::Server', pagePath: 'reference/libtmux-server', portSlug: 'cxx' }, 'libtmux::Server | C++ API reference | libtmux.org'],
  ['core API reference index', { title: 'TypeScript API reference', pagePath: 'reference', portSlug: 'ts' }, 'TypeScript API reference | libtmux.org'],
  ['MCP home', { title: 'tmux MCP, built in TypeScript', pagePath: 'mcp', portSlug: 'ts' }, 'tmux MCP, built in TypeScript | libtmux.org'],
  ['MCP resource', { title: 'capabilities', pagePath: 'mcp/resources/capabilities', portSlug: 'ts' }, 'capabilities | TypeScript MCP resource | libtmux.org'],
  ['MCP tool', { title: 'kill_pane', pagePath: 'mcp/tools/kill_pane', portSlug: 'cxx' }, 'kill_pane | C++ MCP tool | libtmux.org'],
  ['MCP prompt', { title: 'run_and_wait', pagePath: 'mcp/prompts/run_and_wait', portSlug: 'py' }, 'run_and_wait | Python MCP prompt | libtmux.org'],
  ['MCP tools index', { title: 'TypeScript MCP Tools', pagePath: 'mcp/tools', portSlug: 'ts' }, 'TypeScript MCP Tools | libtmux.org'],
  ['MCP guide', { title: 'Run a command through MCP', pagePath: 'mcp/examples/run-command', portSlug: 'go' }, 'Run a command through MCP | Go MCP example | libtmux.org'],
  ['MCP API reference', { title: 'mcp.server.main', pagePath: 'mcp/reference/mcp-server-main', portSlug: 'ts' }, 'mcp.server.main | TypeScript MCP API reference | libtmux.org'],
  ['Workspace home', { title: 'TypeScript-based tmux workspace manager', pagePath: 'workspace', portSlug: 'ts' }, 'TypeScript-based tmux workspace manager | libtmux.org'],
  ['Workspace CLI', { title: 'Convert workspace files', pagePath: 'workspace/cli/convert', portSlug: 'ts' }, 'Convert workspace files | TypeScript Workspace CLI'],
  ['Workspace configuration', { title: 'Window configuration', pagePath: 'workspace/configuration/windows', portSlug: 'rs' }, 'Window configuration | Rust Workspace configuration'],
  ['Workspace guide', { title: 'Troubleshoot a workspace', pagePath: 'workspace/guides/troubleshooting', portSlug: 'ts' }, 'Troubleshoot a workspace | TypeScript Workspace guide'],
  ['Workspace API reference', { title: 'ownership.claimSession', pagePath: 'workspace/reference/ownership-claimsession', portSlug: 'ts' }, 'ownership.claimSession | TypeScript Workspace API reference'],
  ['Kotlin page in the Java tree', { title: 'Flow', pagePath: 'reference/libtmux-kotlin', portSlug: 'java' }, 'Flow | Kotlin API reference | libtmux.org'],
  ['native Python API page', { title: 'Servers', pagePath: 'api/libtmux.server', portSlug: 'py' }, 'Servers | Python API reference | libtmux.org'],
  ['tmux overview', { title: 'tmux', pagePath: 'tmux' }, 'tmux | libtmux.org'],
  ['tmux guide', { title: 'Sending keys', pagePath: 'tmux/guides/sending-keys' }, 'Sending keys | tmux guide | libtmux.org'],
  ['tmux manual command', { title: 'tmux capture-pane', pagePath: 'tmux/latest/manual/capture-pane' }, 'tmux capture-pane | tmux manual | libtmux.org'],
  ['tmux catalog format', { title: 'cursor_y', pagePath: 'tmux/latest/catalog/formats/cursor_y' }, 'cursor_y | tmux format | libtmux.org'],
  ['tmux C source', { title: 'input_ctx.request_timer', pagePath: 'tmux/latest/reference/c-struct-input_ctx-request_timer' }, 'input_ctx.request_timer | tmux C source | libtmux.org'],
  ['shared site page', { title: 'Support and release stages', pagePath: 'meta/support' }, 'Support and release stages | libtmux.org'],
]

describe('the document title scheme', () => {
  it.each(SCHEME)('titles a %s', (_name, subject, expected) => {
    expect(documentationTitle(subject).title).toBe(expected)
  })

  it('names the version of a page that is not the default, and not the default itself', () => {
    const guide = { title: 'Sending keys', pagePath: 'guides/sending-keys', portSlug: 'ts' }
    expect(documentationTitle({ ...guide, version: 'v0.2.0', defaultVersion: 'latest' }).title).toBe('Sending keys | TypeScript guide (v0.2.0) | libtmux.org')
    expect(documentationTitle({ ...guide, version: 'latest', defaultVersion: 'v0.2.0' }).title).toBe('Sending keys | TypeScript guide | libtmux.org')
    expect(documentationTitle({ ...guide, version: 'v0.2.0', defaultVersion: 'v0.2.0' }).title).toBe('Sending keys | TypeScript guide | libtmux.org')
    expect(documentationTitle({ title: 'tmux capture-pane', pagePath: 'tmux/3.5/manual/capture-pane' }).title).toBe('tmux capture-pane | tmux manual (3.5) | libtmux.org')
  })

  it('keeps the context and drops the site name before a title passes the budget', () => {
    const { title, social } = documentationTitle({ title: 'libtmux::mcp::CallContext::progress', pagePath: 'mcp/reference/x', portSlug: 'cxx' })
    expect(title).toBe('libtmux::mcp::CallContext::progress | C++ MCP API reference')
    expect(title.length).toBeLessThanOrEqual(TITLE_BUDGET)
    expect(social).toBe(title)
    const long = documentationTitle({ title: 'x'.repeat(TITLE_BUDGET), pagePath: 'guides/x', portSlug: 'rs' })
    expect(long.title).toBe(`${'x'.repeat(TITLE_BUDGET)} | Rust guide`)
  })

  it('shortens "API reference" to "API" when only that makes the title fit', () => {
    const name = 'LibTmux.Mcp.BoundedText.ToDisplayString'
    expect(documentationTitle({ title: name, pagePath: 'mcp/reference/x', portSlug: 'csharp' }).title).toBe(`${name} | C# MCP API`)
    expect(documentationTitle({ title: name, pagePath: 'mcp/reference/x', portSlug: 'csharp' }).social).toBe(`${name} | C# MCP API`)
    // A name no context can rescue keeps the whole of it.
    const long = 'LibTmux.Workspace.WorkspacePlanOptions.WorkspacePlanOptions'
    expect(documentationTitle({ title: long, pagePath: 'workspace/reference/x', portSlug: 'csharp' }).title).toBe(`${long} | C# Workspace API reference`)
  })

  it('gives the card the title without the site name that og:site_name already shows', () => {
    for (const [, subject] of SCHEME) {
      const { title, social } = documentationTitle(subject)
      expect([social, `${social} | ${SITE_NAME}`]).toContain(title)
    }
  })

  it('leaves every language home exactly as the home title sets it', () => {
    for (const port of PORTS) {
      expect(documentationTitle({ title: portHomeTitle(port), pagePath: '', portSlug: port.slug }).title).toBe(portHomeTitle(port))
    }
    expect(portHomeTitle(PORTS.find((port) => port.slug === 'rs')!)).toBe('libtmux-rs: Rust-based tmux client')
  })

  it('titles a page once, whatever suffix its generator already added', () => {
    expect(stripSiteSuffix('Server | libtmux-ts | libtmux.org')).toBe('Server')
    expect(stripSiteSuffix('Servers - libtmux 0.62.0 documentation')).toBe('Servers')
    expect(stripSiteSuffix('libtmux')).toBe('libtmux')
    const once = documentationTitle({ title: 'Sending keys', pagePath: 'guides/sending-keys', portSlug: 'rs' })
    const again = documentationTitle({ title: once.title, pagePath: 'guides/sending-keys', portSlug: 'rs' })
    expect([again.title, again.social]).toEqual([once.title, once.social])
  })

  it('tells apart pages that shared one title before', () => {
    const seen = new Map<string, string>()
    for (const [pagePath, port] of [['guides', 'java'], ['workspace/guides', 'java'], ['mcp/guides', 'java'], ['guides', 'ts']] as const) {
      const { title } = documentationTitle({ title: 'Guides', pagePath, portSlug: port })
      expect(seen.has(title), `${title} for ${pagePath}`).toBe(false)
      seen.set(title, pagePath)
    }
  })

  it('states its budgets', () => {
    expect(TITLE_BUDGET).toBe(60)
    expect(DESCRIPTION_BUDGET).toBe(160)
  })
})
