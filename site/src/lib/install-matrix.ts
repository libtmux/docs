/**
 * MCP install picker data: client x method x scope x cooldown matrix, and
 * the CSS/JS needed to select one cell before first paint.
 *
 * Ported from ~/work/python/libtmux-mcp/docs/_ext/widgets/mcp_install.py
 * (data + panel bodies) and .../_prehydrate.py (the flash-of-wrong-selection
 * fix). Both lived as separate Python modules there; here they are one file
 * because this repo has no `_ext`-style extension package — McpInstall.astro
 * is the only consumer and imports what it needs.
 *
 * This module is the SINGLE source of truth, which fixes a real bug in the
 * source: widget.js hand-duplicated a `DEFAULT_SCOPES` literal ("small
 * enough that keeping them in sync beats reading it back out of the DOM")
 * that had 7 entries when mcp_install.py's CLIENTS tuple had 8 — the
 * `opencode` client was missing, so switching to it would set no
 * `data-mcp-install-scope` and the panel would render blank. McpInstall.astro
 * threads DEFAULT_SCOPES and the three cooldown defaults onto the widget's
 * root element as `data-default-*` JSON/string attributes instead, so
 * mcp-install.js reads them rather than re-declaring them.
 *
 * Two more inherited inaccuracies, corrected here rather than carried
 * forward as comments:
 *   - mcp_install.py's own docstring claims "117 server-rendered panels...
 *     13 scopes". The actual CLIENTS tuple (8 clients) sums to 14 scopes;
 *     14 * 3 methods * 3 cooldowns = 126 panels. The 117/13 figures predate
 *     `opencode` being added and were never updated.
 *   - Both mcp_install.py's docstring and widget.js's header claim "uvx and
 *     pip days bodies embed a duration slot". Reading `_tool_command` /
 *     `_pip_prereq_for` shows only uvx ever does — pipx and pip always emit
 *     the bare command and rely on `_cooldown_note` to redirect the reader
 *     to uvx. `toolCommand` below matches the code, not the prose.
 */

// ---- types --------------------------------------------------------------

/** One config-scope option for a client (e.g. user / project / global). */
export interface Scope {
  id: string
  label: string
  configFile: string
  note: string | null
}

export type CooldownId = 'off' | 'days' | 'bypass'

/** One cooldown mode. */
export interface Cooldown {
  id: CooldownId
  label: string
}

/** One MCP client row in the install picker. */
export interface Client {
  id: string
  label: string
  kind: 'cli' | 'json'
  scopes: readonly Scope[]
}

export type MethodId = 'uvx' | 'pipx' | 'pip'

/** One install method (uvx / pipx / pip install). */
export interface Method {
  id: MethodId
  label: string
  docUrl: string | null
}

/** Pre-built cell for one (client, method, scope, cooldown) tuple. */
export interface Panel {
  client: Client
  method: Method
  scope: Scope
  cooldown: Cooldown
  language: 'console' | 'json' | 'toml'
  /** Command/config text, "$ "-prefixed for console panels. May contain
   *  COOLDOWN_DURATION_SENTINEL or COOLDOWN_DATE_SENTINEL — see
   *  bodySegments(). */
  body: string
  /** Prereq `pip install` line. Only set for the pip method. */
  pipPrereq: string | null
  /** Cooldown-related caveat, e.g. "pipx bypass is a no-op". */
  note: string | null
  isDefault: boolean
}

// ---- client data ----------------------------------------------------------

const CLAUDE_CODE_SCOPES: readonly Scope[] = [
  { id: 'local', label: 'Local', configFile: '~/.claude.json (this project)', note: null },
  { id: 'user', label: 'User', configFile: '~/.claude.json (all projects)', note: null },
  { id: 'project', label: 'Project', configFile: '.mcp.json (in repo, version-controlled)', note: null },
]

const CLAUDE_DESKTOP_SCOPES: readonly Scope[] = [
  { id: 'user', label: 'User', configFile: 'claude_desktop_config.json', note: null },
]

