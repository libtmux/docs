import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { SOURCES, TOPICS as MANIFEST_TOPICS } from '../../scripts/lib/workspace-showcase-sources.mjs'
import { PORT_BY_SLUG, productAvailable } from '../src/lib/ports'
import { renderLayout } from '../src/lib/tmux-layout'
import {
  paneCommands, portSupport, previewSize, previewWindows, revisionUrl, showcaseHeadings, showsTopic, supportedPorts, TMUXP, tmuxpExampleUrl, TOPICS,
  workspaceShowcase, type ShowcaseExample, type TopicId, type WorkspaceShowcase,
} from '../src/lib/workspace-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const data = JSON.parse(readFileSync(new URL('../src/data/workspace-showcase.json', import.meta.url), 'utf8')) as {
  tmuxp: { revision: string; examples: Record<string, string> }
  ports: Record<string, Pick<WorkspaceShowcase, 'repo' | 'revision' | 'support'> & { examples: ShowcaseExample[] }>
}
const model = (port: string) => JSON.parse(readFileSync(new URL(`../src/data/api/${port}.json`, import.meta.url), 'utf8')) as {
  sources: { product: string; repo: string; revision: string }[]
}
const entries = Object.entries(data.ports).flatMap(([port, block]) => block.examples.map((example) => ({ port, block, example })))
const parsed = (example: ShowcaseExample) => JSON.parse(example.json) as Record<string, unknown>

