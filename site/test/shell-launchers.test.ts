import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Examples run as native code on the library. A shell launcher that starts
// the tmux server and cleans up after the program moves that work out of the
// program the reader copies, so no displayed file or command may be one.
// Add a port here when its pages drop their launchers.
const LAUNCHER_FREE_PORTS = ['java', 'kotlin', 'scala']

const LAUNCHER_FILE = /^(?:run|run-mcp|check)\.sh$/
const LAUNCHER_COMMAND = /(?:^|[\s&;|(])(?:sh|bash)\s+(?:\.\/)?(?:run|run-mcp|check)\.sh\b/

const root = fileURLToPath(new URL('../src/content/docs/ports/', import.meta.url))

/** Every launcher the Markdown shows: a file saved under a launcher name, or a command that runs one. */
function launchersIn(markdown: string): string[] {
  const found: string[] = []
  for (const match of markdown.matchAll(/^ {0,3}```(\S*)([^\n]*)\n([\s\S]*?)^ {0,3}```/gm)) {
    const title = /title="([^"]+)"/.exec(match[2])?.[1]
    if (title && LAUNCHER_FILE.test(title)) found.push(`file ${title}`)
    if (['console', 'sh', 'shell', 'bash'].includes(match[1])) {
      for (const line of match[3].split('\n')) {
        if (LAUNCHER_COMMAND.test(line)) found.push(`command ${line.trim()}`)
      }
    }
  }
  return found
}

function pagesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? pagesUnder(path) : entry.name.endsWith('.md') ? [path] : []
  })
}

describe('examples without a shell launcher', () => {
  it('detects a launcher file and a launcher command', () => {
    const page = [
      '```sh title="run.sh"', '#!/bin/sh', '```', '',
      '```console', '$ sh run.sh gradle run', '```', '',
      '```console', '$ gradle run', '```',
    ].join('\n')
    expect(launchersIn(page)).toEqual(['file run.sh', 'command $ sh run.sh gradle run'])
    expect(launchersIn('```sh title="run-mcp.sh"\nexec x\n```')).toEqual(['file run-mcp.sh'])
    expect(launchersIn('```console\n$ gradle run\n```')).toEqual([])
  })

  it.each(LAUNCHER_FREE_PORTS)('shows no launcher on a %s page', (port) => {
    const shown = pagesUnder(join(root, port)).flatMap((page) =>
      launchersIn(readFileSync(page, 'utf8')).map((launcher) => `${page.slice(root.length)}: ${launcher}`))
    expect(shown).toEqual([])
  })
})