const CODEX_SCOPES: readonly Scope[] = [
  { id: 'user', label: 'User', configFile: '~/.codex/config.toml', note: null },
  {
    id: 'project',
    label: 'Project',
    configFile: '.codex/config.toml (in repo)',
    note: "Codex's CLI doesn't support project scope yet — paste this into .codex/config.toml at the repo root.",
  },
]

const GEMINI_SCOPES: readonly Scope[] = [
  { id: 'user', label: 'User', configFile: '~/.gemini/settings.json', note: null },
  { id: 'project', label: 'Project', configFile: '.gemini/settings.json (in repo)', note: null },
]

const CURSOR_SCOPES: readonly Scope[] = [
  { id: 'project', label: 'Project', configFile: '.cursor/mcp.json (in repo)', note: null },
  { id: 'global', label: 'Global', configFile: '~/.cursor/mcp.json', note: null },
]

// User scope only: `opencode mcp add` writes the global config whether or
// not a project one exists, so a Project panel would advertise a file the
// command it prints never touches.
const OPENCODE_SCOPES: readonly Scope[] = [
  { id: 'user', label: 'User', configFile: '~/.config/opencode/opencode.jsonc', note: null },
]

const GROK_SCOPES: readonly Scope[] = [
  { id: 'user', label: 'User', configFile: '~/.grok/config.toml', note: null },
  { id: 'project', label: 'Project', configFile: './.grok/config.toml (in repo)', note: null },
]

const ANTIGRAVITY_SCOPES: readonly Scope[] = [
  { id: 'global', label: 'Global', configFile: '~/.gemini/config/mcp_config.json', note: null },
]

export const CLIENTS: readonly Client[] = [
  { id: 'claude-code', label: 'Claude Code', kind: 'cli', scopes: CLAUDE_CODE_SCOPES },
  { id: 'claude-desktop', label: 'Claude Desktop', kind: 'json', scopes: CLAUDE_DESKTOP_SCOPES },
  { id: 'codex', label: 'Codex CLI', kind: 'cli', scopes: CODEX_SCOPES },
  { id: 'gemini', label: 'Gemini CLI', kind: 'cli', scopes: GEMINI_SCOPES },
  { id: 'cursor', label: 'Cursor', kind: 'json', scopes: CURSOR_SCOPES },
  { id: 'grok', label: 'Grok CLI', kind: 'cli', scopes: GROK_SCOPES },
  { id: 'antigravity', label: 'Antigravity', kind: 'json', scopes: ANTIGRAVITY_SCOPES },
  { id: 'opencode', label: 'opencode', kind: 'cli', scopes: OPENCODE_SCOPES },
]

export const METHODS: readonly Method[] = [
  { id: 'uvx', label: 'uvx', docUrl: 'https://docs.astral.sh/uv/' },
  { id: 'pipx', label: 'pipx', docUrl: 'https://pipx.pypa.io/' },
  { id: 'pip', label: 'pip install', docUrl: null },
]

export const COOLDOWNS: readonly Cooldown[] = [
  { id: 'off', label: 'Off' },
  { id: 'days', label: 'Apply a cooldown' },
  { id: 'bypass', label: 'Bypass global cooldown' },
]

/** Default scope per client — the first entry of each client's scopes. */
export const DEFAULT_SCOPES: Readonly<Record<string, string>> = Object.fromEntries(
  CLIENTS.map((client) => [client.id, client.scopes[0]!.id]),
)

export const DEFAULT_COOLDOWN_ENABLED = false
export const DEFAULT_COOLDOWN_TYPE: 'days' | 'bypass' = 'days'
export const DEFAULT_COOLDOWN_DAYS = 7

export const PIP_PREREQ_OFF = 'pip install --user --upgrade libtmux libtmux-mcp'