describe('the workspace showcase data source', () => {
  it('covers only ports that ship a workspace manager', () => {
    expect(Object.keys(data.ports).length).toBeGreaterThan(0)
    for (const port of Object.keys(data.ports)) {
      expect(productAvailable(PORT_BY_SLUG[port]!, 'workspace'), port).toBe(true)
      expect(model(port).sources.some((source) => source.product === 'workspace'), port).toBe(true)
    }
  })

  it('reads each port at the revision its API model records for the workspace package, or at the newer one its sources pin', () => {
    for (const [port, block] of Object.entries(data.ports)) {
      const source = model(port).sources.find((entry) => entry.product === 'workspace')!
      const pin = (SOURCES as Record<string, { revision?: string }>)[port]?.revision
      expect({ repo: block.repo, revision: block.revision }, port).toEqual({ repo: source.repo, revision: pin ?? source.revision })
      // A pin that equals the model's revision is not one: the generator refuses it, and so does this.
      if (pin) expect(pin, `${port} pin`).not.toBe(source.revision)
    }
  })

  it('pins TypeScript to the revision whose tests load tmuxp\'s examples, which the API model predates', () => {
    expect((SOURCES as Record<string, { revision?: string }>).ts!.revision).toBe('afd56d4dfa441b5bab9d9996ebd5b303fc5c4a3a')
    expect(data.ports.ts!.revision).toBe('afd56d4dfa441b5bab9d9996ebd5b303fc5c4a3a')
    expect(model('ts').sources.find((entry) => entry.product === 'workspace')!.revision).not.toBe(data.ports.ts!.revision)
  })

  it('describes exactly the sources the generator is told to read', () => {
    expect(Object.keys(data.ports).sort()).toEqual(Object.keys(SOURCES).sort())
    for (const [port, spec] of Object.entries(SOURCES)) {
      const topics = data.ports[port]!.examples.map((example) => example.topic)
      expect(topics, port).toEqual([...topics].sort((a, b) => MANIFEST_TOPICS.indexOf(a) - MANIFEST_TOPICS.indexOf(b)))
      const wanted = [...(spec.examples as { topic: string; source: { path: string } }[])]
        .sort((a, b) => MANIFEST_TOPICS.indexOf(a.topic) - MANIFEST_TOPICS.indexOf(b.topic))
      expect(data.ports[port]!.examples.map((example) => [example.topic, example.source.path]), port)
        .toEqual(wanted.map((example) => [example.topic, example.source.path]))
    }
  })

  it('names the test that loads each example, at a line that exists in a pinned file', () => {
    for (const { port, example } of entries) {
      expect(example.tests.length, `${port} ${example.topic}`).toBeGreaterThan(0)
      for (const test of example.tests) {
        expect(test.path, `${port} ${example.topic}`).not.toBe('')
        expect(test.name).not.toBe('')
        expect(test.line).toBeGreaterThan(0)
        expect(['cli', 'loader', 'builder', 'library', 'scheduled']).toContain(test.via)
        expect(test.checks.endsWith('.'), `${port} ${test.name}`).toBe(true)
      }
    }
  })

  it('keeps the bytes it read: the digest, a JSON that parses and one YAML text per example', () => {
    for (const { port, example } of entries) {
      expect(createHash('sha256').update(example.yaml).digest('hex'), `${port} ${example.topic}`).toBe(example.sha256)
      expect(typeof parsed(example)).toBe('object')
      expect(example.yaml.endsWith('\n')).toBe(false)
    }
  })

  it('shows what each topic claims, for the topic and every other it lists', () => {
    for (const { port, example } of entries) {
      for (const topic of [example.topic, ...example.also]) {
        expect(showsTopic(parsed(example), topic), `${port} ${example.topic} claims ${topic}`).toBe(true)
      }
    }
  })

  it('refuses a claim the document does not support', () => {
    const plain = { session_name: 'x', windows: [{ window_name: 'w', panes: ['echo a'] }] }
    for (const topic of TOPICS.map((entry) => entry.id)) expect(showsTopic(plain, topic), topic).toBe(topic === 'shorthand')
    expect(showsTopic({ windows: [{ layout: 'tiled', panes: [1, 2, 3, 4] }] }, 'four-pane')).toBe(true)
    expect(showsTopic({ windows: [{ layout: 'tiled', panes: [1, 2, 3] }] }, 'four-pane')).toBe(false)
  })

  it('tells the presets apart by what a document sets', () => {
    const windowOf = (panes: unknown[], more: Record<string, unknown> = {}) => ({ session_name: 'x', windows: [{ window_name: 'w', panes, ...more }] })
    const shows = (config: Record<string, unknown>, topic: TopicId) => showsTopic(config, topic)
    expect(shows(windowOf([{ shell_command: ['a', { cmd: 'b', enter: false }] }]), 'skip-send')).toBe(true)
    expect(shows(windowOf([{ shell_command: ['a', { cmd: 'b' }] }]), 'skip-send')).toBe(false)
    expect(shows(windowOf([{ shell_command: ['a'], enter: false }]), 'skip-send')).toBe(false)
    expect(shows(windowOf([{ shell_command: ['a'], enter: false }]), 'skip-send-pane-level')).toBe(true)
    expect(shows(windowOf([{ shell_command: [{ cmd: 'a', sleep_after: 2 }] }]), 'sleep')).toBe(true)
    expect(shows(windowOf([{ sleep_before: 2, shell_command: ['a'] }]), 'sleep')).toBe(false)
    expect(shows(windowOf([{ sleep_before: 2, shell_command: ['a'] }]), 'sleep-pane-level')).toBe(true)
    expect(shows({ shell_command_before: [{ cmd: 'source .venv/bin/activate', sleep_before: 1 }], windows: [] }, 'sleep-virtualenv')).toBe(true)
    expect(shows({ shell_command_before: ['cd ~'], windows: [] }, 'sleep-virtualenv')).toBe(false)
    expect(shows(windowOf(['a'], { options: { 'main-pane-height': '67%' } }), 'main-pane-height-percentage')).toBe(true)
    expect(shows(windowOf(['a'], { options: { 'main-pane-height': 30 } }), 'main-pane-height-percentage')).toBe(false)
    expect(shows({ windows: [{ panes: [null] }] }, 'minimal')).toBe(true)
    expect(shows(windowOf([null]), 'minimal')).toBe(false)
    expect(shows(windowOf([null, 'pane']), 'blank-panes')).toBe(true)
    expect(shows(windowOf(['echo']), 'blank-panes')).toBe(false)
    expect(shows(windowOf(['echo ${HOME}']), 'env-variables')).toBe(true)
    expect(shows(windowOf(['echo $HOME']), 'env-variables')).toBe(false)
  })

  it('has no entry for a port whose tests give no document it can quote', () => {
    for (const port of ['java', 'swift']) {
      expect(productAvailable(PORT_BY_SLUG[port]!, 'workspace')).toBe(true)
      expect(workspaceShowcase(port), port).toBeUndefined()
    }
  })

  it('lists the classics in the order the generator uses', () => {
    expect(TOPICS.map((topic) => topic.id)).toEqual(MANIFEST_TOPICS)
  })
})

