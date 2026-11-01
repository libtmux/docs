import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAPABILITIES, capabilityCacheKey, capabilityFiles, MAX_PROGRAM_LINES, portCapabilities, programProblems, validateCapability, workflowStep,
  type CapabilityEntry, type CapabilityId, type CapabilityTable,
} from '../src/lib/core-capabilities'
import { checkoutFor } from '../src/plugins/remark-port-code.mjs'
import type { CachedSource } from '../src/lib/port-landing'
import { PORT_BY_SLUG } from '../src/lib/ports'
import TABLE from '../src/data/core-capabilities.json'
import SOURCES from '../src/data/example-sources.json'
import { readFileSync } from 'node:fs'

const table = TABLE as CapabilityTable
const cache = SOURCES as Record<string, CachedSource>
const entries = Object.entries(table).flatMap(([owner, items]) =>
  Object.entries(items).map(([id, entry]) => ({ owner, id: id as CapabilityId, entry: entry as CapabilityEntry })))
const model = (owner: string) => JSON.parse(readFileSync(new URL(`../src/data/api/${owner}.json`, import.meta.url), 'utf8')) as { revision: string, repo: string }
const ids = CAPABILITIES.map((capability) => capability.id as string)

describe('the capability showcase data', () => {
  it('names only known ports and capabilities', () => {
    for (const { owner, id } of entries) {
      expect(PORT_BY_SLUG[owner], owner).toBeDefined()
      expect(ids, id).toContain(id)
    }
  })

  it.each(entries.map((item) => [`${item.owner}/${item.id}`, item] as const))('%s records the evidence that its result is checked', (_name, { entry }) => {
    expect(validateCapability(entry)).toEqual([])
  })

  it('refuses an entry without that evidence', () => {
    const ok = table.rs!['send-keys']!
    expect(validateCapability(ok)).toEqual([])
    expect(validateCapability({ ...ok, checkedBy: [] })).toContain('records no evidence that the exit status or output is checked')
    expect(validateCapability({ ...ok, checkedBy: undefined })).toHaveLength(1)
    expect(validateCapability({ ...ok, checkedBy: [{ file: ok.file, contains: ' ' }] })).toContain('records evidence with no file or text')
    expect(validateCapability({ ...ok, ci: { workflow: 'ci.yml', command: '', job: '' } })).toEqual(['names no workflow', 'names no CI command', 'names no CI job'])
    expect(validateCapability({ ...ok, tmux: '3.8' })).toContain('writes the tmux version unlike 3.8+')
    expect(() => portCapabilities('rs', { rs: { 'send-keys': { ...ok, checkedBy: [] } } }, cache)).toThrow(/records no evidence/)
  })

  it.each(entries.map((item) => [`${item.owner}/${item.id}`, item] as const))('%s shows a whole program at the revision its API model records', (_name, { owner, entry }) => {
    const pinned = model(owner)
    for (const file of capabilityFiles(entry)) {
      const cached = cache[capabilityCacheKey(owner, file)]
      expect(cached, `${file} is in the example cache`).toBeDefined()
      expect(cached).toMatchObject({ repository: pinned.repo, revision: pinned.revision })
    }
    for (const item of entry.checkedBy) {
      expect(cache[capabilityCacheKey(owner, item.file)]!.content, `${item.file} holds the check`).toContain(item.contains)
    }
    // The page shows the file in full: imports, entry point and server setup, nothing defined elsewhere.
    expect(entry.from ?? entry.to ?? entry.more).toBeUndefined()
    expect(programProblems(entry.lang, cache[capabilityCacheKey(owner, entry.file)]!.content)).toEqual([])
  })

  it('shows each program in full, in the maintainer order', () => {
    const shown = portCapabilities('rs', table, cache)
    expect(shown.map((item) => item.id)).toEqual(ids.filter((id) => table.rs![id as CapabilityId]))
    for (const item of shown) {
      expect(item.code).toBe(cache[capabilityCacheKey('rs', item.file)]!.content.replace(/\n$/, ''))
      expect(item.sourceUrl).toContain(`/blob/${model('rs').revision}/${item.file}`)
      expect(item.code.split('\n').length).toBeLessThanOrEqual(MAX_PROGRAM_LINES)
    }
    // A port whose examples are library functions, not programs, offers none.
    expect(portCapabilities('ts', table, cache)).toEqual([])
    expect(portCapabilities('lua', table, cache)).toEqual([])
  })

  it('refuses an excerpt, and a file that is not a program', () => {
    const ok = table.rs!['send-keys']!
    expect(validateCapability({ ...ok, from: 'let panes' })).toContain('quotes an excerpt; a showcase entry is a whole program')
    expect(validateCapability({ ...ok, more: [] })).toContain('quotes an excerpt; a showcase entry is a whole program')
    const listings = cache[capabilityCacheKey('rs', 'crates/libtmux/examples/api_input.rs')]!.content
    // The body of the example without its imports and main: what a pasted excerpt would be.
    const body = listings.split('\n').slice(9, 36).join('\n')
    expect(programProblems('rust', body)).toEqual(['has no import lines', 'has no entry point'])
    expect(programProblems('rust', listings)).toEqual([])
    const quickstart = cache[capabilityCacheKey('ruby', 'examples/api/capture.rb')]!.content
    expect(programProblems('ruby', quickstart)).toEqual([])
    expect(programProblems('ruby', 'require_relative "support"\nExample.run("x") { }\n')).toEqual(['has no import lines', 'uses a helper of the repository'])
    expect(programProblems('go', 'package main\n\nfunc run() {}\n')).toEqual(['has no import lines', 'has no entry point'])
    expect(programProblems('typescript', 'export async function quickstart() {}\n')).toEqual(['has no import lines', 'has no entry point'])
    expect(programProblems('cobol', 'x')).toEqual(['has no completeness rule for cobol'])
    expect(programProblems('rust', `use a;\nfn main() {}\n${'x\n'.repeat(MAX_PROGRAM_LINES)}`)).toEqual([`runs past ${MAX_PROGRAM_LINES} lines`])
  })

  // A checkout that is not present cannot be asked; the run says it skipped.
  for (const { owner, id, entry } of entries) {
    const checkout = checkoutFor(owner, undefined) || ''
    const local = [checkout, `${process.env.HOME}/work/libtmux/libtmux-${owner}`].find((path) => existsSync(`${path}/.git`))
    it.skipIf(!local)(`${owner}/${id} runs in that workflow step at that revision`, () => {
      const workflow = execFileSync('git', ['-C', local!, 'show', `${model(owner).revision}:${entry.ci.workflow}`], { encoding: 'utf8', maxBuffer: 1 << 24 })
      expect(workflowStep(workflow, entry.ci), `${entry.ci.workflow} job ${entry.ci.job} step ${entry.ci.step ?? '(unnamed)'} runs ${entry.ci.command}`).toBe(true)
    })
  }
})