// Two sentinels swapped for <span data-cooldown-*-slot> elements at render
// time (see bodySegments). Pygments doesn't exist on this side, so unlike
// _base.py's cooldown_days_slot filter (which swaps post-escape text), the
// swap here happens on the plain-text body before it ever reaches markup.
export const COOLDOWN_DURATION_SENTINEL = '<COOLDOWN_DURATION>'
export const COOLDOWN_DATE_SENTINEL = '<COOLDOWN_DATE>'

/**
 * ISO date for "today (UTC) - days". Build-time default for the date slot
 * so the server-rendered snippet shows a valid date before hydration; JS
 * recomputes it on every load and every days-input change.
 */
export function defaultCooldownDate(days: number): string {
  const cutoffMs = Date.now() - days * 86_400_000
  return new Date(cutoffMs).toISOString().slice(0, 10)
}

// ---- panel body builders ---------------------------------------------

/**
 * Build the inner `<tool> [flags] libtmux-mcp` command — the portion of
 * every CLI panel after the `mcp add ... --` separator, and the same
 * string used for the JSON `command` + `args` pair.
 *
 * Only uvx's `days` branch ever carries a cooldown flag. pipx's pip
 * backend and pip itself have no per-package cooldown override, so their
 * bodies stay bare in every cooldown mode; `cooldownNote` redirects the
 * reader to uvx instead of pretending a flag exists.
 */
function toolCommand(method: Method, cooldown: Cooldown): string {
  if (method.id === 'uvx') {
    if (cooldown.id === 'days') {
      // `--exclude-newer-package libtmux-mcp=2099-01-01` exempts
      // libtmux-mcp itself from the global cutoff so a recently-released
      // libtmux-mcp stays installable inside the resolver.
      return (
        `uvx --exclude-newer ${COOLDOWN_DURATION_SENTINEL}` +
        ' --exclude-newer-package libtmux-mcp=2099-01-01' +
        ' libtmux-mcp'
      )
    }
    if (cooldown.id === 'bypass') return 'uvx --no-config libtmux-mcp'
    return 'uvx libtmux-mcp'
  }
  if (method.id === 'pipx') return 'pipx run libtmux-mcp'
  // pip: register step only, no args.
  return 'libtmux-mcp'
}

/** Build the full shell command for a CLI-kind client. */
function cliBody(client: Client, scope: Scope, method: Method, cooldown: Cooldown): string {
  const toolCmd = toolCommand(method, cooldown)
  if (client.id === 'gemini') {
    // gemini's `--` separator lands after the tool token, not before.
    const spaceIndex = toolCmd.indexOf(' ')
    if (spaceIndex !== -1) {
      const head = toolCmd.slice(0, spaceIndex)
      const tail = toolCmd.slice(spaceIndex + 1)
      return `gemini mcp add --scope ${scope.id} tmux ${head} -- ${tail}`
    }
    return `gemini mcp add --scope ${scope.id} tmux ${toolCmd}`
  }
  if (client.id === 'claude-code') {
    const flag = scope.id === 'local' ? '' : `--scope ${scope.id} `
    // The source's `.replace("  ", " ")` here is defensive: no combination
    // of flag/tool_cmd actually produces a double space (verified by
    // construction — `flag` always ends in 0 or 1 trailing space and the
    // template supplies exactly one separator either way). Kept for parity
    // with the source rather than dropped as dead code.
    return `claude mcp add tmux ${flag}-- ${toolCmd}`.replace(/ {2}/g, ' ')
  }
  if (client.id === 'grok') {
    // grok writes both scopes itself (~/.grok/config.toml or
    // ./.grok/config.toml, same TOML shape as Codex), so unlike Codex no
    // manual-paste path is needed for project scope.
    return `grok mcp add --scope ${scope.id} tmux -- ${toolCmd}`
  }
  if (client.id === 'opencode') {
    return `opencode mcp add tmux -- ${toolCmd}`
  }
  // codex: CLI doesn't write project scope; that panel uses tomlBody instead
  // (see bodyFor).
  return `codex mcp add tmux -- ${toolCmd}`
}

const JSON_INDENT = '    '

