import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import { createComponent, renderTemplate } from 'astro/runtime/server/index.js'
import { afterEach, describe, expect, it } from 'vitest'
import { contractOf, contractsOf, sameContract, sameContracts, type ToolContract } from '../src/lib/mcp-contract'
import { MCP_REFERENCE, mcpReferenceRoutes } from '../src/lib/mcp-reference'
import {
  abbreviate, buildShowcase, CAPABILITY_KEY, transcriptFor, EXAMPLES, mcpShowcase, protocolSnapshot, recordingHolds, showcaseHeadings, TIERS, toolHeadings, toolPurposes, toolTier,
  type McpShowcase, type ProtocolSnapshot, type ProtocolTool, type Transcript,
} from '../src/lib/mcp-showcase'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

const PORTS = Object.keys(MCP_REFERENCE)
const onDisk = (port: string) => JSON.parse(readFileSync(new URL(`../src/data/mcp-protocol/${port}.json`, import.meta.url), 'utf8')) as ProtocolSnapshot & {
  protocol: { tools: (ProtocolTool & { inputSchema: Schema; outputSchema?: Schema })[] }
}
const showcases = new Map<string, McpShowcase>()
const showcase = async (port: string) => {
  if (!showcases.has(port)) showcases.set(port, (await mcpShowcase(port, 'latest'))!)
  return showcases.get(port)!
}

/* A JSON Schema subset: the keywords the servers' tool schemas use. */
type Schema = boolean | { [key: string]: unknown }
function problems(schema: Schema, value: unknown, root: Schema, at = '$'): string[] {
  if (schema === true) return []
  if (schema === false) return [`${at}: nothing is allowed`]
  const found: string[] = []
  const object = schema as Record<string, any>
  if (typeof object.$ref === 'string') {
    const target = object.$ref.slice(2).split('/').reduce((node: any, key: string) => node?.[key], root)
    return target === undefined ? [`${at}: unresolved ${object.$ref}`] : problems(target, value, root, at)
  }
  const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value
  if (object.type !== undefined) {
    const wanted: string[] = Array.isArray(object.type) ? object.type : [object.type]
    if (!wanted.some((type) => type === kind || (type === 'number' && kind === 'integer'))) found.push(`${at}: ${kind} is not ${wanted.join('|')}`)
  }
  if (object.const !== undefined && JSON.stringify(object.const) !== JSON.stringify(value)) found.push(`${at}: not ${JSON.stringify(object.const)}`)
  if (object.enum && !object.enum.some((item: unknown) => JSON.stringify(item) === JSON.stringify(value))) found.push(`${at}: not one of ${JSON.stringify(object.enum)}`)
  if (object.anyOf && !object.anyOf.some((branch: Schema) => !problems(branch, value, root, at).length)) found.push(`${at}: matches no anyOf branch`)
  if (object.oneOf && object.oneOf.filter((branch: Schema) => !problems(branch, value, root, at).length).length !== 1) found.push(`${at}: does not match exactly one oneOf branch`)
  if (typeof value === 'string') {
    if (object.pattern && !new RegExp(object.pattern).test(value)) found.push(`${at}: does not match ${object.pattern}`)
    if (object.minLength !== undefined && value.length < object.minLength) found.push(`${at}: shorter than ${object.minLength}`)
    if (object.maxLength !== undefined && value.length > object.maxLength) found.push(`${at}: longer than ${object.maxLength}`)
  }
  if (typeof value === 'number') {
    if (object.minimum !== undefined && value < object.minimum) found.push(`${at}: below ${object.minimum}`)
    if (object.maximum !== undefined && value > object.maximum) found.push(`${at}: above ${object.maximum}`)
    if (object.exclusiveMinimum !== undefined && value <= object.exclusiveMinimum) found.push(`${at}: not above ${object.exclusiveMinimum}`)
  }
  if (Array.isArray(value)) {
    if (object.minItems !== undefined && value.length < object.minItems) found.push(`${at}: fewer than ${object.minItems} items`)
    if (object.maxItems !== undefined && value.length > object.maxItems) found.push(`${at}: more than ${object.maxItems} items`)
    if (object.items !== undefined) value.forEach((item, index) => found.push(...problems(object.items, item, root, `${at}[${index}]`)))
  }
  if (kind === 'object') {
    const record = value as Record<string, unknown>
    for (const key of object.required ?? []) if (!(key in record)) found.push(`${at}: missing ${key}`)
    for (const [key, item] of Object.entries(record)) {
      if (object.properties && key in object.properties) found.push(...problems(object.properties[key], item, root, `${at}.${key}`))
      else if (object.additionalProperties === false) found.push(`${at}: unknown property ${key}`)
      else if (typeof object.additionalProperties === 'object') found.push(...problems(object.additionalProperties, item, root, `${at}.${key}`))
    }
  }
  return found
}
const check = (schema: Schema, value: unknown) => problems(schema, value, schema)

/* Every property path a tool's result can carry, following $ref, anyOf and array items. An array item is `[]`. */
function resultPaths(schema: Schema | undefined, root: Schema | undefined = schema, at = '', seen: readonly string[] = []): string[] {
  if (!schema || schema === true || !root) return []
  const object = schema as Record<string, any>
  if (typeof object.$ref === 'string') {
    if (seen.includes(object.$ref)) return []
    const target = object.$ref.slice(2).split('/').reduce((node: any, key: string) => node?.[key], root)
    return resultPaths(target, root, at, [...seen, object.$ref])
  }
  const branches: Schema[] = [...(object.anyOf ?? []), ...(object.oneOf ?? []), ...(object.allOf ?? [])]
  // A result that tags each entry with a `kind` (Ruby's `created` list holds sessions, windows and panes) names it in the path: `created[]<pane>.id`.
  const kind = typeof object.properties?.kind?.const === 'string' ? `<${object.properties.kind.const}>` : ''
  return [
    ...Object.entries<Schema>(object.properties ?? {}).flatMap(([key, item]) => {
      const path = at ? `${at}${kind}.${key}` : key
      return [path, ...resultPaths(item, root, path, seen)]
    }),
    ...(object.items ? resultPaths(object.items, root, `${at}[]`, seen) : []),
    ...branches.flatMap((branch) => resultPaths(branch, root, at, seen)),
  ]
}

/* A `$N` session or `%N` pane id in a call is not in the prompt: an earlier result returned it. */
const ID = /^[$%]\d+$/
const idsIn = (value: unknown): string[] => (typeof value === 'string'
  ? (ID.test(value) ? [value] : [])
  : value && typeof value === 'object' ? Object.values(value).flatMap(idsIn) : [])
const carries = (id: string, path: string) => {
  const last = path.split('.').pop()!.replace(/\[\]/g, '').toLowerCase()
  return id.startsWith('%') ? /pane_?id$/.test(last) || (last === 'id' && /pane/i.test(path)) : /^(session_?id|id)$/.test(last) && !/pane|window/i.test(path)
}
/** A tool's result schema, which the snapshot carries though its type does not name it. */
const outputSchemaOf = (tool: unknown) => (tool as { outputSchema?: Schema } | undefined)?.outputSchema
const resultOf = (port: string) => (tool: string) => outputSchemaOf(onDisk(port).protocol.tools.find((entry) => entry.name === tool))
interface Call { tool: string; arguments: Record<string, unknown>; caption: string }
const unexplainedIds = (steps: Call[], result: (tool: string) => Schema | undefined) => steps.flatMap((step, index) => idsIn(step.arguments).flatMap((id) => {
  const found: string[] = []
  if (!steps.slice(0, index).some((before) => resultPaths(result(before.tool)).some((path) => carries(id, path)))) found.push(`${step.tool}: no earlier result carries ${id}`)
  if (!step.caption.includes(id) || !/\breturned\b/.test(step.caption)) found.push(`${step.tool}: the caption does not say a result returned ${id}`)
  return found
}))