/** The tmuxp examples a block shows that its own support table says the loader does not take. */
function shownButUnsupported(block: Pick<WorkspaceShowcase, 'support'> & { examples: ShowcaseExample[] }): string[] {
  return block.examples.flatMap((example) => (example.tmuxp && block.support.presets[example.tmuxp]?.supported === 'no' ? [example.tmuxp] : []))
}

describe('what each port supports of tmuxp\'s examples', () => {
  const names = Object.keys(TMUXP.examples)
  const blocks = Object.entries(data.ports)

  it('is recorded for every port that ships a workspace manager, shown or not', () => {
    expect(portSupport('not-a-port')).toBeUndefined()
    expect(supportedPorts().sort()).toEqual(Object.keys(SOURCES).sort())
    expect(supportedPorts().length).toBeGreaterThan(Object.keys(data.ports).filter((port) => data.ports[port]!.examples.length).length)
    for (const [port, block] of blocks) {
      expect(Object.keys(block.support.presets), port).toEqual(names)
      // The table a port shows is the committed one, and a port with nothing to show offers no showcase.
      expect(portSupport(port), port).toEqual(block.support)
      if (block.examples.length) expect(workspaceShowcase(port)?.support, port).toEqual(block.support)
      else expect(workspaceShowcase(port), port).toBeUndefined()
    }
  })

  it('says why a preset is refused or differs, with a line of the port\'s source', () => {
    for (const [port, block] of blocks) {
      for (const [name, row] of Object.entries(block.support.presets)) {
        expect(['yes', 'caveat', 'no'], `${port} ${name}`).toContain(row.supported)
        expect(['identical', 'other', 'library-only', 'missing'], `${port} ${name}`).toContain(row.tested)
        if (row.supported === 'yes') {
          expect(row.reason, `${port} ${name}`).toBeUndefined()
          continue
        }
        expect(row.reason, `${port} ${name}`).toMatch(/\.$/)
        if (row.supported === 'no') {
          expect(row.cite, `${port} ${name}`).toBeDefined()
          expect(row.cite!.path).not.toBe('')
          expect(row.cite!.find).not.toBe('')
          expect(row.cite!.line).toBeGreaterThan(0)
          if (row.cite!.from) expect(data.ports[row.cite!.from], `${port} ${name} cites ${row.cite!.from}`).toBeDefined()
        }
      }
    }
  })

  it('marks an example identical to tmuxp\'s only when its bytes are, and no other', () => {
    expect(data.tmuxp.revision).toBe(model('py').sources.find((source) => source.product === 'workspace')!.revision)
    expect(TMUXP).toEqual(data.tmuxp)
    expect(tmuxpExampleUrl('3-pane')).toBe(`https://github.com/tmux-python/tmuxp/blob/${data.tmuxp.revision}/examples/3-pane.yaml`)
    for (const { port, example } of entries) {
      if (example.tmuxp) expect(TMUXP.examples[example.tmuxp], `${port} ${example.topic}`).toBe(example.sha256)
      else expect(Object.values(TMUXP.examples), `${port} ${example.topic}`).not.toContain(example.sha256)
    }
  })

  it('shows a tmuxp example only on a port that supports it and tests it', () => {
    for (const [port, block] of blocks) {
      expect(shownButUnsupported(block), port).toEqual([])
      for (const [name, row] of Object.entries(block.support.presets)) {
        expect(row.tested === 'identical', `${port} ${name}`).toBe(block.examples.some((example) => example.tmuxp === name))
        if (row.tested === 'identical') expect(row.supported, `${port} ${name}`).not.toBe('no')
      }
    }
  })

  it('catches a port that shows a preset its loader refuses', () => {
    const ruby = data.ports.ruby!
    const shown = { ...ruby, examples: [{ ...data.ports.rs!.examples[0]!, tmuxp: 'plugin-system' }] }
    expect(ruby.support.presets['plugin-system']!.supported).toBe('no')
    expect(shownButUnsupported(shown)).toEqual(['plugin-system'])
  })

  it('records the ports whose tests load tmuxp\'s own files', () => {
    const identical = (port: string) => Object.entries(data.ports[port]!.support.presets).filter(([, row]) => row.tested === 'identical').map(([name]) => name)
    expect(identical('rs')).toEqual(names.filter((name) => name !== 'plugin-system'))
    expect(identical('powershell')).toEqual(['skip-send-pane-level', 'skip-send'])
    expect(identical('py')).toEqual(['blank-panes'])
    // TypeScript's test loads every one of tmuxp's examples but the plugin one, which it asserts is refused.
    expect(identical('ts')).toEqual(names.filter((name) => name !== 'plugin-system'))
    for (const port of ['java', 'go', 'cxx', 'csharp', 'ruby', 'julia', 'swift']) expect(identical(port), port).toEqual([])
    expect(Object.entries(data.ports.swift!.support.presets).filter(([, row]) => row.tested === 'library-only').map(([name]) => name))
      .toEqual(['2-pane-vertical', '3-pane', 'blank-panes', 'skip-send', 'sleep'])
  })

  it('names what each loader refuses', () => {
    const refused = (port: string) => Object.entries(data.ports[port]!.support.presets).filter(([, row]) => row.supported === 'no').map(([name]) => name)
    expect(refused('swift')).toEqual(['plugin-system', 'sleep-virtualenv', 'sleep'])
    expect(refused('cxx')).toEqual(['plugin-system'])
    expect(data.ports.ruby!.support.presets.minimal!.reason).toMatch(/window_name/)
    expect(data.ports.powershell!.support.presets['sleep']!.cite).toMatchObject({ from: 'csharp', find: '["cmd", "enter"]' })
    expect(refused('rs')).toEqual([])
  })

  it('shows TypeScript\'s examples as the files its CLI test loads, with the substitutions the test makes', () => {
    const ts = workspaceShowcase('ts')!
    expect(ts.examples.length).toBeGreaterThan(1)
    for (const example of ts.examples) {
      expect(example.tmuxp, example.topic).toBeDefined()
      expect(example.source.path, example.topic).toBe(`packages/workspace-cli/tests/fixtures/tmuxp-examples/${example.tmuxp}.yaml`)
      expect(example.tests.map((test) => [test.name, test.via]), example.topic).toEqual([['every tmuxp example workspace loads through the CLI', 'cli']])
    }
    const noted = ts.examples.filter((example) => example.note).map((example) => example.tmuxp)
    expect(noted.sort()).toEqual(['env-variables', 'options'])
    expect(ts.support.presets['plugin-system']).toMatchObject({ supported: 'caveat', tested: 'missing' })
    expect(ts.examples.some((example) => example.tmuxp === 'plugin-system')).toBe(false)
  })

  it('records the layout a port gives a window that names none, where it documents one', () => {
    for (const port of ['rs', 'go', 'ts']) expect(data.ports[port]!.support.defaultLayout, port).toMatchObject({ layout: 'tiled' })
    expect(data.ports.py!.support.defaultLayout).toBeUndefined()
    const rs = workspaceShowcase('rs')!
    const shorthand = parsed(rs.examples.find((example) => example.topic === 'shorthand')!)
    const stacked = previewWindows(shorthand, 'probe')[0]!
    const tiled = previewWindows(shorthand, 'probe', rs.support.defaultLayout!.layout)[0]!
    expect(stacked.defaulted).toBeUndefined()
    expect(tiled.defaulted).toBe('tiled')
    expect(tiled.svg).not.toBe(stacked.svg)
    expect(tiled.svg).toBe(renderLayout([["echo 'did you know'", "echo 'you can inline'"], ["echo 'single commands'"], ["echo 'for panes'"]], 'tiled', previewSize('tiled', 3), { id: 'probe-w0', label: 'Window 0, long form: 3 panes, tiled' }))
  })
})

