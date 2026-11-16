import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('../src/content/docs/', import.meta.url).pathname

/** Every Markdown source under an `examples` folder of the docs content. */
function exampleSources(dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return exampleSources(path)
    return /(^|\/)examples\/[^/]+\.mdx?$/.test(path) ? [path] : []
  })
}

interface Heading { depth: number; text: string }

/** The ATX headings of a Markdown body, outside fenced code. */
function headings(markdown: string): Heading[] {
  const found: Heading[] = []
  let fence = ''
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (marker) fence = fence ? (marker[1]![0] === fence[0] ? '' : fence) : marker[1]!
    const heading = !fence && /^(#{1,6}) +(.+?) *#*$/.exec(line)
    if (heading) found.push({ depth: heading[1]!.length, text: heading[2]! })
  }
  return found
}

const NUMBERED = /^(\d+)\. /

/**
 * What is wrong with an example page's steps, if anything. Steps are parts of
 * one build-up, not sections: H3s under an H2 that groups them ("Steps", or
 * the phase of the build-up), numbered from one (record 0012, PageExample).
 */
function stepProblems(markdown: string): string[] {
  const problems: string[] = []
  let section = ''
  let next = 1
  for (const { depth, text } of headings(markdown)) {
    const step = NUMBERED.exec(text)
    if (depth <= 2) section = depth === 2 ? text : ''
    if (step && depth === 2) problems.push(`step "${text}" is an H2; make it an H3 under a grouping H2`)
    if (step && depth === 3) {
      if (!section) problems.push(`step "${text}" has no H2 above it to group it`)
      if (Number(step[1]) !== next) problems.push(`step "${text}" should be numbered ${next}`)
      next = Number(step[1]) + 1
    }
  }
  return problems
}

describe('example page steps', () => {
  const sources = exampleSources()

  it('finds the example pages', () => {
    expect(sources.length).toBeGreaterThan(40)
  })

  it.each(sources.map((path) => [relative(root, path), path] as const))('%s nests its numbered steps as H3s under an H2', (_name, path) => {
    expect(stepProblems(readFileSync(path, 'utf8'))).toEqual([])
  })

  it('names the pages that build up in steps', () => {
    const stepped = sources.filter((path) => headings(readFileSync(path, 'utf8')).some(({ depth, text }) => depth === 3 && NUMBERED.test(text)))
    expect(stepped.map((path) => relative(root, path)).sort()).toEqual([
      'examples/attach-and-send-keys.md',
      'examples/capture-pane-output.md',
      'examples/workspace-from-file.md',
      'ports/go/examples/attach-and-send-keys.md',
      'ports/go/examples/capture-pane-output.md',
    ])
  })

  describe('the check', () => {
    it('rejects a step that is an H2, a step with no H2 above it and a gap in the numbers', () => {
      expect(stepProblems('# T\n\n## 1. First\n')).toEqual(['step "1. First" is an H2; make it an H3 under a grouping H2'])
      expect(stepProblems('# T\n\n### 1. First\n')).toEqual(['step "1. First" has no H2 above it to group it'])
      expect(stepProblems('# T\n\n## Steps\n\n### 1. First\n\n### 3. Third\n')).toEqual(['step "3. Third" should be numbered 2'])
    })

    it('accepts a build-up and ignores headings inside code', () => {
      expect(stepProblems('# T\n\n## Steps\n\n### 1. First\n\n### 2. Second\n\n## Done\n')).toEqual([])
      expect(stepProblems('# T\n\n```md\n## 1. Not a heading\n```\n')).toEqual([])
    })
  })
})
