import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  callbackContexts, catalogForRelease, collectHookSites, parseChoiceLists, parseFormatTable, parseManualCatalog,
  parseOptionsTable, parseSymbols, verifyCatalog,
} from '../../scripts/gen-tmux-catalog.mjs'
import pins from '../src/data/tmux/versions.json'
import { highlightedPreview } from '../src/lib/link-preview'
import { createLinkPreviewPolicy } from '../src/lib/link-preview-paint'
import { searchApi } from '../src/lib/api-search'
import {
  catalogKindForSegment, tmuxCatalog, tmuxCatalogChangeText, tmuxCatalogEntries, tmuxCatalogEntry, tmuxCatalogHistory,
  tmuxCatalogNavigation, tmuxCatalogRoutes, tmuxCatalogUrl, tmuxCatalogVersionUrl,
} from '../src/lib/tmux-catalog'
import { tmuxCatalogPreview } from '../src/lib/tmux-catalog-preview'
import { tmuxCatalogReferences } from '../src/lib/tmux-catalog-usage'
import { tmuxManual } from '../src/lib/tmux-manual-data'
import { linkTmuxManualEntries } from '../src/lib/tmux-manual'
import { fromHtml } from 'hast-util-from-html'
import { selectAll } from 'astro-expressive-code/hast'

const TMUX_SOURCE = process.env.LIBTMUX_TMUX_SOURCE ?? join(homedir(), 'study/c/tmux')

const options = `
static const char *options_table_bell_action_list[] = {
	"none", "any", "current", "other", NULL
};
#define OPTIONS_TABLE_HOOK(hook_name, default_value) \\
	{ .name = hook_name, \\
	  .type = OPTIONS_TABLE_COMMAND, \\
	  .scope = OPTIONS_TABLE_SESSION, \\
	  .flags = OPTIONS_TABLE_IS_ARRAY|OPTIONS_TABLE_IS_HOOK, \\
	  .default_str = default_value, \\
	  .separator = "" \\
	}
#define OPTIONS_TABLE_PANE_HOOK(hook_name, default_value) \\
	{ .name = hook_name, \\
	  .type = OPTIONS_TABLE_COMMAND, \\
	  .scope = OPTIONS_TABLE_WINDOW|OPTIONS_TABLE_PANE, \\
	  .flags = OPTIONS_TABLE_IS_ARRAY|OPTIONS_TABLE_IS_HOOK, \\
	  .default_str = default_value, \\
	  .separator = "" \\
	}
const struct options_name_map options_other_names[] = {
	{ "cursor-color", "cursor-colour" },
	{ NULL, NULL }
};
const struct options_table_entry options_table[] = {
	{ .name = "bell-action", /* a comment */
	  .type = OPTIONS_TABLE_CHOICE,
	  .scope = OPTIONS_TABLE_SESSION,
	  .choices = options_table_bell_action_list,
	  .default_num = ALERT_ANY,
	  .text = "Action to take on a "
		  "bell alert."
	},
	{ .name = "history-limit",
	  .type = OPTIONS_TABLE_NUMBER,
	  .scope = OPTIONS_TABLE_SESSION,
	  .minimum = 0,
	  .maximum = INT_MAX,
	  .default_num = 2000,
	  .unit = "lines",
	},
	{ .name = "cursor-colour",
	  .type = OPTIONS_TABLE_COLOUR,
	  .scope = OPTIONS_TABLE_WINDOW|OPTIONS_TABLE_PANE,
	  .default_num = -1,
	},
	{ .name = "prefix",
	  .type = OPTIONS_TABLE_KEY,
	  .scope = OPTIONS_TABLE_SESSION,
	  .default_num = 'b'|KEYC_CTRL,
	},
	OPTIONS_TABLE_HOOK("session-created", ""),
	OPTIONS_TABLE_PANE_HOOK("pane-died", ""),
	{ .name = NULL }
};
`
const header = '#define ALERT_ANY 1\n#define KEYC_CTRL 0x00200000000000ULL\n'