describe('the workflow step an entry records', () => {
  const workflow = `name: ci
jobs:
  gates:
    steps:
      - uses: actions/checkout@v4
      - name: Gate the MCP server
        working-directory: packages/mcp
        run: bun run typecheck && bun run test && bun run test:package
      - name: Gate the examples
        working-directory: examples
        run: bun run typecheck && bun run test
  other:
    steps:
      - name: Gate the examples
        working-directory: examples
        run: echo none
`
  const ci = { workflow: '.github/workflows/x.yml', job: 'gates', step: 'Gate the examples', directory: 'examples', command: 'bun run typecheck && bun run test' }
  it('finds the named step in its job with its directory and command', () => {
    expect(workflowStep(workflow, ci)).toBe(true)
  })
  it('fails when the step is removed, though another step runs the same command prefix', () => {
    expect(workflowStep(workflow.replace(/ {6}- name: Gate the examples\n {8}working-directory: examples\n {8}run: bun run typecheck && bun run test\n/, ''), ci)).toBe(false)
  })
  it.each([
    ['a step guarded by if', workflow.replace('        run: bun run typecheck && bun run test\n  other', "        if: github.ref == 'x'\n        run: bun run typecheck && bun run test\n  other")],
    ['a step that may fail', workflow.replace('        run: bun run typecheck && bun run test\n  other', '        continue-on-error: true\n        run: bun run typecheck && bun run test\n  other')],
    ['a command that only prefixes another', workflow.replace('        run: bun run typecheck && bun run test\n  other', '        run: bun run typecheck && bun run test:package\n  other')],
    ['a command whose failure is swallowed', workflow.replace('        run: bun run typecheck && bun run test\n  other', '        run: bun run typecheck && bun run test || true\n  other')],
    ['a command that runs only after another fails', workflow.replace('        run: bun run typecheck && bun run test\n  other', '        run: false || bun run typecheck && bun run test\n  other')],
    ['a command inside a string', workflow.replace('        run: bun run typecheck && bun run test\n  other', '        run: echo "bun run typecheck && bun run test"\n  other')],
  ])('refuses %s', (_name, changed) => {
    expect(workflowStep(changed, ci)).toBe(false)
  })
  it.each([
    ['another name', { ...ci, step: 'Gate the workspace' }],
    ['another directory', { ...ci, directory: 'packages/mcp' }],
    ['no directory', { ...ci, directory: undefined }],
    ['another job', { ...ci, job: 'other' }],
    ['a missing job', { ...ci, job: 'absent' }],
    ['another command', { ...ci, command: 'bun run build' }],
  ])('refuses %s', (_name, changed) => {
    expect(workflowStep(workflow, changed)).toBe(false)
  })
})