/** Build the JSON config snippet shared by Claude Desktop and Cursor. */
function jsonBody(method: Method, cooldown: Cooldown): string {
  let command: string
  let args: string | null
  if (method.id === 'uvx') {
    command = 'uvx'
    args =
      cooldown.id === 'days'
        ? `"--exclude-newer", "${COOLDOWN_DURATION_SENTINEL}", "--exclude-newer-package", "libtmux-mcp=2099-01-01", "libtmux-mcp"`
        : '"libtmux-mcp"'
  } else if (method.id === 'pipx') {
    command = 'pipx'
    args = '"run", "libtmux-mcp"'
  } else {
    command = 'libtmux-mcp'
    args = null
  }

  // Explicit per-line indents rather than a dedent-after-interpolation
  // pattern: substituting `args` at a smaller indent than the surrounding
  // template breaks a post-hoc dedent for every member after the first.
  const serverIndent = JSON_INDENT.repeat(3)
  const serverLines = [`${serverIndent}"command": "${command}"`]
  if (args !== null) serverLines.push(`${serverIndent}"args": [${args}]`)
  if (cooldown.id === 'bypass' && method.id === 'uvx') {
    serverLines.push(`${serverIndent}"env": { "UV_NO_CONFIG": "1" }`)
  }
  const serverBlock = serverLines.join(',\n')
  return (
    '{\n' +
    `${JSON_INDENT}"mcpServers": {\n` +
    `${JSON_INDENT.repeat(2)}"tmux": {\n` +
    `${serverBlock}\n` +
    `${JSON_INDENT.repeat(2)}}\n` +
    `${JSON_INDENT}}\n` +
    '}'
  )
}

/** Build the TOML snippet for Codex's project scope (manual paste). */
function tomlBody(method: Method, cooldown: Cooldown): string {
  let command: string
  let argsInner: string | null
  if (method.id === 'uvx') {
    command = 'uvx'
    argsInner =
      cooldown.id === 'days'
        ? `"--exclude-newer", "${COOLDOWN_DURATION_SENTINEL}", "--exclude-newer-package", "libtmux-mcp=2099-01-01", "libtmux-mcp"`
        : '"libtmux-mcp"'
  } else if (method.id === 'pipx') {
    command = 'pipx'
    argsInner = '"run", "libtmux-mcp"'
  } else {
    command = 'libtmux-mcp'
    argsInner = null
  }
  const lines = ['[mcp_servers.tmux]', `command = "${command}"`]
  if (argsInner !== null) lines.push(`args = [${argsInner}]`)
  if (cooldown.id === 'bypass' && method.id === 'uvx') lines.push('env = { UV_NO_CONFIG = "1" }')
  return lines.join('\n')
}

/** One-line caveat for cells whose snippet doesn't actually enforce cooldown. */
function cooldownNote(method: Method, cooldown: Cooldown): string | null {
  if ((method.id === 'pipx' || method.id === 'pip') && (cooldown.id === 'days' || cooldown.id === 'bypass')) {
    return (
      'pip has no per-package cooldown override, so this snippet runs without cooldown enforcement. ' +
      'Switch to the uvx tab — it applies the cooldown to transitive deps via `--exclude-newer` while ' +
      'exempting libtmux-mcp itself via `--exclude-newer-package`.'
    )
  }
  return null
}

interface RawBody {
  body: string
  language: Panel['language']
  note: string | null
}

/**
 * Codex's `project` scope is the one cell that escapes its client's normal
 * kind — it emits TOML because the Codex CLI doesn't write `project` scope.
 */
function bodyFor(client: Client, method: Method, scope: Scope, cooldown: Cooldown): RawBody {
  const note = cooldownNote(method, cooldown)
  if (client.id === 'codex' && scope.id === 'project') {
    return { body: tomlBody(method, cooldown), language: 'toml', note }
  }
  if (client.kind === 'json') {
    return { body: jsonBody(method, cooldown), language: 'json', note }
  }
  return { body: cliBody(client, scope, method, cooldown), language: 'console', note }
}