describe('the tools a showcase groups', () => {
  it.each(PORTS)('reads the committed tools/list snapshot for %s', async (port) => {
    expect(await protocolSnapshot(port)).toEqual(onDisk(port))
  })

  it.each(PORTS)('lists every tool %s advertises once, and no other', async (port) => {
    const listed = (await showcase(port)).groups.flatMap((group) => group.tools.map((tool) => tool.name))
    expect([...listed].sort()).toEqual(onDisk(port).protocol.tools.map((tool) => tool.name).sort())
  })

  it.each(PORTS)('puts each %s tool in the tier its server declares', async (port) => {
    const tiers = new Map((await showcase(port)).groups.flatMap((group) => group.tools.map((tool) => [tool.name, tool.tier])))
    for (const tool of onDisk(port).protocol.tools) {
      const meta = (tool._meta ?? {}) as Record<string, any>
      const declared = meta[CAPABILITY_KEY]?.toolset ?? meta.fastmcp?.tags?.find((tag: string) => TIERS.some((tier) => tier.id === tag))
      expect(tiers.get(tool.name), `${port} ${tool.name}`).toBe(declared)
    }
  })

  it('groups a tiered server by tier and lists one that declares none together', async () => {
    for (const port of PORTS) {
      const { groups } = await showcase(port)
      const declared = onDisk(port).protocol.tools.some((tool) => toolTier(tool) !== undefined)
      if (declared) {
        expect(groups.map((group) => group.tier?.id), port).toEqual(TIERS.map((tier) => tier.id).filter((id) => groups.some((group) => group.tier?.id === id)))
        for (const group of groups) for (const tool of group.tools) expect(tool.tier, `${port} ${tool.name}`).toBe(group.tier!.id)
      } else {
        expect(groups, port).toHaveLength(1)
        expect(groups[0]!.tier).toBeUndefined()
        expect(groups[0]!.tools.every((tool) => tool.tier === undefined)).toBe(true)
      }
    }
    expect((await showcase('ruby')).groups[0]!.tier).toBeUndefined()
    expect((await showcase('ts')).groups.map((group) => group.tier?.id)).toEqual(['inspect', 'manage', 'execute', 'teardown'])
  })

  it('reads a tier from either metadata shape and ignores a name that is not a tier', () => {
    expect(toolTier({ _meta: { [CAPABILITY_KEY]: { toolset: 'teardown' } } })).toBe('teardown')
    expect(toolTier({ _meta: { fastmcp: { tags: ['self-bounded', 'manage'] } } })).toBe('manage')
    expect(toolTier({ _meta: { [CAPABILITY_KEY]: { toolset: 'admin' } } })).toBeUndefined()
    expect(toolTier({ _meta: { fastmcp: { tags: [] } } })).toBeUndefined()
    expect(toolTier({})).toBeUndefined()
  })

  it('links each tool to the reference page the site publishes for it', async () => {
    const routes = new Set(mcpReferenceRoutes(undefined, {}, 'latest').map((route) => route.path))
    for (const port of PORTS) {
      for (const group of (await showcase(port)).groups) {
        for (const tool of group.tools) {
          expect(tool.href, `${port} ${tool.name}`).toBe(`/${port}/latest/mcp/tools/${tool.name}/`)
          expect(routes.has(tool.href.replace(/^\/|\/$/g, '')), tool.href).toBe(true)
        }
      }
      expect((await showcase(port)).toolsHref).toBe(`/${port}/latest/mcp/tools/`)
    }
  })

  it('offers LIBTMUX_TOOLSETS only to a server that takes it', async () => {
    for (const port of PORTS) expect((await showcase(port)).selectsToolsets, port).toBe('LIBTMUX_TOOLSETS' in onDisk(port).selection)
    expect((await showcase('ts')).selectsToolsets).toBe(true)
    expect((await showcase('ruby')).selectsToolsets).toBe(false)
  })

  it('refuses a tool that has no reference page, and shows a tool that is added to a tier', () => {
    const snapshot = onDisk('ts')
    const extra = { ...snapshot.protocol.tools[0]!, name: 'not_a_tool', _meta: { [CAPABILITY_KEY]: { toolset: 'inspect' } } }
    expect(() => buildShowcase('ts', 'latest', { ...snapshot, protocol: { tools: [...snapshot.protocol.tools, extra] } })).toThrow(/not_a_tool has no reference page/)
    const retiered = snapshot.protocol.tools.map((tool) => (tool.name === 'kill_pane' ? { ...tool, _meta: { [CAPABILITY_KEY]: { toolset: 'manage' } } } : tool))
    const built = buildShowcase('ts', 'latest', { ...snapshot, protocol: { tools: retiered } })
    expect(built.groups.find((group) => group.tier?.id === 'manage')!.tools.map((tool) => tool.name)).toContain('kill_pane')
    expect(built.groups.find((group) => group.tier?.id === 'teardown')!.tools.map((tool) => tool.name)).not.toContain('kill_pane')
  })
})