describe('the showcase component', () => {
  it('leads with the quickstart, then each program once, and renders nothing for a port with only the quickstart', async () => {
    const { Window } = await import('happy-dom')
    const { createComponent, renderTemplate } = await import('astro/runtime/server/index.js')
    const { loadAstroTemplate, renderAstroTemplate } = await import('./astro-templates')
    const Code = createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre data-code>${props.code}</pre>`)
    const template = await loadAstroTemplate('components/CoreShowcase.astro', {
      stubs: { 'components/HomeExample.astro': '---\nconst { port, heading } = Astro.props\n---\n<div data-home-example={port} data-heading={String(heading)} />' },
      modules: { 'astro-expressive-code/components': { Code } },
    })
    const render = async (port: string) => {
      const window = new Window()
      window.document.body.innerHTML = await renderAstroTemplate(template, {
        url: `https://libtmux.org/${port}/latest/`,
        props: { port },
      })
      return window.document as unknown as Document
    }
    const doc = await render('rs')
    const programs = portCapabilities('rs', table, cache).map((item) => item.id)
    const options = [...doc.querySelectorAll('[data-capability-option]')].map((a) => a.getAttribute('data-capability-option'))
    expect(options).toEqual(['typed-graph', ...programs])
    expect([...doc.querySelectorAll('[data-capability-panel]')].map((a) => a.getAttribute('data-capability-panel'))).toEqual(options)
    expect(doc.querySelector('[data-capability-panel="typed-graph"] [data-home-example]')!.getAttribute('data-heading')).toBe('false')
    expect(doc.querySelectorAll('[data-capability-panel][data-default]')).toHaveLength(1)
    expect(doc.querySelector('[data-capability-option]')!.getAttribute('href')).toBe('?capability=typed-graph')
    expect(doc.querySelector('input, label, [data-capability-search]'), 'no search box for a list this short').toBeNull()
    expect(doc.querySelectorAll('[data-capability-option]').length).toBeLessThanOrEqual(8)
    expect(doc.body.textContent).toContain('just check')
    expect(doc.body.textContent).toContain('The whole program')
    expect((await render('ts')).querySelector('[data-core-showcase]')).toBeNull()
  })
})
