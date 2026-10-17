import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The guide explains optional features; it does not keep their facts.
 *
 * Which release a feature needs and what each port does are generated from
 * the ports' capability registries onto the capability pages. A table typed
 * into this guide would drift from them, so the guide links there instead.
 */
const PAGE = join(dirname(fileURLToPath(import.meta.url)), '../src/content/docs/guides/tmux-support.md')

/** Markdown table rows that state a tmux release, which only generated pages may hold. */
export function releaseRows(text: string): string[] {
  return text.split('\n').filter((line) => /^\|.*\b3\.\d+[a-z]?\b.*\|\s*$/.test(line))
}

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

  it('detects a hand-kept release row', () => {
    expect(releaseRows('| Named buffers | tmux 3.4 | refused |')).toHaveLength(1)
    expect(releaseRows('Named buffers need tmux 3.4.')).toEqual([])
  })

  it('keeps no table of release requirements', () => {
    expect(releaseRows(page)).toEqual([])
  })

  it('links to the generated capability map', () => {
    expect(page).toContain('(/reference/capabilities/)')
  })

  it('names port results instead of counting them', () => {
    expect(ratios(page)).toEqual([])
  })
})
