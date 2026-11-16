import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Ports whose pages show native programs that own their tmux server instead of
// a shell launcher.
const PORTS = ['ruby', 'lua']

const docs = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

const SCRIPT = /\b(?:run|run-mcp|check)\.sh\b/
const TEST_ONLY_VARIABLE = /LIBTMUX_TEST_TMUX/

/** Why `text` still relies on a shell launcher or a variable only the tests set. */
function launcherProblems(text: string, { mcp = false } = {}): string[] {
  const problems: string[] = []
  if (SCRIPT.test(text)) problems.push('names a launcher script')
  if (!mcp && /\blaunchers?\b/i.test(text)) problems.push('mentions a launcher')
  if (TEST_ONLY_VARIABLE.test(text)) problems.push('reads a variable only the repository tests set')
  return problems
}

describe('examples without a shell launcher', () => {
  it('flags the launcher wording the pages used to carry', () => {
    expect(launcherProblems('$ sh run.sh bundle exec ruby connect.rb')).toEqual(['names a launcher script'])
    expect(launcherProblems('The launcher below supplies a private socket.')).toEqual(['mentions a launcher'])
    expect(launcherProblems('tmux=get(ENV, "LIBTMUX_TEST_TMUX", "tmux")'))
      .toEqual(['reads a variable only the repository tests set'])
    expect(launcherProblems('Save the client launcher as run-mcp.rb.', { mcp: true })).toEqual([])
  })

  const pages = PORTS.flatMap((port) => globSync(`ports/${port}/**/*.{md,mdx}`, { cwd: docs }))

  it('finds the pages of every port', () => {
    for (const port of PORTS) expect(pages.some((page) => page.startsWith(`ports/${port}/`)), port).toBe(true)
  })

  it.each(pages)('%s starts no launcher and reads no test-only variable', (page) => {
    const text = readFileSync(`${docs}${page}`, 'utf8')
    expect(launcherProblems(text, { mcp: page.includes('/mcp/') }), page).toEqual([])
  })

  const recorded = globSync('*-examples.json', { cwd: fixtures })
    .filter((name) => name !== 'api-examples.json')
    .flatMap((name) => (JSON.parse(readFileSync(`${fixtures}${name}`, 'utf8')).examples ?? [])
      .filter((example: { port: string }) => PORTS.includes(example.port))
      .map((example: { port: string, page: string, files: { name: string }[], shellRecipe: string[] }) => ({
        record: `${name}: ${example.port} ${example.page}`, example,
      })))

  it.each(recorded)('$record records no launcher file or command', ({ example }) => {
    expect(example.files.filter((file) => file.name.endsWith('.sh')).map((file) => file.name)).toEqual([])
    expect(example.shellRecipe.filter((command) => SCRIPT.test(command))).toEqual([])
  })
})