describe('C table extraction', () => {
  const symbols = parseSymbols(header)

  it('reads types, scopes, defaults, ranges and choices from the option table', () => {
    const { entries, aliases } = parseOptionsTable(options, symbols)
    const byName = new Map(entries.map((entry) => [entry.name, entry]))
    expect(byName.get('bell-action')).toMatchObject({ type: 'choice', scope: ['session'], choices: ['none', 'any', 'current', 'other'],
      defaultNumber: 1, text: 'Action to take on a bell alert.' })
    expect(byName.get('history-limit')).toMatchObject({ minimum: 0, maximum: 2147483647, unit: 'lines', defaultNumber: 2000 })
    expect(byName.get('cursor-colour')).toMatchObject({ scope: ['window', 'pane'], defaultNumber: -1 })
    expect(byName.get('prefix')).toMatchObject({ defaultKey: 'C-b' })
    expect(byName.get('session-created')).toMatchObject({ scope: ['session'], flags: ['is_array', 'is_hook'] })
    expect(byName.get('pane-died')).toMatchObject({ scope: ['window', 'pane'] })
    expect(aliases).toEqual([{ alias: 'cursor-color', name: 'cursor-colour' }])
    expect(entries.find((entry) => entry.name === 'bell-action')!.line).toBe(byName.get('bell-action')!.line)
  })

  it('refuses a cell it cannot resolve instead of guessing', () => {
    const broken = options.replace('ALERT_ANY', 'ALERT_UNKNOWN')
    expect(() => parseOptionsTable(broken, symbols)).toThrow(/Unresolved C symbol: ALERT_UNKNOWN/)
    expect(() => parseOptionsTable(options.replace('options_table_bell_action_list,', 'options_table_missing_list,'), symbols)).toThrow(/Unknown choice list/)
    expect(parseChoiceLists(options).get('options_table_bell_action_list')).toHaveLength(4)
  })

  it('reads the callback table and which object each callback needs', () => {
    const source = `
static void *format_cb_pane_id(struct format_tree *ft) { if (ft->wp != NULL) return (NULL); return (NULL); }
static void *format_cb_host(struct format_tree *ft) { return (NULL); }
static const struct format_table_entry format_table[] = {
	{ "host", FORMAT_TABLE_STRING, format_cb_host },
	{ "pane_id", FORMAT_TABLE_STRING, format_cb_pane_id },
	{ "buffer_created", FORMAT_TABLE_TIME, format_cb_pane_id },
};`
    expect(parseFormatTable(source).map(({ name, valueType }) => [name, valueType])).toEqual([['host', 'string'], ['pane_id', 'string'], ['buffer_created', 'time']])
    expect([...callbackContexts(source)]).toEqual([['format_cb_pane_id', 'pane'], ['format_cb_host', 'server']])
  })

  it('finds hooks fired by literal notification and queue calls, and ignores non-literal names', () => {
    const sites = collectHookSites([['window.c', 'void f(void) {\n\tnotify_window("window-renamed", w);\n\tnotify_window(name, w);\n\tcmdq_insert_hook(s, item, fs,\n\t    "command-error");\n}']])
    expect([...sites]).toEqual([
      ['window-renamed', [{ file: 'window.c', line: 2, call: 'notify_window' }]],
      ['command-error', [{ file: 'window.c', line: 5, call: 'cmdq_insert_hook' }]],
    ])
  })

  it('shares one manual description between consecutive entries with no text of their own', () => {
    const html = `<section><h2 id="OPTIONS">OPTIONS</h2><dl class="Bl-tag">
      <dt><code class="Ic">main-pane-height</code> <var class="Ar">height</var></dt><dd>&nbsp;</dd>
      <dt><code class="Ic">main-pane-width</code> <var class="Ar">width</var></dt><dd>Set the size of the main pane.</dd></dl></section>
      <section><h2 id="HOOKS">HOOKS</h2></section>`
    const manual = parseManualCatalog(html, new Set())
    expect(manual.options.get('main-pane-height')!.html).toBe('Set the size of the main pane.')
    expect(manual.options.get('main-pane-width')!.html).toBe('Set the size of the main pane.')
  })
})