/** Pre-compute every legal (client, method, scope, cooldown) panel. */
export function buildPanels(): Panel[] {
  const panels: Panel[] = []
  CLIENTS.forEach((client, clientIndex) => {
    METHODS.forEach((method, methodIndex) => {
      client.scopes.forEach((scope, scopeIndex) => {
        COOLDOWNS.forEach((cooldown, cooldownIndex) => {
          const raw = bodyFor(client, method, scope, cooldown)
          const body = raw.language === 'console' ? `$ ${raw.body}` : raw.body
          panels.push({
            client,
            method,
            scope,
            cooldown,
            language: raw.language,
            body,
            pipPrereq: method.id === 'pip' ? PIP_PREREQ_OFF : null,
            note: raw.note,
            isDefault: clientIndex === 0 && methodIndex === 0 && scopeIndex === 0 && cooldownIndex === 0,
          })
        })
      })
    })
  })
  return panels
}

// ---- rendering helpers ----------------------------------------------------

export type BodySegment = { kind: 'text'; value: string } | { kind: 'duration-slot' } | { kind: 'date-slot' }

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SENTINEL_PATTERN = new RegExp(
  `${escapeRegExp(COOLDOWN_DURATION_SENTINEL)}|${escapeRegExp(COOLDOWN_DATE_SENTINEL)}`,
  'g',
)

/**
 * Split a panel body into plain text and slot markers, for the template to
 * turn into text nodes and `<span data-cooldown-*-slot>` elements. Mirrors
 * `cooldown_days_slot` in _base.py, but operating on plain text instead of
 * post-Pygments HTML — there is no highlighter on this side of the port.
 */
export function bodySegments(body: string): BodySegment[] {
  const segments: BodySegment[] = []
  let lastIndex = 0
  for (const match of body.matchAll(SENTINEL_PATTERN)) {
    const index = match.index
    if (index > lastIndex) segments.push({ kind: 'text', value: body.slice(lastIndex, index) })
    segments.push({ kind: match[0] === COOLDOWN_DURATION_SENTINEL ? 'duration-slot' : 'date-slot' })
    lastIndex = index + match[0].length
  }
  if (lastIndex < body.length) segments.push({ kind: 'text', value: body.slice(lastIndex) })
  return segments
}

// ---- prehydrate: avoid a flash of the wrong selection ---------------------
//
// The widget's SSR HTML always marks the first client/method/scope tab
// active and shows only the `isDefault` panel. McpInstall.astro's own
// script (mcp-install.js) reads localStorage and restores the saved
// selection — a visible flash on first paint if that runs after paint,
// which for a bundled/deferred script it always does.
//
// buildMcpInstallPrehydrateSnippet() returns a `<style>` + a plain
// (non-module, unbundled) `<script>` that copies the saved selection from
// localStorage onto `<html>` as `data-mcp-install-*` attributes and colors
// tabs / shows the matching panel from those attributes alone — before
// mcp-install.js has even downloaded. McpInstall.astro injects the
// returned string with `set:html` specifically so it lands as literal
// HTML: a real `<script>` node in the template would be compiled as a
// deferred module by Astro, which defeats the entire point of running
// before paint.
//
// Unlike _prehydrate.py, none of this needs `!important` or `@layer`. That
// machinery existed there to beat Tailwind preflight's
// `[hidden]:where(...) { display: none !important }` inside `@layer base`
// — CSS Cascade Layers reverses priority for `!important` declarations, so
// an unlayered override loses to it regardless of specificity. This port
// never puts the `hidden` attribute on a panel (see McpInstall.astro), so
// that rule never matches our elements and there is nothing to out-rank:
// plain specificity (attribute-selector rules below are more specific than
// mcp-install.css's un-attributed base rules) resolves every override.

function tabActiveSelectors(kind: 'client' | 'method', ids: readonly string[]): string {
  return ids
    .map(
      (id) =>
        `html[data-mcp-install-${kind}="${id}"] .lm-mcp-install__tab[data-tab-kind="${kind}"][data-tab-value="${id}"]`,
    )
    .join(',')
}

