import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Ports whose pages run as native programs with no shell launcher: a program
// starts and stops its own tmux server through the library, or attaches to the
// reader's server and leaves it running.
const PORTS = ['py', 'ruby', 'lua', 'powershell', 'julia', 'ts', 'rs', 'go', 'java', 'kotlin', 'scala', 'csharp', 'fsharp', 'cxx', 'swift', 'elixir']

const docs = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

const SCRIPT = /\b(?:run|run-mcp|check)\.sh\b/
const TEST_ONLY_VARIABLE = /\bLIBTMUX_TEST_TMUX\b/

/**
 * Why `text` still relies on a shell launcher or a variable only the
 * repository tests set. MCP and workspace pages may call a shipped
 * executable or a frozen session file a launcher; neither is a shell script.
 */
export function launcherProblems(text: string, { shipped = false } = {}): string[] {
  const problems: string[] = []
  if (SCRIPT.test(text)) problems.push('names a launcher script')
  if (!shipped && /\blaunchers?\b/i.test(text)) problems.push('mentions a launcher')
  if (TEST_ONLY_VARIABLE.test(text)) problems.push('reads a variable only the repository tests set')
  return problems
}

describe('examples without a shell launcher', () => {
  it('flags the launcher wording the pages used to carry', () => {
    expect(launcherProblems('$ sh run.sh go run .')).toEqual(['names a launcher script'])
    expect(launcherProblems('$ sh run-mcp.sh')).toEqual(['names a launcher script'])
    expect(launcherProblems('$ bash check.sh')).toEqual(['names a launcher script'])
    expect(launcherProblems('The launcher below supplies a private socket.')).toEqual(['mentions a launcher'])
    expect(launcherProblems('tmux=get(ENV, "LIBTMUX_TEST_TMUX", "tmux")')).toEqual(['reads a variable only the repository tests set'])
    expect(launcherProblems('The build writes a launcher at bin/libtmux-mcp.', { shipped: true })).toEqual([])
  })

  const pages = PORTS.flatMap((port) => globSync(`ports/${port}/**/*.{md,mdx}`, { cwd: docs }))

  it('finds the pages of every port', () => {
    for (const port of PORTS) expect(pages.some((page) => page.startsWith(`ports/${port}/`)), port).toBe(true)
  })

  it.each(pages)('%s starts no launcher', (page) => {
    const text = readFileSync(`${docs}${page}`, 'utf8')
    const shipped = page.includes('/mcp/') || page.includes('/workspace/')
    expect(launcherProblems(text, { shipped }), page).toEqual([])
  })

  interface Recorded { port: string, page: string, files?: { name: string }[], shellRecipe?: string[] }
  const recorded = globSync('*-examples.json', { cwd: fixtures })
    .filter((name) => name !== 'api-examples.json')
    .flatMap((name) => ((JSON.parse(readFileSync(`${fixtures}${name}`, 'utf8')).examples ?? []) as Recorded[])
      .filter((example) => PORTS.includes(example.port))
      .map((example) => ({ record: `${name}: ${example.port} ${example.page}`, example })))

  it.each(recorded)('$record records no launcher file or command', ({ example }) => {
    expect((example.files ?? []).filter((file) => file.name.endsWith('.sh')).map((file) => file.name)).toEqual([])
    expect((example.shellRecipe ?? []).filter((command) => SCRIPT.test(command))).toEqual([])
  })
})