describe.each(pins.versions)('committed catalog for tmux $version', (pin) => {
  const model = tmuxCatalog(pin.version)
  const manualData = JSON.parse(readFileSync(new URL(`../src/data/tmux/${pin.version}.json`, import.meta.url), 'utf8'))

  it('matches its pin, the manual snapshot and the shape the pages read', () => {
    expect(verifyCatalog(model, pin, manualData)).toEqual([])
    expect(model.counts.option + model.counts.hook + model.counts.format).toBe(model.entries.length)
  })

  it.each([
    ['a duplicated entry', (copy: typeof model) => { copy.entries.push(copy.entries[0]) }, /duplicate|out of order/],
    ['an entry without a source line', (copy: typeof model) => { delete (copy.entries[0] as { source?: unknown }).source }, /no source location|no source/],
    ['a count that disagrees with the entries', (copy: typeof model) => { copy.counts.hook++ }, /hook count/],
    ['a manual digest from another release', (copy: typeof model) => { copy.manualSha256 = '0'.repeat(64) }, /manualSha256/],
    ['entries out of order', (copy: typeof model) => { copy.entries.reverse() }, /out of order/],
  ])('refuses %s', (_label, mutate, pattern) => {
    const copy = structuredClone(model)
    mutate(copy)
    expect(verifyCatalog(copy, pin, manualData).join('\n')).toMatch(pattern)
  })

  it.skipIf(!existsSync(join(TMUX_SOURCE, '.git')))('is what the source at the pinned commit produces, and a changed default is stale', () => {
    const { model: regenerated } = catalogForRelease({ source: TMUX_SOURCE, version: pin.version, revision: pin.revision, manualData })
    const committed = JSON.stringify(model, null, 2)
    expect(JSON.stringify(regenerated, null, 2)).toBe(committed)
    const stale = structuredClone(model)
    const option = stale.entries.find((entry) => entry.kind === 'option' && entry.default !== undefined)!
    option.default = `${option.default}x`
    expect(JSON.stringify(regenerated, null, 2)).not.toBe(JSON.stringify(stale, null, 2))
  }, 120_000)
})