function scopeTabActiveSelectors(): string {
  const parts: string[] = []
  for (const client of CLIENTS) {
    for (const scope of client.scopes) {
      parts.push(
        `html[data-mcp-install-client="${client.id}"][data-mcp-install-scope="${scope.id}"] ` +
          `.lm-mcp-install__tab[data-tab-kind="scope"][data-tab-client="${client.id}"][data-tab-value="${scope.id}"]`,
      )
    }
  }
  return parts.join(',')
}

/** One rule per client that has a scope group rendered (scopes.length > 1). */
function scopeGroupVisibleSelectors(): string {
  return CLIENTS.filter((c) => c.scopes.length > 1)
    .map((c) => `html[data-mcp-install-client="${c.id}"] .lm-mcp-install__scopes-group[data-scope-client="${c.id}"]`)
    .join(',')
}

/**
 * One selector per legal (client, method, scope, cooldown-state) tuple.
 * Cooldown state is the (enabled, type) pair: enabled=0 shows the "off"
 * panel regardless of saved type; enabled=1 shows "days" or "bypass"
 * depending on type. 14 scopes * 3 methods * 3 states = 126 selectors.
 */
function panelActiveSelectors(): string {
  const selectors: string[] = []
  for (const client of CLIENTS) {
    for (const method of METHODS) {
      for (const scope of client.scopes) {
        const htmlAttrs =
          `[data-mcp-install-client="${client.id}"]` +
          `[data-mcp-install-method="${method.id}"]` +
          `[data-mcp-install-scope="${scope.id}"]`
        const panel =
          ` .lm-mcp-install__panel[data-client="${client.id}"][data-method="${method.id}"][data-scope="${scope.id}"]`
        selectors.push(`html[data-mcp-install-cooldown-enabled="0"]${htmlAttrs}${panel}[data-cooldown="off"]`)
        selectors.push(
          `html[data-mcp-install-cooldown-enabled="1"][data-mcp-install-cooldown-type="days"]${htmlAttrs}${panel}[data-cooldown="days"]`,
        )
        selectors.push(
          `html[data-mcp-install-cooldown-enabled="1"][data-mcp-install-cooldown-type="bypass"]${htmlAttrs}${panel}[data-cooldown="bypass"]`,
        )
      }
    }
  }
  return selectors.join(',')
}

// Deactivated tabs: any tab still carrying the SSR `aria-selected="true"`
// once `<html>` has been tagged (i.e. every page load once JS has run)
// repaints muted, regardless of which one the browser thinks is selected.
// The matching "active" rule below wins the specificity tie on the one tab
// that is genuinely still selected, by coming later in the stylesheet.
const TAB_DEACTIVATE_RULE =
  'html[data-mcp-install-client] .lm-mcp-install__tab[data-tab-kind="client"][aria-selected="true"],' +
  'html[data-mcp-install-method] .lm-mcp-install__tab[data-tab-kind="method"][aria-selected="true"],' +
  'html[data-mcp-install-scope] .lm-mcp-install__tab[data-tab-kind="scope"][aria-selected="true"]' +
  '{color:var(--lm-mcp-install-fg-muted);border-bottom-color:transparent;background:transparent}'

const TAB_ACTIVE_DECL =
  '{color:var(--lm-mcp-install-accent);border-bottom-color:var(--lm-mcp-install-accent);background:var(--lm-mcp-install-bg)}'

const SCOPE_GROUP_ACTIVE_DECL = '{display:flex}'

// The default panel (mcp-install.css shows it via `[data-default]` for the
// no-JS case) needs an explicit override once `<html>` carries a client
// attribute at all — otherwise its own more-specific-than-base rule would
// keep it visible even after a different combination becomes active.
const PANEL_DEFAULT_OVERRIDE_RULE = 'html[data-mcp-install-client] .lm-mcp-install__panel[data-default]{display:none}'

const PANEL_ACTIVE_DECL = '{display:block}'

