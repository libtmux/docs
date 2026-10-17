import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The optional-feature requirements stay on one page, in the contract's terms.
 *
 * Each optional feature states its own tmux requirement, the support states
 * use the five contract names, and port results are named, not counted.
 */
const PAGE = join(dirname(fileURLToPath(import.meta.url)), '../src/content/docs/guides/tmux-support.md')

export const STATES = ['Non-operative', 'Timing-sensitive', 'Operative with synchronization', 'Qualified', 'Unverified']
export const FEATURES: [string, RegExp][] = [
  ['control acquisition', /\| Library-managed control mode[^|]*\| tmux 3\.7 \|/],
  ['named buffer deletion and rename', /\| Named buffer deletion and rename[^|]*\| tmux 3\.4 \|/],
  ['run-shell captured stdout', /\| Captured standard output of `run-shell` \| Not 3\.3 or 3\.4 \|/],
  ['exact 3.7 break-pane', /\| `break-pane` \| Not exact 3\.7 \|/],
  ['exact 3.7 names', /\| Session and window names containing `:` or `\.` \| Not exact 3\.7 \|/],
  ['percentage splits', /\| Percentage splits \|[^|]*`-l N%`/],
  ['layout validation', /\| Layout strings \| tmux 3\.4 for unchecked input \|/],
]

/** A count of ports such as "5/8" or "five of eight" summarizes instead of naming. */
export function ratios(text: string): string[] {
  return text.match(/\b\d+\s*\/\s*\d+\b|\b(?:one|two|three|four|five|six|seven|eight|\d+)\s+of\s+(?:the\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ports)\b/gi) ?? []
}

describe('tmux support page', () => {
  const page = readFileSync(PAGE, 'utf8')

  it('detects a ratio', () => {
    expect(ratios('Qualified on 5/8 ports')).toEqual(['5/8'])
    expect(ratios('Five of eight ports pass')).toEqual(['Five of eight'])
    expect(ratios('Python needs 3.7 and Go needs 3.4')).toEqual([])
  })

  it.each(FEATURES)('states the requirement for %s', (_name, row) => {
    expect(page).toMatch(row)
  })

  it.each(STATES)('defines the %s state', (state) => {
    expect(page).toMatch(new RegExp(`^\\| ${state} \\|`, 'm'))
  })

  it('names port results instead of counting them', () => {
    expect(ratios(page)).toEqual([])
  })

  it('keeps every port in the port table', () => {
    for (const port of ['Python', 'tmuxp', 'Go', 'Rust', 'Java, Kotlin, Scala', 'C#, F#, PowerShell', 'C++, Swift, TypeScript, Ruby, Lua, Julia']) {
      expect(page).toContain(`| ${port}`)
    }
  })
})