describe('catalog data across releases', () => {
  it('carries the facts a reader looks for', () => {
    const option = tmuxCatalogEntry('3.7c', 'option', 'destroy-unattached')!
    expect(option).toMatchObject({ scope: ['session'], type: 'choice', default: 'off', choices: ['off', 'on', 'keep-last', 'keep-group'] })
    expect(option.source.file).toBe('options-table.c')
    expect(tmuxCatalogEntry('3.7c', 'option', 'history-limit')).toMatchObject({ unit: 'lines', minimum: 0, maximum: 2147483647, default: 2000 })
    expect(tmuxCatalogEntry('3.7c', 'option', 'prefix')!.default).toBe('C-b')
    expect(tmuxCatalogEntry('3.7c', 'option', 'cursor-color')!.name).toBe('cursor-colour')
    const hook = tmuxCatalogEntry('3.7c', 'hook', 'after-new-session')!
    expect(hook).toMatchObject({ scope: ['session'], after: 'new-session' })
    expect(hook.firedFrom!.map((site) => site.file)).toContain('cmd-new-session.c')
    expect(tmuxCatalogEntry('3.7c', 'hook', 'pane-mode-changed')).toMatchObject({ scope: ['window', 'pane'], descriptionSource: 'control-mode', notification: '%pane-mode-changed' })
    expect(tmuxCatalogEntry('3.7c', 'format', 'session_name')).toMatchObject({ alias: '#S', scope: ['session'], type: 'string' })
    expect(tmuxCatalogEntry('3.7c', 'format', 'popup_width')!.source.file).toBe('cmd-display-menu.c')
    expect(tmuxCatalogEntry('3.7c', 'format', 'buffer_created')!.type).toBe('time')
  })

  it('reports where an entry exists and what changed between the pinned releases', () => {
    const history = tmuxCatalogHistory('option', 'destroy-unattached')
    expect(history.map((release) => release.version)).toEqual(['3.2a', '3.7c'])
    expect(history[1].changes.map(tmuxCatalogChangeText)).toEqual(['type flag to choice', 'values now off, on, keep-last, keep-group'])
    expect(tmuxCatalogHistory('option', 'escape-time')[1].changes.map(tmuxCatalogChangeText)).toEqual(['default 500 to 10', 'unit now milliseconds'])
    expect(tmuxCatalogHistory('option', 'repeat-time')[1].changes.map(tmuxCatalogChangeText)).toEqual(['maximum 32767 to 2000000'])
    expect(tmuxCatalogHistory('hook', 'client-active').map((release) => release.present)).toEqual([false, true])
    expect(tmuxCatalogEntry('3.2a', 'hook', 'client-active')).toBeUndefined()
    expect(tmuxCatalogVersionUrl('3.2a', 'hook', 'client-active')).toMatch(/\/tmux\/3\.2a\/catalog\/hooks\/$/)
  })

  it('builds one route per entry and an index and section page for each release', () => {
    const routes = tmuxCatalogRoutes()
    for (const version of ['latest', '3.7c', '3.2a']) {
      const own = routes.filter((route) => route.version === version)
      const model = tmuxCatalog(version)
      expect(own.filter((route) => route.slug?.includes('/'))).toHaveLength(model.entries.length)
      expect(own.filter((route) => !route.slug?.includes('/')).map((route) => route.slug)).toEqual([undefined, 'options', 'hooks', 'formats'])
    }
    expect(new Set(routes.map((route) => `${route.version}/${route.slug}`)).size).toBe(routes.length)
    expect(catalogKindForSegment('hooks')).toBe('hook')
    expect(catalogKindForSegment('nonsense')).toBeUndefined()
  })

  it('places every entry in the tree once and finds it by name, short form or description', () => {
    for (const version of ['3.2a', '3.7c']) {
      const { tree, json } = tmuxCatalogNavigation(version)
      const placed = tree.flatMap((bucket) => bucket.children.flatMap((child) => child.entries.map((entry) => entry.id)))
      expect(placed.toSorted()).toEqual(tmuxCatalogEntries(version).map((entry) => `${entry.kind}.${entry.name}`).toSorted())
      expect(new Set(placed).size).toBe(placed.length)
      expect(searchApi(json, 'destroy-unattached')[0].slug).toBe('options/destroy-unattached')
      expect(searchApi(json, 'session_attached', 'formats')[0].slug).toBe('formats/session_attached')
      expect(searchApi(json, '#S', 'formats').map((entry) => entry.slug)).toContain('formats/session_name')
    }
  })

  it('previews an entry from the same record as its page', async () => {
    const preview = tmuxCatalogPreview('3.7c', tmuxCatalogEntry('3.7c', 'option', 'destroy-unattached')!)
    expect(preview).toMatchObject({ title: 'destroy-unattached', kind: 'option', href: tmuxCatalogUrl('3.7c', 'option', 'destroy-unattached') })
    expect(preview.detail).toContain('default off')
    expect((await highlightedPreview(preview)).signatureHighlight?.lines.length).toBeGreaterThan(0)
  })

  it('offers a card for entry pages only, at the entry preview endpoint', () => {
    const policy = createLinkPreviewPolicy()
    const origin = 'https://libtmux.org'
    expect(policy.target('/en/tmux/3.7c/catalog/options/status-left/', origin)?.endpoint).toBe('/en/tmux/3.7c/catalog/options/status-left.preview.json')
    expect(policy.target('/pr-4/en/tmux/latest/catalog/hooks/session-created/', origin)?.endpoint).toBe('/pr-4/en/tmux/latest/catalog/hooks/session-created.preview.json')
    for (const path of ['/en/tmux/latest/catalog/', '/en/tmux/latest/catalog/options/', '/en/tmux/latest/catalog/options/status-left/x/']) {
      expect(policy.target(path, origin), path).toBeUndefined()
    }
  })

  it('points each entry at the C declarations behind it', () => {
    const reference = (kind: 'option' | 'hook' | 'format', name: string) =>
      tmuxCatalogReferences('3.7c', tmuxCatalogEntry('3.7c', kind, name)!).map((link) => link.name)
    expect(reference('option', 'status-left')).toEqual(['options_table'])
    expect(reference('hook', 'session-created')).toEqual(['options_table', 'notify_session'])
    expect(reference('format', 'session_name')).toEqual(['format_cb_session_name'])
  })

  it('anchors every entry in the manual page it names', () => {
    for (const version of ['3.2a', '3.7c']) {
      const tree = fromHtml(linkTmuxManualEntries(tmuxManual(version).manual), { fragment: true })
      const ids = new Set(selectAll('[id]', tree).map((node) => String(node.properties.id)))
      const missing = tmuxCatalogEntries(version).flatMap((entry) => entry.manual && !ids.has(entry.manual.anchor) ? [`${entry.kind}/${entry.name}:${entry.manual.anchor}`] : [])
      expect(missing).toEqual([])
    }
  })
})

