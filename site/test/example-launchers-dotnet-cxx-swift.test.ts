import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Ports whose pages run as native programs with no shell launcher. A program
// starts and stops its own tmux server through the library.
const PORTS = ['csharp', 'fsharp', 'cxx', 'swift']

const docs = fileURLToPath(new URL('../src/content/docs/', import.meta.url))
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url))

const SCRIPT = /\b(?:run|run-mcp|check)\.sh\b/
const REMOVED_LAUNCHER = /\b(?:the|its|that|this|your)\s+launchers?\b|\blaunchers? (?:below|checks|owns|creates|starts|is)\b/i

/** Why `text` still relies on a shell launcher. MCP pages may name a shipped executable's launcher. */
export function launcherProblems(text: string, { mcp = false } = {}): string[] {
  const problems: string[] = []
  if (SCRIPT.test(text)) problems.push('names a launcher script')
  if (!mcp && REMOVED_LAUNCHER.test(text)) problems.push('mentions a launcher')
  return problems
}

describe('dotnet, cxx and swift examples without a shell launcher', () => {
  it('flags the launcher wording the pages used to carry', () => {
    expect(launcherProblems('$ sh run.sh dotnet run --project Connect.csproj')).toEqual(['names a launcher script'])
    expect(launcherProblems('The launcher below supplies a private socket.')).toEqual(['mentions a launcher'])
    expect(launcherProblems('Its launcher checks that the server remains running.')).toEqual(['mentions a launcher'])
    expect(launcherProblems('Use it from a launcher or another .NET application.')).toEqual([])
    expect(launcherProblems('When the endpoint is absent, the launcher creates it.', { mcp: true })).toEqual([])
    expect(launcherProblems('$ sh run-mcp.sh', { mcp: true })).toEqual(['names a launcher script'])
  })

  const pages = PORTS.flatMap((port) => globSync(`ports/${port}/**/*.{md,mdx}`, { cwd: docs }))

  it('finds the pages of every port', () => {
    for (const port of PORTS) expect(pages.some((page) => page.startsWith(`ports/${port}/`)), port).toBe(true)
  })

  it.each(pages)('%s starts no launcher', (page) => {
    const text = readFileSync(`${docs}${page}`, 'utf8')
    expect(launcherProblems(text, { mcp: page.includes('/mcp/') }), page).toEqual([])
  })

  type Recorded = { port: string, page: string, files: { name: string }[], shellRecipe: string[] }
  const recorded = globSync('*-examples.json', { cwd: fixtures })
    .filter((name) => name !== 'api-examples.json')
    .flatMap((name) => ((JSON.parse(readFileSync(`${fixtures}${name}`, 'utf8')).examples ?? []) as Recorded[])
      .filter((example) => PORTS.includes(example.port))
      .map((example) => ({ record: `${name}: ${example.port} ${example.page}`, example })))

  it('finds the recorded programs of these ports', () => {
    expect(recorded.length).toBeGreaterThan(0)
  })

  it.each(recorded)('$record records no launcher file or command', ({ example }) => {
    expect(example.files.filter((file) => file.name.endsWith('.sh')).map((file) => file.name)).toEqual([])
    expect(example.shellRecipe.filter((command) => SCRIPT.test(command))).toEqual([])
  })
})
