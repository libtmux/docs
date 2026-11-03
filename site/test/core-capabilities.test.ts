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

  // The fixture is examples/api/capture.rb as libtmux/libtmux-ruby master held it
  // on 2026-11-02 (commit 20744401ee9f78a131592481e251c6a09ac8f5fa, git blob
  // f070fac137b166227b34a79e5b4b0de77cf5ee95, last changed by 2156612): the
  // require sits inside the begin block, after the docs:begin marker, so README
  // excerpts carry it. The fixture stays as it was when the cache moves on, so
  // the indented form keeps its own coverage.
  describe('a Ruby program that wraps its require in a begin block', () => {
    const wrapped = readFileSync(new URL('./fixtures/ruby-capture-begin-wrapped.rb', import.meta.url), 'utf8')

    it('keeps the shape the fixture exists to cover', () => {
      expect(wrapped).toMatch(/^begin\n {2}# docs:begin main\n {2}require "libtmux"$/m)
      expect(wrapped).not.toMatch(/^require /m)
    })

    it('counts the indented require as the program import', () => {
      expect(programProblems('ruby', wrapped)).toEqual([])
    })

    it('still reports a program with no require', () => {
      const without = wrapped.replace(/^ {2}require "libtmux"\n\n/m, '')
      expect(without).not.toBe(wrapped)
      expect(programProblems('ruby', without)).toEqual(['has no import lines'])
      expect(programProblems('ruby', 'begin\n  # require "libtmux"\n  Foo.run\nend\n')).toEqual(['has no import lines'])
    })

    it('keeps refusing a helper of the repository, indented or not', () => {
      const helper = wrapped.replace('require "libtmux"', 'require_relative "support"')
      expect(programProblems('ruby', helper)).toEqual(['has no import lines', 'uses a helper of the repository'])
      expect(programProblems('ruby', `${wrapped}\nExample.run("x") { }\n`)).toEqual(['uses a helper of the repository'])
    })

    it('still finds the entry point in the wrapped program', () => {
      expect(programProblems('ruby', 'begin\n  require "libtmux"\nend\n')).toEqual([])
      expect(programProblems('ruby', '  require "libtmux"\n')).toEqual(['has no entry point'])
    })
  })

  // A checkout that is not present cannot be asked; the run says it skipped.
  for (const { owner, id, entry } of entries) {
    const checkout = checkoutFor(owner, undefined) || ''
    const local = [checkout, `${process.env.HOME}/work/libtmux/libtmux-${owner}`].find((path) => existsSync(`${path}/.git`))
    it.skipIf(!local)(`${owner}/${id} runs in that workflow step at that revision`, () => {
      const workflow = execFileSync('git', ['-C', local!, 'show', `${model(owner).revision}:${entry.ci.workflow}`], { encoding: 'utf8', maxBuffer: 1 << 24 })
      expect(workflowStep(workflow, entry.ci), `${entry.ci.workflow} job ${entry.ci.job} step ${entry.ci.step ?? '(unnamed)'} runs ${entry.ci.command}`).toBe(true)
    })
    if (entry.ci.planOutput) {
      it.skipIf(!local)(`${owner}/${id} is not shown as run once its plan output is not recorded`, () => {
        const workflow = execFileSync('git', ['-C', local!, 'show', `${model(owner).revision}:${entry.ci.workflow}`], { encoding: 'utf8', maxBuffer: 1 << 24 })
        expect(workflowStep(workflow, { ...entry.ci, planOutput: undefined })).toBe(false)
      })
    }
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
  describe('a job that waits on its workflow\'s plan', () => {
    const planned = `name: ci
jobs:
  plan:
    runs-on: ubuntu-24.04
    outputs:
      run_cells: \${{ steps.plan.outputs.run_cells }}
      run_development: \${{ steps.plan.outputs.run_development }}
      scope: \${{ steps.plan.outputs.scope }}
    steps:
      - uses: actions/checkout@v4
      - name: Plan the run
        id: plan
        run: ruby scripts/ci-plan
  gate:
    if: github.ref == 'x'
    runs-on: ubuntu-24.04
    steps:
      - run: true
  lint:
    runs-on: ubuntu-24.04
    steps:
      - run: true
  cell:
    needs: plan
    if: needs.plan.outputs.run_cells == 'true'
    runs-on: ubuntu-24.04
    steps:
      - name: Run the complete cell
        run: >-
          bundle exec scripts/matrix
          --output build/matrix
`
    const cell = { workflow: '.github/workflows/x.yml', job: 'cell', step: 'Run the complete cell', planOutput: 'run_cells', command: 'bundle exec scripts/matrix --output build/matrix' }
    const gated = "    if: needs.plan.outputs.run_cells == 'true'\n"
    it('accepts the flag its plan job publishes', () => {
      expect(workflowStep(planned, cell)).toBe(true)
      expect(workflowStep(planned.replace('needs: plan', 'needs: [lint, plan]'), cell)).toBe(true)
      expect(workflowStep(planned.replace('    needs: plan\n', '    needs:\n      - lint\n      - plan\n'), cell)).toBe(true)
      expect(workflowStep(planned.replace('    needs: plan\n', '    needs:\n      - lint\n      # the plan decides\n      - plan # first\n'), cell)).toBe(true)
      expect(workflowStep(planned.replace("run_cells == 'true'", "run_cells == 'true' # the plan decides"), cell)).toBe(true)
      expect(workflowStep(planned.replace('id: plan', 'id: decide').replace('steps.plan.outputs.run_cells', 'steps.decide.outputs.run_cells'), cell)).toBe(true)
      expect(workflowStep(planned.replace('    runs-on: ubuntu-24.04\n    outputs:', '    runs-on: ubuntu-24.04\n    continue-on-error: false\n    outputs:'), cell)).toBe(true)
    })
    it.each([
      ['an event test', planned.replace(gated, "    if: github.event_name == 'workflow_dispatch'\n")],
      ['a flag the plan job does not declare', planned.replace(gated, "    if: needs.plan.outputs.run_other == 'true'\n")],
      ['a flag the entry does not name', planned.replace(gated, "    if: needs.plan.outputs.run_development == 'true'\n")],
      ['a condition with a comment that looks like a pass', planned.replace(gated, "    if: github.ref == 'x' # continue-on-error: false\n")],
      ['a flag compared with another value', planned.replace("run_cells == 'true'", "run_cells != 'true'")],
      ['a condition added to the flag', planned.replace("run_cells == 'true'", "run_cells == 'true' && github.ref == 'x'")],
      ['a plan the job does not need', planned.replace('    needs: plan\n', '')],
      ['another job in needs', planned.replace('needs: plan', 'needs: other')],
      ['a plan named only in a comment', planned.replace('needs: plan', 'needs: [other] # plan')],
      ['a plan named only in a block-list comment', planned.replace('    needs: plan\n', '    needs:\n      - other # plan\n')],
      ['a conditional job beside the plan', planned.replace('needs: plan', 'needs: [plan, gate]')],
      ['a conditional job beside the plan in a block list', planned.replace('    needs: plan\n', '    needs:\n      - plan\n      - gate\n')],
      ['a tolerated job beside the plan', planned.replace('needs: plan', 'needs: [plan, gate]').replace("    if: github.ref == 'x'\n", '    continue-on-error: true\n')],
      ['a job beside the plan that needs a conditional job', planned.replace('needs: plan', 'needs: [plan, lint]').replace('  lint:\n', '  lint:\n    needs: gate\n')],
      ['a job beside the plan that the workflow does not define', planned.replace('needs: plan', 'needs: [plan, absent]')],
      ['a job beside the plan that needs the job', planned.replace('needs: plan', 'needs: [plan, lint]').replace('  lint:\n', '  lint:\n    needs: cell\n')],
      ['a plan job that is itself conditional', planned.replace('  plan:\n', "  plan:\n    if: github.ref == 'x'\n")],
      ['a plan job whose condition carries a comment that looks like a pass', planned.replace('  plan:\n', "  plan:\n    if: github.ref == 'x' # continue-on-error: false\n")],
      ['a plan job that may fail', planned.replace('  plan:\n', '  plan:\n    continue-on-error: true\n')],
      ['a plan job that needs a conditional job', planned.replace('  plan:\n', '  plan:\n    needs: gate\n')],
      ['a plan job that needs an unconditional job', planned.replace('  plan:\n', '  plan:\n    needs: lint\n')],
      ['a plan job that is not in the workflow', planned.replace('  plan:\n', '  planner:\n')],
      ['a plan output that is hard-wired', planned.replace('run_cells: ${{ steps.plan.outputs.run_cells }}', "run_cells: 'false'")],
      ['a plan output that reads a missing step', planned.replace('run_cells: ${{ steps.plan.outputs.run_cells }}', 'run_cells: ${{ steps.absent.outputs.run_cells }}')],
      ['a plan output that reads another flag of the step', planned.replace('run_cells: ${{ steps.plan.outputs.run_cells }}', 'run_cells: ${{ steps.plan.outputs.scope }}')],
      ['a plan that does not declare outputs', planned.replace(/ {4}outputs:\n( {6}.*\n)+/, '')],
      ['a plan whose only step is skipped', planned.replace('      - uses: actions/checkout@v4\n', '').replace('        id: plan\n', "        id: plan\n        if: false\n")],
      ['a plan step that may fail', planned.replace('        id: plan\n', '        id: plan\n        continue-on-error: true\n')],
      ['a plan step with no id', planned.replace('        id: plan\n', '')],
      ['a job that may fail', planned.replace(gated, '    continue-on-error: true\n')],
      ['a job that may fail and waits on the plan', planned.replace(gated, `${gated}    continue-on-error: true\n`)],
    ])('still refuses %s', (_name, changed) => {
      expect(changed).not.toBe(planned)
      expect(workflowStep(changed, cell)).toBe(false)
    })
    it('accepts the plan only for an entry that names its flag', () => {
      expect(workflowStep(planned, { ...cell, planOutput: undefined })).toBe(false)
      expect(workflowStep(planned, { ...cell, planOutput: 'run_development' })).toBe(false)
      expect(workflowStep(planned.replaceAll('run_cells', 'run_development'), { ...cell, planOutput: 'run_development' })).toBe(true)
    })
    it('refuses a plan output name that is not a name', () => {
      const ok = table.ruby!['send-keys']!
      expect(ok.ci.planOutput).toBe('run_cells')
      expect(validateCapability(ok)).toEqual([])
      expect(validateCapability({ ...ok, ci: { ...ok.ci, planOutput: 'run_cells.*' } })).toEqual(['names a plan output that is not a workflow output name'])
      expect(workflowStep(planned, { ...cell, planOutput: '.*' })).toBe(false)
    })
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
        props: { port, links: [{ href: '/x/core/', label: 'Core Library documentation →' }, { href: '/x/examples/', label: 'More examples →' }] },
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
    // One APIs-used list per capability, each linking the reference and capped with a "+N more" link.
    const lists = [...doc.querySelectorAll('[data-apis-for]')]
    expect(lists.map((list) => list.getAttribute('data-apis-for'))).toEqual(options)
    for (const list of lists) {
      const hrefs = [...list.querySelectorAll('a')].map((a) => a.getAttribute('href'))
      expect(hrefs.length).toBeGreaterThan(1)
      expect(hrefs.every((href) => href!.startsWith('/rs/latest/reference/')), list.getAttribute('data-apis-for')!).toBe(true)
    }
    expect(lists[0]!.textContent).toContain('Server::new_session')
    expect(lists[0]!.textContent).toMatch(/\+2 more/)
    expect(doc.querySelector('.core-showcase__apis-title')!.textContent).toBe('APIs used')
    expect(doc.body.textContent).toContain('just check')
    expect(doc.body.textContent).toContain('The whole program')
    expect([...doc.querySelectorAll('.core-showcase__links a')].map((a) => a.textContent)).toEqual(['Core Library documentation →', 'More examples →'])
    expect((await render('ts')).querySelector('[data-core-showcase]')).toBeNull()
  })
})