describe('the pane drawing', () => {
  it('takes the commands a pane types from every spelling of a pane', () => {
    expect(paneCommands(null)).toEqual([])
    expect(paneCommands('echo a')).toEqual(['echo a'])
    expect(paneCommands('pane')).toEqual([])
    expect(paneCommands('blank')).toEqual([])
    expect(paneCommands(['one', 'two'])).toEqual(['one', 'two'])
    expect(paneCommands({ shell_command: 'cd /' })).toEqual(['cd /'])
    expect(paneCommands({ shell_command: ['cd /var/log', { cmd: 'ls -al', enter: false }] })).toEqual(['cd /var/log', 'ls -al'])
    expect(paneCommands({ shell_command_before: 'cd ~/', focus: true })).toEqual([])
  })

  it('draws the window the layout shows best, with its layout', () => {
    const rs = workspaceShowcase('rs')!
    const four = rs.examples.find((example) => example.topic === 'four-pane')!
    const windows = previewWindows(parsed(four), 'probe')
    expect(windows).toHaveLength(1)
    const preview = windows[0]!
    expect(preview).toMatchObject({ name: 'dev window', layout: 'tiled', panes: 4, index: 0 })
    expect(preview.svg.match(/class="pane"/g)).toHaveLength(4)
    expect(preview.svg).toContain('/var/log')
    expect(preview.svg).toContain('\\.</tspan>log')
    expect(preview.svg).not.toContain('cd ~/')
    expect(preview.svg).toBe(renderLayout(
      [['cd /var/log', 'ls -al | grep \\.log'], ['echo hello'], ['echo hello'], ['echo hello']], 'tiled', previewSize('tiled', 4), { id: 'probe-w0', label: 'Window 0, dev window: 4 panes, tiled' },
    ))
  })

  it('draws a window with no layout as the stack tmux makes of two splits', () => {
    const two = workspaceShowcase('rs')!.examples.find((example) => example.topic === 'two-pane')!
    const preview = previewWindows(parsed(two), 'probe')[0]!
    expect(preview.layout).toBeUndefined()
    expect(preview.svg).toContain(`class="divider" x1="0" y1="${previewSize('even-vertical', 2)[1] * 17 / 2}"`)
  })

  it('draws no window for a saved layout string, and none for a document without windows', () => {
    expect(previewWindows({ windows: [{ layout: '5e2d,80x24,0,0{40x24,0,0,0,39x24,41,0,1}', panes: ['a', 'b'] }] }, 'x')).toEqual([])
    expect(previewWindows({}, 'x')).toEqual([])
  })

  it('draws a window that lists no panes as the one empty pane tmux opens, under its real index', () => {
    const [empty, listed] = previewWindows({ windows: [{ shell_command_before: 'window' }, { window_name: 'second', panes: ['echo a', 'echo b'] }] }, 'x')
    expect(empty).toMatchObject({ index: 0, panes: 0, caption: 'no panes listed, so tmux opens one', label: 'Window 0: no panes listed, one empty pane, even-vertical' })
    expect(empty!.svg.match(/class="pane"/g)).toHaveLength(1)
    expect(empty!.svg).not.toMatch(/class="cmd"/)
    expect(listed).toMatchObject({ index: 1, name: 'second', panes: 2 })
    // A window with an index of its own keeps it, and the empty one takes the lowest free index.
    expect(previewWindows({ windows: [{ window_index: 0, panes: ['a'] }, { window_name: 'late' }] }, 'x').map((window) => [window.index, window.panes])).toEqual([[0, 1], [1, 0]])
  })

  it('shows every window of every example, so no tab is missing, including a window with no panes', () => {
    for (const { port, example } of entries) {
      const config = parsed(example) as { windows?: unknown[] }
      const drawn = previewWindows(config, `${port}-${example.topic}`)
      expect(drawn.length, `${port} ${example.topic}`).toBe((config.windows ?? []).filter((window) => window && typeof window === 'object').length)
      for (const window of drawn) expect(window.svg.startsWith('<svg'), `${port} ${example.topic} ${window.index}`).toBe(true)
    }
    const cxx = previewWindows(parsed(workspaceShowcase('cxx')!.examples.find((example) => example.topic === 'shorthand')!), 'cxx')
    expect(cxx.map((window) => [window.index, window.panes])).toEqual([[0, 0], [1, 4]])
  })

  it('names every drawing for a reader who cannot see it, with the window, its panes and its layout', () => {
    const [window] = previewWindows({ windows: [{ window_name: 'should be /var/', panes: ['echo a', 'echo b'] }] }, 'x', 'tiled')
    expect(window!.label).toBe('Window 0, should be /var/: 2 panes, tiled')
    expect(window!.svg).toContain('role="img" aria-label="Window 0, should be /var/: 2 panes, tiled"')
    expect(window!.svg).toContain('<title>Window 0, should be /var/: 2 panes, tiled</title>')
    expect(previewWindows({ windows: [{ panes: ['echo a'], layout: 'main-vertical' }] }, 'x')[0]!.label).toBe('Window 0: 1 pane, main-vertical')
  })
})

