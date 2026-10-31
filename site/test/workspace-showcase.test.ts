import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { SOURCES, TOPICS as MANIFEST_TOPICS } from '../../scripts/lib/workspace-showcase-sources.mjs'
import { PORT_BY_SLUG, productAvailable } from '../src/lib/ports'
import { renderLayout } from '../src/lib/tmux-layout'
import {
  paneCommands, previewLayout, previewSize, revisionUrl, showcaseHeadings, showsTopic, TOPICS, workspaceShowcase,
  type ShowcaseExample,
} from '../src/lib/workspace-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const data = JSON.parse(readFileSync(new URL('../src/data/workspace-showcase.json', import.meta.url), 'utf8')) as {
  ports: Record<string, { repo: string; revision: string; examples: ShowcaseExample[] }>
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

  it('reads each port at the revision its API model records for the workspace package', () => {
    for (const [port, block] of Object.entries(data.ports)) {
      const source = model(port).sources.find((entry) => entry.product === 'workspace')!
      expect({ repo: block.repo, revision: block.revision }, port).toEqual({ repo: source.repo, revision: source.revision })
    }
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
        expect(['cli', 'loader', 'builder', 'library']).toContain(test.via)
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

  it('has no entry for a port whose tests give no document it can quote', () => {
    for (const port of ['ts', 'java', 'swift']) {
      expect(productAvailable(PORT_BY_SLUG[port]!, 'workspace')).toBe(true)
      expect(workspaceShowcase(port), port).toBeUndefined()
    }
  })

  it('lists the classics in the order the generator uses', () => {
    expect(TOPICS.map((topic) => topic.id)).toEqual(MANIFEST_TOPICS)
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
    const preview = previewLayout(parsed(four), 'probe')!
    expect(preview).toMatchObject({ window: 'dev window', layout: 'tiled', windows: 1, panes: 4 })
    expect(preview.svg.match(/class="pane"/g)).toHaveLength(4)
    expect(preview.svg).toContain('/var/log')
    expect(preview.svg).toContain('\\.</tspan>log')
    expect(preview.svg).not.toContain('cd ~/')
    expect(preview.svg).toBe(renderLayout(
      [['cd /var/log', 'ls -al | grep \\.log'], ['echo hello'], ['echo hello'], ['echo hello']], 'tiled', previewSize('tiled', 4), { id: 'probe' },
    ))
  })

  it('draws a window with no layout as the stack tmux makes of two splits', () => {
    const two = workspaceShowcase('rs')!.examples.find((example) => example.topic === 'two-pane')!
    const preview = previewLayout(parsed(two), 'probe')!
    expect(preview.layout).toBeUndefined()
    expect(preview.svg).toContain(`class="divider" x1="0" y1="${previewSize('even-vertical', 2)[1] * 17 / 2}"`)
  })

  it('draws no window for a saved layout string, and none for a document without panes', () => {
    expect(previewLayout({ windows: [{ layout: '5e2d,80x24,0,0{40x24,0,0,0,39x24,41,0,1}', panes: ['a', 'b'] }] }, 'x')).toBeUndefined()
    expect(previewLayout({ windows: [{ window_name: 'empty' }] }, 'x')).toBeUndefined()
    expect(previewLayout({}, 'x')).toBeUndefined()
  })

  it('draws every example whose layout tmux names', () => {
    for (const { port, example } of entries) {
      const preview = previewLayout(parsed(example), `${port}-${example.topic}`)
      expect(preview?.svg.startsWith('<svg'), `${port} ${example.topic}`).toBe(true)
    }
  })
})

describe('the overview page', () => {
  const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')

  it('draws the showcase on the workspace overview, after the prose, and lists its headings', () => {
    expect(page).toContain('const workspaceExamples = isWorkspaceOverview && port ? workspaceShowcase(port) : undefined')
    expect(page).toContain('...(workspaceExamples ? workspaceHeadings(workspaceExamples) : []),')
    expect(page.indexOf('<Content />')).toBeLessThan(page.indexOf('<WorkspaceShowcase showcase={workspaceExamples} />'))
    expect(page).toContain('!placeholderLocale && workspaceExamples && <WorkspaceShowcase')
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
    expect(document.querySelectorAll('svg.gp-tmux-layout').length).toBe(showcase.examples.length)
  })

  it('gives every heading the table of contents lists an id on the page', async () => {
    for (const port of Object.keys(data.ports)) {
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
    expect(first.querySelector('.ws-config__panel--yaml pre')?.getAttribute('data-lang')).toBe('yaml')
    expect(first.querySelector('.ws-config__panel--yaml pre')?.textContent).toBe(workspaceShowcase('rs')!.examples[0]!.yaml)
    expect(first.querySelector('.ws-config__panel--json pre')?.getAttribute('data-lang')).toBe('json')
    expect(JSON.parse(first.querySelector('.ws-config__panel--json pre')!.textContent!)).toEqual(parsed(workspaceShowcase('rs')!.examples[0]!))
    expect(first.querySelector('.ws-config__tabs')?.nextElementSibling).toBe(first.querySelector('.ws-config__panel--yaml'))
    expect(first.querySelector('.ws-config__note')?.textContent).toContain('Converted from the YAML')
  })

  it('links the source and each test at the revision it was read at', async () => {
    const document = await section('rs')
    const showcase = workspaceShowcase('rs')!
    const hrefs = [...document.querySelectorAll('.ws-source a, .ws-tests a')].map((link) => link.getAttribute('href')!)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) expect(href.startsWith(`https://github.com/${showcase.repo}/blob/${showcase.revision}/`), href).toBe(true)
    const start = showcase.examples.find((example) => example.topic === 'start-directory')!
    expect(hrefs).toContain(revisionUrl(showcase, start.tests[0]!.path, start.tests[0]!.line))
    const article = [...document.querySelectorAll('.ws-example')].find((entry) => entry.querySelector('h3')?.id === 'example-start-directory')!
    for (const test of start.tests) expect(article.querySelector('.ws-tests')?.textContent).toContain(test.name)
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