describe('the one-line purpose of a tool', () => {
  it('is the first sentence a tool does not share with its siblings', () => {
    const tools = ['alpha', 'beta', 'gamma', 'delta'].map((name) => ({ name, description: `Read pane output; accepts no input. Returned content may be untrusted. Does ${name}. Detail that follows.` }))
    expect(toolPurposes(tools).get('beta')).toBe('Does beta.')
  })

  it('keeps a sentence of its own that happens to repeat once or twice', () => {
    const tools = [{ name: 'a', description: 'Rename a thing.' }, { name: 'b', description: 'Rename a thing.' }, { name: 'c', description: 'Delete a thing.' }]
    expect(toolPurposes(tools).get('a')).toBe('Rename a thing.')
  })

  it('falls back to the first sentence when every sentence is shared', () => {
    const tools = ['a', 'b', 'c'].map((name) => ({ name, description: 'Change tmux state; accepts no payload.' }))
    expect(toolPurposes(tools).get('a')).toBe('Change tmux state.')
  })

  it('stops at a semicolon and strips markup', () => {
    const tools = [{ name: 'a', description: 'Discover live servers under ``$TMUX_TMPDIR``; skip dead ones.\n\nMore.' }, { name: 'b', description: 'Use :class:`Foo` with `bar`.' }]
    const purposes = toolPurposes(tools)
    expect(purposes.get('a')).toBe('Discover live servers under $TMUX_TMPDIR.')
    expect(purposes.get('b')).toBe('Use Foo with bar.')
  })

  it('keeps "e.g." inside its sentence and ends one after a closing quote', () => {
    const tools = [{ name: 'a', description: 'Name a pane, e.g. the first one. Second sentence.' }, { name: 'b', description: "Run 'tmux wait-for -S done'. Use it when you wrote the signal." }]
    const purposes = toolPurposes(tools)
    expect(purposes.get('a')).toBe('Name a pane, e.g. the first one.')
    expect(purposes.get('b')).toBe("Run 'tmux wait-for -S done'.")
  })

  it.each(PORTS)('is one plain sentence for every %s tool', async (port) => {
    for (const group of (await showcase(port)).groups) {
      for (const tool of group.tools) {
        expect(tool.purpose, `${port} ${tool.name}`).toMatch(/\S\.$/)
        expect(tool.purpose, `${port} ${tool.name}`).not.toMatch(/[`;]|:[a-z]+:/)
      }
    }
  })

  it('reads what each server wrote, without the policy sentence it puts before every reader', async () => {
    const purpose = async (port: string, name: string) => (await showcase(port)).groups.flatMap((group) => group.tools).find((tool) => tool.name === name)?.purpose
    expect(await purpose('ts', 'capture_pane')).toBe('The text a pane is showing, or its scrollback.')
    expect(await purpose('ts', 'show_environment')).toBe('Read the tmux environment.')
    expect(await purpose('go', 'call_read_tools_batch')).toBe('Calls up to sixteen eligible inspect tools serially.')
    expect(await purpose('py', 'list_servers')).toBe("Discover live tmux servers under the current user's $TMUX_TMPDIR.")
  })
})

describe('the worked example', () => {
  it('has a prompt and calls for every port that has tools', async () => {
    expect(Object.keys(EXAMPLES).sort()).toEqual([...PORTS].sort())
    for (const port of PORTS) expect((await showcase(port)).example?.steps.length, port).toBeGreaterThan(1)
  })

  it.each(PORTS)('calls only tools %s advertises, with arguments its input schema accepts', async (port) => {
    const tools = new Map(onDisk(port).protocol.tools.map((tool) => [tool.name, tool]))
    for (const step of EXAMPLES[port]!.steps) {
      const tool = tools.get(step.tool)
      expect(tool, `${port} advertises ${step.tool}`).toBeDefined()
      expect(check(tool!.inputSchema, step.arguments), `${port} ${step.tool}`).toEqual([])
    }
  })

  it('checks arguments against the schema, so a wrong name or a missing one fails', () => {
    const schema = onDisk('ts').protocol.tools.find((tool) => tool.name === 'run_shell_command')!.inputSchema
    expect(check(schema, { paneId: '%0', command: 'pytest -q' })).toEqual([])
    expect(check(schema, { paneId: '%0' })).toEqual(['$: missing command'])
    expect(check(schema, { pane_id: '%0', command: 'x' }).join()).toMatch(/missing paneId/)
    expect(check(schema, { paneId: 'pane-0', command: 'x' }).join()).toMatch(/does not match/)
    const closed = onDisk('go').protocol.tools.find((tool) => tool.name === 'run_shell_command')!.inputSchema
    expect(check(closed, { pane_id: '%0', command: 'x' })).toEqual([])
    expect(check(closed, { pane_id: '%0', command: 'x', extra: 1 }).join()).toMatch(/unknown property extra/)
    const ruby = onDisk('ruby').protocol.tools.find((tool) => tool.name === 'tmux_snapshot')!.inputSchema
    expect(check(ruby, { entity: 'pane', limit: 20 })).toEqual([])
    expect(check(ruby, { entity: 'cursor-less', limit: 20 }).length).toBeGreaterThan(0)
  })

  it('is left out when the server no longer advertises a tool it calls', () => {
    const snapshot = onDisk('ts')
    const without = { ...snapshot, protocol: { tools: snapshot.protocol.tools.filter((tool) => tool.name !== 'run_shell_command') } }
    expect(buildShowcase('ts', 'latest', without).example).toBeUndefined()
  })

  it.each(PORTS)('takes every id in the %s example from an earlier result and says so in the caption', (port) => {
    expect(unexplainedIds(EXAMPLES[port]!.steps, resultOf(port))).toEqual([])
  })

  it('finds the ids a call uses, in a nested argument too', () => {
    expect(EXAMPLES.ts!.steps.flatMap((step) => idsIn(step.arguments))).toEqual(['%0', '%0', '%1'])
    expect(EXAMPLES.go!.steps.flatMap((step) => idsIn(step.arguments))).toEqual(['%0', '%0', '%1', '$0'])
    expect(EXAMPLES.julia!.steps.flatMap((step) => idsIn(step.arguments))).toEqual(['%1', '$1', '%1', '%2', '$1'])
    expect(EXAMPLES.py!.steps.flatMap((step) => idsIn(step.arguments))).toEqual(['%0', '%0', '%1'])
  })

  it('reports an id that has no earlier result, or a caption that does not say where it came from', () => {
    const go = resultOf('go')
    const create = { tool: 'create_session', arguments: { session_name: 'checks' }, caption: 'Create the session.' }
    const kill = { tool: 'kill_session', arguments: { session_id: '$0' }, caption: 'Remove the session by the id the create result returned ($0).' }
    expect(unexplainedIds([create, kill], go)).toEqual([])
    expect(unexplainedIds([create, { ...kill, caption: 'Remove the session once the result is read.' }], go)).toEqual(['kill_session: the caption does not say a result returned $0'])
    expect(unexplainedIds([create, { ...kill, caption: 'Remove the session by its id.' }], go)).toHaveLength(1)
    expect(unexplainedIds([kill], go)).toEqual(['kill_session: no earlier result carries $0'])
    const run = { tool: 'run_shell_command', arguments: { pane_id: '%0', command: 'pytest -q' }, caption: 'Run the command in the pane the create result returned (%0).' }
    expect(unexplainedIds([create, run], go)).toEqual(['run_shell_command: no earlier result carries %0'])
    expect(unexplainedIds([create, { tool: 'list_panes', arguments: {}, caption: 'List the panes.' }, run], go)).toEqual([])
    expect(unexplainedIds([create, run], resultOf('ts'))).toEqual([])
    expect(unexplainedIds([create, run], resultOf('swift'))).toEqual(['run_shell_command: no earlier result carries %0'])
  })

  it('reads a pane id from a result that nests it, and a session id from one that does not name it', () => {
    expect(resultPaths(outputSchemaOf(onDisk('ts').protocol.tools.find((tool) => tool.name === 'create_session')!))).toEqual(expect.arrayContaining(['paneId', 'session.id']))
    expect(resultPaths(outputSchemaOf(onDisk('rs').protocol.tools.find((tool) => tool.name === 'list_panes')!))).toContain('panes[].id')
    expect(resultPaths(outputSchemaOf(onDisk('julia').protocol.tools.find((tool) => tool.name === 'list_panes')!))).toContain('panes[].target.paneId')
    expect(resultPaths(outputSchemaOf(onDisk('swift').protocol.tools.find((tool) => tool.name === 'create_session')!)).some((path) => carries('%0', path))).toBe(false)
    expect(resultPaths(outputSchemaOf(onDisk('java').protocol.tools.find((tool) => tool.name === 'create_session')!)).some((path) => carries('$0', path))).toBe(true)
  })

  it('names the tier of each call from the tool it calls', async () => {
    const steps = (await showcase('ts')).example!.steps.map((step) => [step.tool.name, step.tool.tier])
    expect(steps).toEqual([['create_session', 'execute'], ['split_window', 'execute'], ['list_windows', 'inspect'], ['run_shell_command', 'execute'], ['run_shell_command', 'execute'], ['kill_session', 'teardown']])
  })
})

describe('the overview page', () => {
  const page = readFileSync(new URL('../src/components/docs/DocPage.astro', import.meta.url), 'utf8')

  it('opens the MCP overview with the worked example, then install, and closes it with the tools', () => {
    expect(page).toContain("const mcpTools = isMcpOverview && port ? await mcpShowcase(port, version ?? buildTarget(process.env).version) : undefined")
    const example = page.indexOf('<McpShowcase showcase={mcpTools} part="example" />')
    const install = page.indexOf('<h2 id="install">Install</h2>')
    const tools = page.indexOf('<McpShowcase showcase={mcpTools} part="tools" />')
    expect(page.indexOf('productIntro && <ProductIntro parts={productIntro} />'), 'the example follows the intro').toBeLessThan(example)
    expect(example, 'the example comes before install').toBeLessThan(install)
    expect(install).toBeLessThan(page.indexOf('placeholderLocale && <Content />'))
    expect(page.indexOf('placeholderLocale && <Content />'), 'the tool grid follows the prose').toBeLessThan(tools)
    expect(page).toContain('!placeholderLocale && mcpTools && <McpShowcase')
  })

  it('lists the table of contents in the order the page draws: example, install, prose, tools', () => {
    const order = ['mcpExampleHeadings(mcpTools)', "slug: 'install'", '...headings,', 'mcpToolHeadings(mcpTools)'].map((needle) => page.indexOf(needle, page.indexOf('headings={placeholderLocale')))
    expect(order.every((at) => at > 0), 'every list is in the headings prop').toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('lists the example heading before the tool headings', async () => {
    for (const port of PORTS) {
      const slugs = showcaseHeadings(await showcase(port)).map((heading) => heading.slug)
      expect(slugs[0], port).toBe('worked-example')
      expect(slugs.slice(1), port).toEqual(toolHeadings(await showcase(port)).map((heading) => heading.slug))
    }
  })
})

describe('the showcase section', () => {
  const windows: Window[] = []
  afterEach(async () => { for (const win of windows.splice(0)) await win.happyDOM.abort() })

  const component = loadAstroTemplate('components/mcp/McpShowcase.astro', {
    real: ['components/mcp/McpReplay.astro', 'components/replay/TmuxScreen.astro', 'components/replay/ReplayControls.astro'],
    modules: {
      'astro-expressive-code/components': {
        Code: createComponent((_result: unknown, props: { code: string; lang: string; title?: string }) => renderTemplate`<pre data-lang="${props.lang}" data-title="${props.title ?? ''}">${props.code}</pre>`),
      },
    },
  })
  /** A call row's tool and arguments. */
  const parseCall = (row: Element) => ({ tool: row.querySelector('.mcp-call__tool code')!.textContent!, arguments: JSON.parse(row.querySelector('.mcp-call__args')!.textContent!) })
  async function section(port: string, shown?: McpShowcase) {
    const win = new Window({ url: 'https://libtmux.org/en/' })
    windows.push(win)
    win.document.body.innerHTML = await renderAstroTemplate(await component, { props: { showcase: shown ?? await showcase(port) } })
    return win.document as unknown as Document
  }

  it('shows each tier once, with a badge on every tool and a link to its page', async () => {
    const document = await section('ts')
    expect([...document.querySelectorAll('.mcp-group__title')].map((title) => title.textContent!.trim())).toEqual(['Inspect', 'Manage', 'Execute', 'Teardown'])
    const cards = [...document.querySelectorAll('li.mcp-tool')]
    expect(cards.length).toBe(onDisk('ts').protocol.tools.length)
    for (const card of cards) {
      expect(card.querySelector('.mcp-tier')).not.toBeNull()
      expect(card.querySelector('a')!.getAttribute('href')).toBe(`/ts/latest/mcp/tools/${card.querySelector('.mcp-tool__name')!.textContent}/`)
    }
    const kill = cards.find((card) => card.querySelector('.mcp-tool__name')!.textContent === 'kill_session')!
    expect(kill.querySelector('.mcp-tier')?.className).toContain('mcp-tier--teardown')
    expect(kill.querySelector('.mcp-tool__purpose')?.textContent).toBe('Remove a session.')
  })

  it('lists a server that declares no toolsets together, with no badge', async () => {
    const document = await section('ruby')
    expect(document.querySelector('h2#tools')).not.toBeNull()
    expect(document.querySelector('h2#tools-by-tier')).toBeNull()
    expect(document.querySelector('.mcp-group__title')).toBeNull()
    expect(document.querySelector('.mcp-tier')).toBeNull()
    expect(document.querySelectorAll('li.mcp-tool')).toHaveLength(onDisk('ruby').protocol.tools.length)
    expect(document.body.textContent).not.toContain('LIBTMUX_TOOLSETS')
  })

  it('shows the prompt and each call as its tool name and the JSON arguments a client sends', async () => {
    const document = await section('rs')
    expect(document.querySelector('.mcp-turn--user p')?.textContent).toBe(EXAMPLES.rs!.prompt)
    const calls = [...document.querySelectorAll('.mcp-call')].map(parseCall)
    expect(calls).toEqual(EXAMPLES.rs!.steps.map((step) => ({ tool: step.tool, arguments: step.arguments })))
    expect(document.querySelector('.mcp-call a')?.getAttribute('href')).toBe('/rs/latest/mcp/tools/create_session/')
  })

  it('shows each call under its caption, and the id in a caption is the one in the call', async () => {
    for (const port of PORTS) {
      const document = await section(port)
      const steps = [...document.querySelectorAll('article.mcp-turn')]
      const { example } = await showcase(port)
      expect(steps, port).toHaveLength(example!.steps.length)
      steps.forEach((item, index) => {
        const { caption, arguments: args, tool } = example!.steps[index]!
        const lead = item.querySelector('.mcp-turn__say')!.textContent!.replace(/\s+/g, ' ').replace(/^agent/, '').trim()
        expect(lead, `${port} ${tool.name}`).toBe(caption)
        const call = parseCall(item.querySelector('.mcp-call')!)
        expect(call.arguments, `${port} ${tool.name}`).toEqual(args)
        for (const id of idsIn(args)) expect(caption, `${port} ${tool.name}`).toContain(id)
      })
    }
  })

  it('shows a recorded result under each call, and the agent\'s answer quoting the pane output last', async () => {
    const document = await section('ts')
    const items = [...document.querySelectorAll('article.mcp-turn')]
    for (const item of items) expect(item.querySelectorAll('details.mcp-result pre')).toHaveLength(1)
    expect(JSON.parse(items[0]!.querySelector('details.mcp-result pre')!.textContent!).paneId, 'the id later calls use comes from this result').toBe('%0')
    expect([...document.querySelectorAll('.mcp-turn--answer q')].map((q) => q.textContent)).toEqual([expect.stringMatching(/^2 passed/), expect.stringMatching(/checks finished$/)])
    expect(document.querySelector('.mcp-provenance')?.textContent).toMatch(/recorded against.*libtmux\/libtmux-ts.*private tmux/si)
  })

  it('tells the reader which token stands in for Julia\'s generation, and says nothing of one for a port without that rewrite', async () => {
    const julia = await section('julia')
    const items = [...julia.querySelectorAll('article.mcp-turn')]
    expect(items).toHaveLength(EXAMPLES.julia!.steps.length)
    for (const item of items) expect(item.querySelectorAll('details.mcp-result pre')).toHaveLength(1)
    const provenance = julia.querySelector('.mcp-provenance')?.textContent?.replace(/\s+/g, ' ')
    expect(provenance).toContain("The server's generation differs on every run. A real call sends the generation create_session returned, and the server refuses 3f9a1c itself as stale_target; the recording shows the generation as 3f9a1c.")
    expect((await section('ts')).querySelector('.mcp-provenance')?.textContent).not.toMatch(/generation/)
  })

  it('draws the borrowed docs session alone once Julia\'s example removes its own', async () => {
    const julia = await section('julia')
    const frames = [...julia.querySelectorAll('[data-frame]')]
    expect(frames).toHaveLength(EXAMPLES.julia!.steps.length + 1)
    expect(frames.at(-1)!.querySelector('.mcp-pane__id')?.textContent).toBe('%0 cat')
    expect(frames.at(-1)!.querySelector('.mcp-tmux__session')?.textContent).toBe('[docs]')
  })

  it('says requests only, and shows no result, preview or control, for a port with no recording', async () => {
    // No port lacks a recording once all are recorded, so build the page the way a port without one would get it.
    const document = await section('go', buildShowcase('go', 'latest', onDisk('go')))
    expect(document.querySelectorAll('article.mcp-turn')).toHaveLength(EXAMPLES.go!.steps.length)
    for (const selector of ['details.mcp-result', '[data-frame]', '[data-controls]', '[data-tmux]', '.mcp-turn--answer']) expect(document.querySelector(selector), selector).toBeNull()
    expect(document.querySelector('.mcp-provenance')?.textContent).toContain('Requests only: no recorded results for Go yet.')
  })

  it('gives every heading the table of contents lists an id on the page', async () => {
    for (const port of PORTS) {
      const document = await section(port)
      for (const heading of showcaseHeadings(await showcase(port))) {
        expect(document.getElementById(heading.slug)?.tagName, `${port} ${heading.slug}`).toBe(`H${heading.depth}`)
      }
    }
  })
})

describe('recorded results', () => {
  /** Ports whose example runs commands in panes. */
  const RECORDED = ['ts', 'rs', 'go', 'py', 'java', 'csharp', 'cxx', 'swift']
  /** Every port with a recording; Julia's example only reads, and Ruby's runs its commands through `tmux_send` and `tmux_wait`. */
  const ALL = [...RECORDED, 'ruby', 'julia']

  it('has a recording for the ports whose servers the recorder has run', async () => {
    for (const port of ALL) expect((await showcase(port)).example?.recording, port).toBeDefined()
  })

  it.each(ALL)('records %s with the calls the page shows and no error', async (port) => {
    const transcript = (await transcriptFor(port))!
    expect(transcript.steps.map((step) => [step.tool, step.arguments])).toEqual(EXAMPLES[port]!.steps.map((step) => [step.tool, step.arguments]))
    expect(transcript.steps.filter((step) => step.isError)).toEqual([])
  })

  it.each(ALL)('records %s with the schemas its snapshot advertised for the tools it calls', async (port) => {
    const transcript = (await transcriptFor(port))!
    const tools = new Map(onDisk(port).protocol.tools.map((tool) => [tool.name, tool]))
    const called = [...new Set(transcript.steps.map((step) => step.tool))]
    expect(Object.keys(transcript.contracts ?? {}).sort()).toEqual([...called].sort())
    // The snapshot a recording is made against is the one at its revision; a later snapshot may differ, and then the page shows the requests only.
    if (transcript.revision === onDisk(port).revision) {
      expect(sameContracts(transcript.contracts, Object.fromEntries(called.map((name) => [name, contractOf(tools.get(name)!)]))), `${port} contracts match the snapshot`).toBe(true)
    }
  })

  it.each(ALL)('records %s so that every id a request names was returned by an earlier result', async (port) => {
    const transcript = (await transcriptFor(port))!
    transcript.steps.forEach((step, index) => {
      for (const id of idsIn(step.arguments)) {
        const earlier = JSON.stringify(transcript.steps.slice(0, index).map((previous) => [previous.content, previous.structuredContent]))
        expect(earlier, `${port} ${step.tool} names ${id}`).toContain(id)
      }
    })
  })

  it('records Julia sending each pane the generation its create result returned, and the log in the split pane', async () => {
    const transcript = (await transcriptFor('julia'))!
    const [create, , listing, tests, log] = transcript.steps as { structuredContent: any; arguments: any }[]
    expect(create!.structuredContent.panes[0], 'the create result returns the pane the later calls name').toEqual({ paneId: '%1', generation: '3f9a1c' })
    expect(listing!.structuredContent.panes.map((pane: any) => pane.target.paneId).sort()).toEqual(['%1', '%2'])
    expect(tests!.arguments.target).toEqual(create!.structuredContent.panes[0])
    expect(log!.structuredContent).toMatchObject({ matched: true, text: 'checks finished', target: { paneId: '%2' } })
    expect(transcript.sandbox.rewritten?.generation, 'the generation is a fixed stand-in, which the transcript says').toBe('3f9a1c')
    expect(transcript.sandbox.rewritten, 'and says which call listed the real one and how the server refuses the stand-in').toMatchObject({ generationListedBy: 'create_session', generationRefusedAs: 'stale_target' })
    expect(JSON.stringify(transcript.steps), 'no process id or start time is left in the recording').not.toMatch(/"generation\\?":\\?"\d+:\d+/)
  })

  const panesPerWindow = (step: { tmux?: { panes: { window: string }[] } }) => Object.values((step.tmux?.panes ?? []).reduce<Record<string, number>>((count, pane) => ({ ...count, [pane.window]: (count[pane.window] ?? 0) + 1 }), {}))

  it('counts a read-only example as one pane per window, so the split check can fail', async () => {
    const reading = (await transcriptFor('ruby'))!.steps.slice(0, 1)
    expect(Math.max(...reading.flatMap(panesPerWindow))).toBe(1)
  })

  it.each(PORTS)('runs the split flow for %s, recorded: two panes in one window, then the session gone', async (port) => {
    const { example } = await showcase(port)
    expect(example?.prompt, 'every port answers the shared split prompt').toMatch(/^Create a tmux session called checks, split its window into two panes/)
    expect(example?.recording, `${port} is not "requests only"`).toBeDefined()
    const { steps } = (await transcriptFor(port))!
    expect(Math.max(...steps.flatMap(panesPerWindow)), 'a window holds two panes at some step').toBe(2)
    expect(steps.at(-1)!.tmux!.sessions.map((session) => session.name), 'the session the example made is gone').not.toContain('checks')
  })

  it.each(RECORDED)('records %s printing the test runner\'s result and the log in their panes', async (port) => {
    const { example } = await showcase(port)
    const lines = example!.recording!.answers.map((answer) => answer.line)
    expect(lines[0]).toMatch(/2 passed/)
    expect(lines.at(-1)).toMatch(/checks finished/)
    expect(example!.steps.every((step) => step.result !== undefined)).toBe(true)
  })

  it('ignores a recording of other calls or a failed step rather than showing it', async () => {
    const snapshot = onDisk('ts')
    const transcript = (await transcriptFor('ts'))!
    const withRecording = (changed: Transcript) => buildShowcase('ts', 'latest', snapshot, changed).example!.recording
    expect(withRecording(transcript)).toBeDefined()
    expect(withRecording({ ...transcript, steps: transcript.steps.slice(0, -1) }), 'fewer calls').toBeUndefined()
    expect(withRecording({ ...transcript, steps: transcript.steps.map((step, index) => (index ? step : { ...step, arguments: { name: 'other' } })) }), 'other arguments').toBeUndefined()
    expect(withRecording({ ...transcript, steps: transcript.steps.map((step, index) => (index === 1 ? { ...step, isError: true } : step)) }), 'a failed step').toBeUndefined()
  })

  it('ignores a recording whose tmux state is missing or does not match its calls, and has a control that draws one without state from its results', async () => {
    const snapshot = onDisk('go')
    const transcript = (await transcriptFor('go'))!
    const shown = (changed: Transcript) => buildShowcase('go', 'latest', snapshot, changed).example!.recording
    expect(shown(transcript)).toMatchObject({ tmuxState: true })
    expect(shown({ ...transcript, tmuxBefore: undefined }), 'no state before the first call').toBeUndefined()
    expect(shown({ ...transcript, steps: transcript.steps.map((step, index) => (index === 2 ? { ...step, tmux: undefined } : step)) }), 'a step with no state').toBeUndefined()
    expect(shown({ ...transcript, steps: transcript.steps.map((step, index, all) => ({ ...step, tmux: index ? all[index - 1]!.tmux : transcript.tmuxBefore })) }), 'each state read one call late').toBeUndefined()
    expect(shown({ ...transcript, steps: transcript.steps.map((step, index) => (index === 2 ? { ...step, tmux: { ...step.tmux!, panes: step.tmux!.panes.map((pane) => ({ ...pane, window: '@9' })) } } : step)) }), 'a pane in a window tmux lacks').toBeUndefined()
    expect(shown({ ...transcript, steps: transcript.steps.map((step, index) => (index === 1 ? { ...step, tmux: undefined, arguments: step.arguments } : step)) }), 'a state dropped from a read').toBeUndefined()
    const { tmuxBefore: _before, ...rest } = transcript
    const results = shown({ ...rest, steps: transcript.steps.map(({ tmux: _state, ...step }) => step) })
    expect(results, 'a recording that stored none keeps drawing from its results').toMatchObject({ tmuxState: false })
    expect(results!.frames.some((frame) => frame.recorded)).toBe(false)
  })

  it('ignores a recording that rewrites the generation without saying which call listed it and how the server refuses it', async () => {
    const snapshot = onDisk('julia')
    const transcript = (await transcriptFor('julia'))!
    const shown = (rewritten: NonNullable<Transcript['sandbox']['rewritten']>) => buildShowcase('julia', 'latest', snapshot, { ...transcript, sandbox: { ...transcript.sandbox, rewritten } }).example!.recording
    const rewritten = transcript.sandbox.rewritten!
    expect(shown(rewritten)?.generation).toEqual({ token: '3f9a1c', listedBy: 'create_session', refusedAs: 'stale_target' })
    expect(shown({ ...rewritten, generationRefusedAs: undefined }), 'no refusal').toBeUndefined()
    expect(shown({ ...rewritten, generationListedBy: undefined }), 'no listing call').toBeUndefined()
    expect(shown({ ...rewritten, generationListedBy: 'kill_pane' }), 'a call the session never made').toBeUndefined()
    expect(shown({ ...rewritten, generationRefusedAs: 'invalid_target' }), 'a refusal that is not the one the page documents').toBeUndefined()
    expect(shown({ ...rewritten, generationRefusedAs: 'Stale_Target' }), 'the code is compared as written').toBeUndefined()
  })

  it('abbreviates long text and long lists, and leaves short values alone', () => {
    expect(abbreviate('short')).toBe('short')
    expect(abbreviate('x'.repeat(300))).toBe(`${'x'.repeat(240)}…`)
    expect(abbreviate([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
    expect(abbreviate([1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, '… 2 more'])
    expect(abbreviate({ a: ['y'.repeat(241)], b: 1 })).toEqual({ a: [`${'y'.repeat(240)}…`], b: 1 })
    const wide = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [`k${index}`, index]))
    expect(Object.keys(abbreviate(wide) as object)).toEqual([...Object.keys(wide).slice(0, 12), '…'])
    expect(abbreviate({ a: { b: { c: { d: { e: { f: 1 } } } } } })).toEqual({ a: { b: { c: { d: { e: '…' } } } } })
    expect(abbreviate({ a: { b: { c: { d: { e: [] } } } } }), 'an empty value is not elided').toEqual({ a: { b: { c: { d: { e: [] } } } } })
  })
})

describe('a tool\'s contract', () => {
  const input = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a', 'b'] }

  it('is its input schema, and its output schema when it has one', () => {
    expect(contractOf({ inputSchema: input })).toEqual({ inputSchema: input })
    expect(contractOf({ inputSchema: input, outputSchema: { type: 'object' } })).toEqual({ inputSchema: input, outputSchema: { type: 'object' } })
  })

  it('does not change with the order of keys, and does with the order of a list', () => {
    const reversed = { required: ['a', 'b'], properties: { b: { type: 'integer' }, a: { type: 'string' } }, type: 'object' }
    expect(sameContract({ inputSchema: input }, { inputSchema: reversed })).toBe(true)
    expect(sameContract({ inputSchema: input }, { inputSchema: { ...input, required: ['b', 'a'] } })).toBe(false)
  })

  it('differs by any added, removed or changed schema, an output schema that appears or goes, and a missing contract', () => {
    const base = { inputSchema: input, outputSchema: { type: 'object' } }
    expect(sameContract(base, { ...base, inputSchema: { ...input, required: ['a'] } })).toBe(false)
    expect(sameContract(base, { ...base, outputSchema: { type: 'array' } })).toBe(false)
    expect(sameContract(base, { inputSchema: input })).toBe(false)
    expect(sameContract({ inputSchema: input }, base)).toBe(false)
    expect(sameContract(base, undefined)).toBe(false)
    expect(sameContract(undefined, undefined)).toBe(false)
  })

  it('is taken once for each tool a session calls, and refuses a tool the server does not advertise', () => {
    const tools = [{ name: 'one', inputSchema: input }, { name: 'two', inputSchema: input, outputSchema: { type: 'object' } }, { name: 'unused', inputSchema: {} }]
    const taken = contractsOf(tools, ['one', 'two', 'one'])
    expect(Object.keys(taken)).toEqual(['one', 'two'])
    expect(sameContracts(taken, { one: { inputSchema: input }, two: { inputSchema: input, outputSchema: { type: 'object' } } })).toBe(true)
    expect(sameContracts(taken, { one: taken.one! })).toBe(false)
    expect(() => contractsOf(tools, ['missing'])).toThrow(/missing is not among the advertised tools/)
  })
})

describe('a recording made at an earlier revision', () => {
  const RECORDED = ['ts', 'rs', 'go', 'py', 'java', 'csharp', 'cxx', 'swift', 'ruby', 'julia']
  type Tool = ProtocolSnapshot['protocol']['tools'][number]

  /**
   * What a port's own build does: `build-site.sh` runs `gen-mcp-protocol.mjs
   * --source-bound`, which rewrites the snapshot at the port's head. The
   * revision becomes that commit; the recording keeps the one it was made at.
   */
  const atHead = (snapshot: ProtocolSnapshot): ProtocolSnapshot => ({ ...snapshot, revision: 'f'.repeat(40) })
  const changing = (snapshot: ProtocolSnapshot, name: string, change: (tool: Tool) => Tool): ProtocolSnapshot => ({
    ...snapshot, protocol: { tools: snapshot.protocol.tools.map((tool) => (tool.name === name ? change(tool) : tool)) },
  })
  const withProperty = (schema: Record<string, unknown>) => ({ ...schema, properties: { ...(schema.properties as object), added_at_head: { type: 'string' } } })
  const recordedTools = (transcript: Transcript) => [...new Set(transcript.steps.map((step) => step.tool))]
  const built = (port: string, snapshot: ProtocolSnapshot, transcript: Transcript) => buildShowcase(port, 'latest', snapshot, transcript)

  it.each(RECORDED)('keeps the %s recording when the snapshot is regenerated at a later revision with the same schemas', async (port) => {
    const transcript = (await transcriptFor(port))!
    const snapshot = atHead(onDisk(port))
    expect(snapshot.revision).not.toBe(transcript.revision)
    const { example } = built(port, snapshot, transcript)
    expect(example?.recording?.revision, 'the page names the revision the results were recorded at').toBe(transcript.revision)
    expect(example!.steps.every((step) => step.result !== undefined)).toBe(true)
  })

  it.each(RECORDED)('shows requests only for %s when a tool it calls takes different arguments at the later revision', async (port) => {
    const transcript = (await transcriptFor(port))!
    expect(built(port, atHead(onDisk(port)), transcript).example?.recording, 'the unchanged control').toBeDefined()
    for (const name of recordedTools(transcript)) {
      const snapshot = changing(atHead(onDisk(port)), name, (tool) => ({ ...tool, inputSchema: withProperty(tool.inputSchema) }))
      const { example } = built(port, snapshot, transcript)
      expect(example, `${port} ${name} still shows the requests`).toBeDefined()
      expect(example!.recording, `${port} ${name} input schema`).toBeUndefined()
    }
  })

  it.each(RECORDED)('shows requests only for %s when a tool it calls returns something different at the later revision', async (port) => {
    const transcript = (await transcriptFor(port))!
    expect(built(port, atHead(onDisk(port)), transcript).example?.recording, 'the unchanged control').toBeDefined()
    for (const name of recordedTools(transcript)) {
      const snapshot = changing(atHead(onDisk(port)), name, (tool) => ({ ...tool, outputSchema: withProperty((tool.outputSchema as Record<string, unknown> | undefined) ?? { type: 'object' }) }))
      expect(built(port, snapshot, transcript).example?.recording, `${port} ${name} output schema`).toBeUndefined()
    }
  })

  it('shows requests only on the revision it was recorded at when a schema differs, so the revision is not what vouches for it', async () => {
    const transcript = (await transcriptFor('ts'))!
    const snapshot = changing(onDisk('ts'), 'split_window', (tool) => ({ ...tool, inputSchema: withProperty(tool.inputSchema) }))
    expect(snapshot.revision).toBe(transcript.revision)
    expect(built('ts', snapshot, transcript).example?.recording).toBeUndefined()
  })

  it('keeps the recording when only a tool the example does not call changes', async () => {
    const transcript = (await transcriptFor('ts'))!
    const other = onDisk('ts').protocol.tools.find((tool) => !recordedTools(transcript).includes(tool.name))!
    const snapshot = changing(atHead(onDisk('ts')), other.name, (tool) => ({ ...tool, inputSchema: withProperty(tool.inputSchema) }))
    expect(built('ts', snapshot, transcript).example?.recording).toBeDefined()
  })

  it('shows no recording when a tool it called is no longer advertised', async () => {
    const transcript = (await transcriptFor('ts'))!
    const snapshot = atHead(onDisk('ts'))
    expect(built('ts', snapshot, transcript).example?.recording, 'the control').toBeDefined()
    const without = { ...snapshot, protocol: { tools: snapshot.protocol.tools.filter((tool) => tool.name !== 'split_window') } }
    expect(built('ts', without, transcript).example?.recording).toBeUndefined()
    // The page drops the whole example for a missing tool; the check itself must not vouch for the recording either.
    const advertised = (tools: Tool[]) => new Map(tools.map((tool) => [tool.name, tool]))
    expect(recordingHolds(transcript, EXAMPLES.ts!.steps, advertised(snapshot.protocol.tools))).toBe(true)
    expect(recordingHolds(transcript, EXAMPLES.ts!.steps, advertised(without.protocol.tools))).toBe(false)
  })

  it('shows no recording when the transcript does not say which schemas it was recorded against', async () => {
    const { contracts, ...unproven } = (await transcriptFor('ts'))!
    expect(contracts, 'the committed transcript carries them').toBeDefined()
    expect(built('ts', atHead(onDisk('ts')), unproven).example?.recording).toBeUndefined()
    expect(built('ts', onDisk('ts'), unproven).example?.recording, 'the same revision does not stand in for them').toBeUndefined()
  })

  it('shows no recording when the schemas the transcript recorded differ from the ones advertised', async () => {
    const transcript = (await transcriptFor('ts'))!
    const recorded = transcript.contracts!
    const stale = { ...transcript, contracts: { ...recorded, create_session: { ...recorded.create_session!, inputSchema: withProperty(recorded.create_session!.inputSchema as Record<string, unknown>) } } }
    expect(built('ts', atHead(onDisk('ts')), stale).example?.recording).toBeUndefined()
  })

  it('does not depend on the order of a schema\'s keys', async () => {
    const reorder = (value: unknown): unknown => (Array.isArray(value) ? value.map(reorder)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value)
    const snapshot = atHead(onDisk('ts'))
    const shuffled = { ...snapshot, protocol: { tools: snapshot.protocol.tools.map((tool) => reorder(tool) as Tool) } }
    expect(built('ts', shuffled, (await transcriptFor('ts'))!).example?.recording).toBeDefined()
  })

  describe('what the page says about it', () => {
    const windows: Window[] = []
    afterEach(async () => {
      for (const win of windows.splice(0)) await win.happyDOM.abort()
    })
    const provenance = async (snapshot: ProtocolSnapshot, transcript: Transcript) => {
      const component = await loadAstroTemplate('components/mcp/McpReplay.astro', { real: ['components/replay/TmuxScreen.astro', 'components/replay/ReplayControls.astro'], modules: {
        'astro-expressive-code/components': { Code: createComponent((_result: unknown, props: { code: string }) => renderTemplate`<pre>${props.code}</pre>`) },
      } })
      const win = new Window({ url: 'https://libtmux.org/en/' })
      windows.push(win)
      win.document.body.innerHTML = await renderAstroTemplate(component, { props: { example: built('ts', snapshot, transcript).example!, portName: 'TypeScript' } })
      return win.document.querySelector('.mcp-provenance')!.textContent!.replace(/\s+/g, ' ')
    }

    it('names the revision recorded alone when the page documents that revision', async () => {
      const transcript = (await transcriptFor('ts'))!
      const same = await provenance(onDisk('ts'), transcript)
      expect(same).toContain(`at ${transcript.revision.slice(0, 9)}`)
      expect(same).not.toContain('This page documents')
    })

    it.each(['f', '0'])('says plainly that the results are from one revision, the page documents another, the schemas match and the values may differ (documented %s)', async (digit) => {
      const transcript = (await transcriptFor('ts'))!
      const text = await provenance({ ...onDisk('ts'), revision: digit.repeat(40) }, transcript)
      expect(text).toContain(`at ${transcript.revision.slice(0, 9)}`)
      expect(text).toContain(`This page documents ${digit.repeat(9)}, a different revision.`)
      expect(text).toContain('The calls have the same input and output schemas there, but the results at that revision may differ from the recorded ones.')
      expect(text).not.toContain('Requests only')
      // A snapshot's revision says nothing about which of the two is newer, so neither is called so.
      expect(text).not.toMatch(/\b(later|newer|earlier|older)\b/)
    })

    it('claims the input schemas alone when no output schema was recorded', async () => {
      const transcript = (await transcriptFor('ts'))!
      const bare = (contract: ToolContract): ToolContract => ({ inputSchema: contract.inputSchema })
      const unrecorded: Transcript = { ...transcript, contracts: Object.fromEntries(Object.entries(transcript.contracts!).map(([name, contract]) => [name, bare(contract)])) }
      const snapshot = atHead(onDisk('ts'))
      const withoutOutputs = { ...snapshot, protocol: { tools: snapshot.protocol.tools.map(({ outputSchema: _output, ...tool }) => tool) } }
      expect(built('ts', withoutOutputs, unrecorded).example?.recording, 'the recording still holds without them').toBeDefined()
      const text = await provenance(withoutOutputs, unrecorded)
      expect(text).toContain('The calls have the same input schemas there')
      expect(text).not.toMatch(/output schema/i)
      const full = await provenance(snapshot, transcript)
      expect(full).toContain('same input and output schemas')
    })

    it('does not count an output schema that one recorded tool lacks as checked for the rest', async () => {
      const transcript = (await transcriptFor('ts'))!
      const [first] = Object.keys(transcript.contracts!)
      const partial: Transcript = { ...transcript, contracts: { ...transcript.contracts!, [first!]: { inputSchema: transcript.contracts![first!]!.inputSchema } } }
      const snapshot = changing(atHead(onDisk('ts')), first!, ({ outputSchema: _output, ...tool }) => tool)
      expect(built('ts', snapshot, partial).example?.recording?.outputsChecked).toBe(false)
      expect(built('ts', atHead(onDisk('ts')), transcript).example?.recording?.outputsChecked).toBe(true)
    })
  })

  describe('when its results list the tools the server enabled', () => {
    const tools = (snapshot: ProtocolSnapshot) => snapshot.protocol.tools.map((tool) => tool.name)
    const withContracts = (transcript: Transcript, snapshot: ProtocolSnapshot) => ({ ...transcript, contracts: contractsOf(snapshot.protocol.tools, transcript.steps.map((step) => step.tool)) })

    it('holds for Ruby while the snapshot advertises the tools the recorded capabilities result lists, in any order', async () => {
      const transcript = (await transcriptFor('ruby'))!
      const listed = (transcript.steps[0]!.structuredContent as { data: { enabled_tools: string[] } }).data.enabled_tools
      expect(listed.length, 'the recording does list them').toBeGreaterThan(2)
      expect([...listed].sort()).toEqual(tools(onDisk('ruby')).sort())
      expect(built('ruby', atHead(onDisk('ruby')), transcript).example?.recording).toBeDefined()
      const reordered: Transcript = { ...transcript, steps: transcript.steps.map((step, index) => (index ? step : {
        ...step, structuredContent: { ...(step.structuredContent as object), data: { ...(step.structuredContent as { data: object }).data, enabled_tools: [...listed].reverse() } },
      })) }
      expect(built('ruby', atHead(onDisk('ruby')), reordered).example?.recording).toBeDefined()
    })

    it('shows Ruby requests only when the snapshot no longer advertises a tool the recording enabled', async () => {
      const transcript = (await transcriptFor('ruby'))!
      const snapshot = atHead(onDisk('ruby'))
      const uncalled = tools(snapshot).find((name) => !recordedTools(transcript).includes(name))!
      const without = { ...snapshot, protocol: { tools: snapshot.protocol.tools.filter((tool) => tool.name !== uncalled) } }
      const { example } = built('ruby', without, transcript)
      expect(example, 'the requests still show').toBeDefined()
      expect(example!.recording, `${uncalled} was enabled when recorded`).toBeUndefined()
    })

    it('shows Ruby requests only when the snapshot advertises a tool the recording did not enable', async () => {
      const transcript = (await transcriptFor('ruby'))!
      const snapshot = atHead(onDisk('ruby'))
      const map = new Map(snapshot.protocol.tools.map((tool) => [tool.name, tool]))
      expect(recordingHolds(transcript, EXAMPLES.ruby!.steps, map), 'the control').toBe(true)
      const extra = { ...snapshot.protocol.tools[0]!, name: 'tmux_added_at_head' }
      expect(recordingHolds(transcript, EXAMPLES.ruby!.steps, new Map([...map, [extra.name, extra]]))).toBe(false)
    })

    it('applies to any port whose result lists the tools, wherever the list sits', async () => {
      const snapshot = onDisk('ts')
      const transcript = (await transcriptFor('ts'))!
      const names = tools(snapshot)
      const dropped = names.find((name) => !recordedTools(transcript).includes(name))!
      const listing = (list: unknown): Transcript => withContracts({
        ...transcript, steps: transcript.steps.map((step, index) => (index ? step : { ...step, structuredContent: { server: { available: { names: list } } } })),
      }, snapshot)
      const map = new Map(snapshot.protocol.tools.map((tool) => [tool.name, tool]))
      expect(recordingHolds(listing(names), EXAMPLES.ts!.steps, map), 'the listed tools are the advertised ones').toBe(true)
      expect(recordingHolds(listing(names.filter((name) => name !== dropped)), EXAMPLES.ts!.steps, map), 'one advertised tool is not listed').toBe(false)
      expect(recordingHolds(listing([...names, 'tool_since_removed']), EXAMPLES.ts!.steps, map), 'a listed tool is not advertised').toBe(false)
    })

    it('ignores a list that does not name every tool the recording called, and one that is not made of names', async () => {
      const snapshot = onDisk('ts')
      const transcript = (await transcriptFor('ts'))!
      const map = new Map(snapshot.protocol.tools.map((tool) => [tool.name, tool]))
      const answering = (value: unknown): Transcript => withContracts({
        ...transcript, steps: transcript.steps.map((step, index) => (index ? step : { ...step, structuredContent: value })),
      }, snapshot)
      const called = recordedTools(transcript)
      expect(recordingHolds(answering({ next: [called[0], 'other'] }), EXAMPLES.ts!.steps, map), 'a hint naming one called tool').toBe(true)
      expect(recordingHolds(answering({ ids: ['%0', '@0'], mixed: [...called, 7] }), EXAMPLES.ts!.steps, map), 'ids, and a list with a number among its names').toBe(true)
      expect(recordingHolds(answering({ flags: ['alpha', 'beta'] }), EXAMPLES.ts!.steps, map)).toBe(true)
    })

    it('leaves the ports whose results do not list tools to the schemas alone', async () => {
      for (const port of ['ts', 'rs', 'go', 'py', 'java', 'csharp', 'cxx', 'swift']) {
        const transcript = (await transcriptFor(port))!
        const names = new Set(tools(onDisk(port)))
        const text = JSON.stringify(transcript.steps.map((step) => step.structuredContent ?? step.content))
        const listsThem = [...names].filter((name) => text.includes(`"${name}"`))
        expect(listsThem, `${port} results name no tool`).toEqual([])
      }
    })
  })
})