describe('the overview page', () => {
  const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')

  it('draws the showcase on the workspace overview, after the prose, and lists its headings', () => {
    expect(page).toContain('const workspaceExamples = isWorkspaceOverview && port ? workspaceShowcase(port) : undefined')
    expect(page).toContain('...(workspaceExamples ? workspaceHeadings(workspaceExamples) : []),')
    // A port with one preset renders no picker, so its table of contents lists no "Try a preset" either.
    expect(page).toContain("...(workspaceExamples && offersPicker(workspaceExamples) ? [{ depth: 2, slug: 'try-a-preset', text: 'Try a preset' }] : []),")
    expect(page.indexOf('<Content />')).toBeLessThan(page.indexOf('<WorkspaceShowcase showcase={workspaceExamples} />'))
    expect(page).toContain('!placeholderLocale && workspaceExamples && <WorkspaceShowcase')
  })
})

describe('a workspace overview with no tested files', () => {
  const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')

  it('keeps the old overview and says tested example files are coming', () => {
    expect(page).toMatch(/isWorkspaceOverview && !workspaceExamples && \(\s*<p[^>]*data-workspace-coming>Tested example workspace files for this port are coming\.<\/p>/)
    // The note is for the ports whose own tests hold no quotable file, and for no other.
    const empty = Object.entries(data.ports).filter(([, block]) => block.examples.length === 0).map(([port]) => port)
    expect(empty.length).toBeGreaterThan(0)
    for (const port of empty) expect(workspaceShowcase(port), port).toBeUndefined()
    for (const port of Object.keys(data.ports).filter((name) => !empty.includes(name))) expect(workspaceShowcase(port), port).toBeDefined()
  })
})

describe('the showcase section', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

  const component = loadAstroTemplate('components/workspace/WorkspaceShowcase.astro', {
    real: ['components/workspace/WorkspaceConfig.astro'],
    modules: {
      'astro-expressive-code/components': {
        Code: createComponent((_result: unknown, props: { code: string; lang: string }) => renderTemplate`<pre data-lang="${props.lang}">${props.code}</pre>`),
      },
    },
  })
  async function section(port: string) {
    const win = new Window({ url: 'https://libtmux.org/en/' })
    windows.push(win)
    win.document.body.innerHTML = await renderAstroTemplate(await component, { props: { showcase: workspaceShowcase(port) } })
    return win.document as unknown as Document
  }

  it('shows one article per example, in the order of the classics', async () => {
    const document = await section('rs')
    const showcase = workspaceShowcase('rs')!
    expect([...document.querySelectorAll('h3')].map((heading) => heading.textContent))
      .toEqual(showcase.examples.map((example) => TOPICS.find((topic) => topic.id === example.topic)!.title))
    expect(document.querySelector('h2')?.id).toBe('example-workspaces')
    // Every window of an example is drawn, so a reader without script sees the whole file.
    const drawn = showcase.examples.reduce((sum, example) => sum + previewWindows(parsed(example), 'probe', showcase.support.defaultLayout?.layout).length, 0)
    expect(document.querySelectorAll('svg.gp-tmux-layout').length).toBe(drawn)
    expect(drawn).toBeGreaterThan(showcase.examples.length)
  })

  it('gives every heading the table of contents lists an id on the page', async () => {
    for (const port of Object.keys(data.ports).filter((name) => workspaceShowcase(name))) {
      const document = await section(port)
      for (const heading of showcaseHeadings(workspaceShowcase(port)!)) {
        expect(document.getElementById(heading.slug)?.tagName, `${port} ${heading.slug}`).toBe(`H${heading.depth}`)
      }
    }
  })

  it('offers the YAML tested and the JSON converted from it, in one joined panel', async () => {
    const document = await section('rs')
    const first = document.querySelector('.ws-config')!
    expect([...first.querySelectorAll('input[type="radio"]')].map((input) => input.getAttribute('aria-label'))).toEqual(['YAML', 'JSON'])
    expect(first.querySelector('.ws-config__tabs')?.nextElementSibling).toBe(first.querySelector('.ws-config__panel--yaml'))
    expect(first.querySelector('.ws-config__panel--yaml pre')?.getAttribute('data-lang')).toBe('yaml')
    expect(first.querySelector('.ws-config__panel--yaml pre')?.textContent).toBe(workspaceShowcase('rs')!.examples[0]!.yaml)
    expect(first.querySelector('.ws-config__panel--json pre')?.getAttribute('data-lang')).toBe('json')
    expect(JSON.parse(first.querySelector('.ws-config__panel--json pre')!.textContent!)).toEqual(parsed(workspaceShowcase('rs')!.examples[0]!))
    expect(first.querySelector('.ws-config__note')?.textContent).toContain('Converted from the YAML')
  })

  it('links the source and each test at the revision it was read at', async () => {
    const document = await section('rs')
    const showcase = workspaceShowcase('rs')!
    const hrefs = [...document.querySelectorAll('.ws-source:not(.ws-same) a, .ws-tests a')].map((link) => link.getAttribute('href')!)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) expect(href.startsWith(`https://github.com/${showcase.repo}/blob/${showcase.revision}/`), href).toBe(true)
    const start = showcase.examples.find((example) => example.topic === 'start-directory')!
    expect(hrefs).toContain(revisionUrl(showcase, start.tests[0]!.path, start.tests[0]!.line))
    const article = [...document.querySelectorAll('.ws-example')].find((entry) => entry.querySelector('h3')?.id === 'example-start-directory')!
    for (const test of start.tests) expect(article.querySelector('.ws-tests')?.textContent).toContain(test.name)
  })

  it('says how each test reaches its file, and never claims the command ran when the library did', async () => {
    const lines = (document: Document) => [...document.querySelectorAll('.ws-tests li')].map((item) => item.textContent!.replace(/\s+/g, ' '))
    const py = lines(await section('py')).filter((line) => line.includes('test_load_workspace'))
    expect(py.length).toBeGreaterThan(0)
    for (const line of py) {
      expect(line).toContain('loaded by the library in a test; the command is not run')
      expect(line).not.toContain('a test runs the command')
    }
    expect(lines(await section('go'))[0]).toContain('a test runs the command')
    // The Rust parity script is a scheduled run, not a test that gates a pull request.
    const rs = lines(await section('rs'))
    expect(rs.filter((line) => line.includes('a scheduled parity run loads it')).length).toBeGreaterThan(0)
    expect(rs.filter((line) => line.includes('run_fixture')).every((line) => line.includes('a scheduled parity run loads it'))).toBe(true)
    // Every way the data reaches a file has words of its own, on the line of the test that does.
    const phrase = { cli: 'a test runs the command', loader: 'loaded by the library in a test', builder: 'built by the library in a test', library: 'parsed by the library in a test', scheduled: 'a scheduled parity run loads it' }
    for (const port of Object.keys(data.ports).filter((name) => workspaceShowcase(name))) {
      const document = await section(port)
      for (const example of workspaceShowcase(port)!.examples) {
        const article = [...document.querySelectorAll('.ws-example')].find((entry) => entry.querySelector('h3')?.id === `example-${example.topic}`)!
        const items = [...article.querySelectorAll('.ws-tests li')].map((item) => item.textContent!.replace(/\s+/g, ' '))
        expect(items, `${port} ${example.topic}`).toHaveLength(example.tests.length)
        example.tests.forEach((test, index) => {
          expect(items[index], `${port} ${example.topic} ${test.name}`).toContain(test.name)
          expect(items[index], `${port} ${example.topic} ${test.name}`).toContain(phrase[test.via])
        })
      }
    }
  })

  it('says which tmuxp example a file is, and links tmuxp at its pinned revision', async () => {
    const document = await section('rs')
    const same = [...document.querySelectorAll('.ws-same a')].map((link) => link.getAttribute('href'))
    expect(same).toEqual(workspaceShowcase('rs')!.examples.map((example) => tmuxpExampleUrl(example.tmuxp!)))
    expect((await section('py')).querySelectorAll('.ws-same')).toHaveLength(1)
  })

  it('tells a window with no layout from one the port tiles', async () => {
    const caption = (document: Document, id: string) => [...document.querySelectorAll('.ws-example')].find((article) => article.querySelector('h3')?.id === id)!
      .querySelector('.ws-win figcaption:not(.ws-win__name)')!.textContent
    const rs = await section('rs')
    expect(caption(rs, 'example-shorthand')).toBe('no layout set, so the port tiles the panes')
    expect(caption(rs, 'example-three-pane')).toBe('layout main-vertical')
    const py = await section('py')
    expect([...py.querySelectorAll('.ws-win figcaption')].every((node) => !node.textContent!.includes('tiles the panes'))).toBe(true)
  })

  it('links an "also shows" topic only when the port has a section for it', async () => {
    const document = await section('rs')
    const three = [...document.querySelectorAll('.ws-example')].find((article) => article.querySelector('h3')?.id === 'example-three-pane')!
    expect(three.querySelector('.ws-also')?.textContent).toBe('Also shows: setup before each pane')
    expect(three.querySelector('.ws-also a')).toBeNull()
    const main = [...(await section('rs')).querySelectorAll('.ws-example')].find((article) => article.querySelector('h3')?.id === 'example-main-horizontal')!
    expect(main.querySelector('.ws-also a')?.getAttribute('href')).toBe('#example-three-pane')
  })
})