// The checkbox's *checked* visual only — the unchecked baseline lives in
// mcp-install.css since it doesn't depend on `<html>` state. A native
// checkbox's rendered glyph follows its `.checked` DOM property, which
// only mcp-install.js can set (after DOMContentLoaded), so without this
// the box would flip unchecked -> checked on every reload where cooldown
// was previously enabled.
const COOLDOWN_TOGGLE_CHECKED_RULES =
  'html[data-mcp-install-cooldown-enabled="1"] .lm-mcp-install__cooldown-toggle' +
  '{background:var(--lm-mcp-install-accent);border-color:var(--lm-mcp-install-accent)}' +
  'html[data-mcp-install-cooldown-enabled="1"] .lm-mcp-install__cooldown-toggle::after' +
  '{content:"\\2713";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
  'color:#fff;font-size:0.85em;font-weight:700;line-height:1}'

function buildPrehydrateStyle(): string {
  const clientIds = CLIENTS.map((c) => c.id)
  const methodIds = METHODS.map((m) => m.id)
  const rules = [
    TAB_DEACTIVATE_RULE,
    tabActiveSelectors('client', clientIds) + TAB_ACTIVE_DECL,
    tabActiveSelectors('method', methodIds) + TAB_ACTIVE_DECL,
    scopeTabActiveSelectors() + TAB_ACTIVE_DECL,
    scopeGroupVisibleSelectors() + SCOPE_GROUP_ACTIVE_DECL,
    PANEL_DEFAULT_OVERRIDE_RULE,
    panelActiveSelectors() + PANEL_ACTIVE_DECL,
    COOLDOWN_TOGGLE_CHECKED_RULES,
  ]
  return `<style>${rules.join('')}</style>`
}

// Storage keys are namespaced to this site rather than the source's
// "libtmux-mcp." prefix — that prefix named the widget's *origin* project
// (the libtmux-mcp Python docs), not this one. localStorage is
// origin-scoped regardless, so this is a naming choice, not a fix.
export const STORAGE_PREFIX = 'libtmux-docs.mcp-install'

function buildPrehydrateScript(): string {
  const defaults = JSON.stringify(DEFAULT_SCOPES)
  const enabledDefault = DEFAULT_COOLDOWN_ENABLED ? '1' : '0'
  return (
    '<script data-cfasync="false">(function(){' +
    'try{' +
    'var h=document.documentElement;' +
    `var d=${defaults};` +
    `var c=localStorage.getItem("${STORAGE_PREFIX}.client")||"${CLIENTS[0]!.id}";` +
    `var m=localStorage.getItem("${STORAGE_PREFIX}.method")||"${METHODS[0]!.id}";` +
    `var s=localStorage.getItem("${STORAGE_PREFIX}.scope."+c)||d[c];` +
    `var ce=localStorage.getItem("${STORAGE_PREFIX}.cooldown.enabled")||"${enabledDefault}";` +
    `var ct=localStorage.getItem("${STORAGE_PREFIX}.cooldown.type")||"${DEFAULT_COOLDOWN_TYPE}";` +
    `var cd=localStorage.getItem("${STORAGE_PREFIX}.cooldown.days")||"${DEFAULT_COOLDOWN_DAYS}";` +
    'if(c)h.setAttribute("data-mcp-install-client",c);' +
    'if(m)h.setAttribute("data-mcp-install-method",m);' +
    'if(s)h.setAttribute("data-mcp-install-scope",s);' +
    'h.setAttribute("data-mcp-install-cooldown-enabled",ce);' +
    'h.setAttribute("data-mcp-install-cooldown-type",ct);' +
    'h.setAttribute("data-mcp-install-cooldown-days",cd);' +
    '}catch(_){}' +
    '})();</script>'
  )
}

/** Full prehydrate `<style>` + `<script>`, for McpInstall.astro to inject with `set:html`. */
export function buildMcpInstallPrehydrateSnippet(): string {
  return buildPrehydrateStyle() + buildPrehydrateScript()
}
