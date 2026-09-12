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

/** One way to obtain and run a port's server (uvx, npx, cargo install, ...). */
export interface Method {
  id: string
  label: string
  docUrl: string | null
}

/**
 * What a client is told to launch, for one (method, cooldown) pair.
 *
 * Structured rather than a string, because the same facts are rendered three
 * ways: a shell command, a JSON `command`/`args`/`env` triple, and Codex's
 * TOML. Building the shell line first and taking it apart again is what the
 * Python-only version did, and it is why the Gemini branch below had to split
 * a command at its first space.
 */
export interface ServerCommand {
  /** The executable a client runs. */
  command: string
  /** Its arguments, in order, as a command line spells them. */
  args: readonly string[]
  /**
   * The arguments a config file spells instead, where the two differ.
   *
   * They differ exactly once, and for a reason worth keeping: `uvx
   * --no-config` and `UV_NO_CONFIG=1` are the same instruction, and a shell
   * line states it as a flag while a JSON or TOML block states it as `env`.
   * Saying both would say it twice in one snippet.
   */
  configArgs?: readonly string[]
  /**
   * Environment a config file has to carry.
   *
   * Config only. A CLI client is told the same thing by `args` — `uvx
   * --no-config` is what `UV_NO_CONFIG=1` means to a command line — so
   * repeating it as an `--env` flag would say it twice and differently.
   */
  env?: Readonly<Record<string, string>>
  /** A build or install step to run before any of this works. */
  prereq?: string
  /** A caveat for this cell alone. */
  note?: string
}

/**
 * One port's MCP server, as the install picker needs to know it.
 *
 * Eight ports ship a server and no two are obtained the same way: Python has
 * uvx, pipx and pip; TypeScript runs from npx without installing anything;
 * Rust, Go and .NET install a binary; Java, C++ and Swift have no published
 * artifact at all and are built from their own source tree. The client and
 * scope axes are the same for all of them — `claude mcp add tmux -- <thing>`
 * does not care what `<thing>` is — which is why this is a per-port spec
 * rather than a per-port widget.
 *
 * `cooldowns` is Python's axis alone. It exists because uv can hold a
 * resolution back with `--exclude-newer`; npm, cargo and go have no
 * equivalent, so their specs carry the single `off` entry and the widget
 * renders no cooldown control at all.
 */
export interface ServerSpec {
  /** Port slug, as in ports.ts. */
  port: string
  /** What the server is published or built as, for the prose above the picker. */
  package: string
  methods: readonly Method[]
  cooldowns: readonly Cooldown[]
  resolve(method: Method, cooldown: Cooldown): ServerCommand
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
  /** The build or install step this cell needs first, where it needs one. */
  pipPrereq: string | null
  /** A caveat: a cooldown a method cannot honour, a path only you know. */
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

export const COOLDOWNS: readonly Cooldown[] = [
  { id: 'off', label: 'Off' },
  { id: 'days', label: 'Apply a cooldown' },
  { id: 'bypass', label: 'Bypass global cooldown' },
]

/** The single-entry axis every port but Python has. */
const NO_COOLDOWN: readonly Cooldown[] = [COOLDOWNS[0]!]

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

// ---- per-port server specs ------------------------------------------------

const PY_METHODS: readonly Method[] = [
  { id: 'uvx', label: 'uvx', docUrl: 'https://docs.astral.sh/uv/' },
  { id: 'pipx', label: 'pipx', docUrl: 'https://pipx.pypa.io/' },
  { id: 'pip', label: 'pip install', docUrl: null },
]

/** One-line caveat for cells whose snippet does not actually enforce cooldown. */
function pyCooldownNote(method: Method, cooldown: Cooldown): string | undefined {
  if ((method.id === 'pipx' || method.id === 'pip') && (cooldown.id === 'days' || cooldown.id === 'bypass')) {
    return (
      'pip has no per-package cooldown override, so this snippet runs without cooldown enforcement. ' +
      'Switch to the uvx tab — it applies the cooldown to transitive deps via `--exclude-newer` while ' +
      'exempting libtmux-mcp itself via `--exclude-newer-package`.'
    )
  }
  return undefined
}

/**
 * A server you build yourself, because nothing publishes a binary.
 *
 * Java, C++ and Swift each ship the server as source in the library's own
 * repository. There is no one-line install to print, so the honest panel is
 * the build step as a prerequisite and a path placeholder as the command —
 * the same shape all three READMEs use, and better than inventing a command
 * that would fail.
 */
function builtFromSource(prereq: string, binary: string, note: string): ServerCommand {
  return { command: binary, args: [], prereq, note }
}

/**
 * Every port's server, keyed by slug.
 *
 * Commands are taken from each port's own MCP README rather than composed
 * here; a server this repository cannot run is not a server this repository
 * should be guessing the invocation of.
 */
export const SERVERS: Readonly<Record<string, ServerSpec>> = {
  py: {
    port: 'py',
    package: 'libtmux-mcp',
    methods: PY_METHODS,
    cooldowns: COOLDOWNS,
    resolve(method, cooldown) {
      if (method.id === 'uvx') {
        if (cooldown.id === 'days') {
          // `--exclude-newer-package libtmux-mcp=2099-01-01` exempts
          // libtmux-mcp itself from the global cutoff so a recently-released
          // libtmux-mcp stays installable inside the resolver.
          return {
            command: 'uvx',
            args: [
              '--exclude-newer',
              COOLDOWN_DURATION_SENTINEL,
              '--exclude-newer-package',
              'libtmux-mcp=2099-01-01',
              'libtmux-mcp',
            ],
          }
        }
        if (cooldown.id === 'bypass') {
          return {
            command: 'uvx',
            args: ['--no-config', 'libtmux-mcp'],
            configArgs: ['libtmux-mcp'],
            env: { UV_NO_CONFIG: '1' },
          }
        }
        return { command: 'uvx', args: ['libtmux-mcp'] }
      }
      if (method.id === 'pipx') {
        return { command: 'pipx', args: ['run', 'libtmux-mcp'], note: pyCooldownNote(method, cooldown) }
      }
      return {
        command: 'libtmux-mcp',
        args: [],
        prereq: PIP_PREREQ_OFF,
        note: pyCooldownNote(method, cooldown),
      }
    },
  },
  ts: {
    port: 'ts',
    package: '@libtmux/mcp',
    methods: [
      { id: 'npx', label: 'npx', docUrl: null },
      { id: 'global', label: 'Global install', docUrl: null },
    ],
    cooldowns: NO_COOLDOWN,
    resolve(method) {
      if (method.id === 'npx') return { command: 'npx', args: ['-y', '@libtmux/mcp'] }
      return {
        command: 'libtmux-mcp',
        args: [],
        prereq: 'npm install --global @libtmux/mcp',
        note: 'The package installs a `libtmux-mcp` binary. Requires Node 22 or newer, or Bun 1.3.14 or newer.',
      }
    },
  },
  rs: {
    port: 'rs',
    package: 'tmux-mcp',
    methods: [{ id: 'cargo', label: 'cargo install', docUrl: null }],
    cooldowns: NO_COOLDOWN,
    resolve() {
      return {
        command: 'tmux-mcp',
        args: [],
        prereq: 'cargo install tmux-mcp',
        note: 'That puts a `tmux-mcp` binary on your path; it speaks MCP on stdin and stdout.',
      }
    },
  },
  go: {
    port: 'go',
    package: 'github.com/libtmux/libtmux-go/mcp',
    methods: [{ id: 'goinstall', label: 'go install', docUrl: null }],
    cooldowns: NO_COOLDOWN,
    resolve() {
      return {
        command: 'libtmux-mcp',
        args: [],
        prereq: 'go install github.com/libtmux/libtmux-go/mcp/cmd/libtmux-mcp@latest',
        note: 'That puts `libtmux-mcp` in $(go env GOPATH)/bin, which has to be on your PATH for the command below to resolve.',
      }
    },
  },
  java: {
    port: 'java',
    package: 'libtmux-mcp',
    methods: [{ id: 'gradle', label: 'Gradle', docUrl: null }],
    cooldowns: NO_COOLDOWN,
    resolve() {
      return builtFromSource(
        './gradlew :libtmux-mcp:installDist',
        '/absolute/path/to/libtmux-mcp',
        'Nothing publishes this server as a binary yet. The build writes a launcher at libtmux-mcp/build/install/libtmux-mcp/bin/libtmux-mcp; use its absolute path.',
      )
    },
  },
  dotnet: {
    port: 'dotnet',
    package: 'LibTmux.Mcp',
    methods: [{ id: 'tool', label: '.NET tool', docUrl: null }],
    cooldowns: NO_COOLDOWN,
    resolve() {
      return {
        command: 'libtmux-mcp',
        args: [],
        prereq: 'dotnet tool install --global LibTmux.Mcp --prerelease',
        note: '--prerelease is required: every release so far carries an -alpha tag, and NuGet skips those unless asked.',
      }
    },
  },
  cxx: {
    port: 'cxx',
    package: 'libtmux-mcp-server',
    methods: [{ id: 'cmake', label: 'CMake', docUrl: null }],
    cooldowns: NO_COOLDOWN,
    resolve() {
      return builtFromSource(
        'cmake -S . -B build/mcp -DLIBTMUX_BUILD_MCP_SERVER=ON -DLIBTMUX_FETCH_DEPS=ON && cmake --build build/mcp && cmake --install build/mcp --prefix ~/.local',
        // Not `~/.local/bin/…`: a shell expands the tilde and a JSON config
        // does not, so the same string would work in one panel and fail in
        // the other.
        '/absolute/path/to/libtmux-mcp-server',
        'The MCP server is a build option rather than a second package, off by default because it is the only component that needs the JSON dependency. The install above puts libtmux-mcp-server in ~/.local/bin; use its full path.',
      )
    },
  },
  swift: {
    port: 'swift',
    package: 'LibTmuxMCP',
    methods: [{ id: 'swiftbuild', label: 'swift build', docUrl: null }],
    cooldowns: NO_COOLDOWN,
    resolve() {
      return builtFromSource(
        'swift build --product libtmux-mcp',
        '/absolute/path/to/.build/debug/libtmux-mcp',
        'Nothing publishes this server as a binary yet. The server takes no flags — which tmux it talks to is environment, so the client config is where you say so.',
      )
    },
  },
}

/** The spec for one port, or Python's, which is what `/mcp/` documents. */
export function serverSpec(port = 'py'): ServerSpec {
  const spec = SERVERS[port]
  if (!spec) throw new Error(`install-matrix.ts: no MCP server spec for port "${port}"`)
  return spec
}

// ---- panel body builders ---------------------------------------------

/** `command` and its arguments as one shell line. */
function shellCommand(server: ServerCommand): string {
  return [server.command, ...server.args].join(' ')
}

/** Build the full shell command for a CLI-kind client. */
function cliBody(client: Client, scope: Scope, server: ServerCommand): string {
  const toolCmd = shellCommand(server)
  if (client.id === 'gemini') {
    // gemini's `--` separator lands after the tool token, not before.
    if (server.args.length > 0) {
      return `gemini mcp add --scope ${scope.id} tmux ${server.command} -- ${server.args.join(' ')}`
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
/** What a config file lists, which is `args` unless the spec overrides it. */
function configArgs(server: ServerCommand): readonly string[] {
  return server.configArgs ?? server.args
}

function jsonBody(server: ServerCommand): string {
  // Explicit per-line indents rather than a dedent-after-interpolation
  // pattern: substituting `args` at a smaller indent than the surrounding
  // template breaks a post-hoc dedent for every member after the first.
  const serverIndent = JSON_INDENT.repeat(3)
  const serverLines = [`${serverIndent}"command": "${server.command}"`]
  const args = configArgs(server)
  if (args.length > 0) {
    serverLines.push(`${serverIndent}"args": [${args.map((a) => `"${a}"`).join(', ')}]`)
  }
  const env = Object.entries(server.env ?? {})
  if (env.length > 0) {
    serverLines.push(
      `${serverIndent}"env": { ${env.map(([k, v]) => `"${k}": "${v}"`).join(', ')} }`,
    )
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
function tomlBody(server: ServerCommand): string {
  const lines = ['[mcp_servers.tmux]', `command = "${server.command}"`]
  const args = configArgs(server)
  if (args.length > 0) lines.push(`args = [${args.map((a) => `"${a}"`).join(', ')}]`)
  const env = Object.entries(server.env ?? {})
  if (env.length > 0) {
    lines.push(`env = { ${env.map(([k, v]) => `${k} = "${v}"`).join(', ')} }`)
  }
  return lines.join('\n')
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
function bodyFor(client: Client, scope: Scope, server: ServerCommand): RawBody {
  const note = server.note ?? null
  if (client.id === 'codex' && scope.id === 'project') {
    return { body: tomlBody(server), language: 'toml', note }
  }
  if (client.kind === 'json') {
    return { body: jsonBody(server), language: 'json', note }
  }
  return { body: cliBody(client, scope, server), language: 'console', note }
}

/** Pre-compute every legal (client, method, scope, cooldown) panel for one port. */
export function buildPanels(spec: ServerSpec): Panel[] {
  const panels: Panel[] = []
  CLIENTS.forEach((client, clientIndex) => {
    spec.methods.forEach((method, methodIndex) => {
      client.scopes.forEach((scope, scopeIndex) => {
        spec.cooldowns.forEach((cooldown, cooldownIndex) => {
          const server = spec.resolve(method, cooldown)
          const raw = bodyFor(client, scope, server)
          const body = raw.language === 'console' ? `$ ${raw.body}` : raw.body
          panels.push({
            client,
            method,
            scope,
            cooldown,
            language: raw.language,
            body,
            pipPrereq: server.prereq ?? null,
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
 * depending on type. For Python that is 14 scopes * 3 methods * 3 states =
 * 126 selectors.
 *
 * A port with no cooldown axis leaves the cooldown attributes out of its
 * selectors entirely, rather than pinning them to "off". The attribute on
 * `<html>` is written from one shared key, so a reader who turned a cooldown
 * on over on `/mcp/` would otherwise arrive at a TypeScript page whose every
 * panel selector failed to match — and `PANEL_DEFAULT_OVERRIDE_RULE` has
 * already hidden the server-rendered default by then, leaving a widget with
 * no panel at all.
 */
function panelActiveSelectors(spec: ServerSpec): string {
  const selectors: string[] = []
  const hasCooldowns = spec.cooldowns.length > 1
  for (const client of CLIENTS) {
    for (const method of spec.methods) {
      for (const scope of client.scopes) {
        const htmlAttrs =
          `[data-mcp-install-client="${client.id}"]` +
          `[data-mcp-install-method="${method.id}"]` +
          `[data-mcp-install-scope="${scope.id}"]`
        const panel =
          ` .lm-mcp-install__panel[data-client="${client.id}"][data-method="${method.id}"][data-scope="${scope.id}"]`
        if (!hasCooldowns) {
          selectors.push(`html${htmlAttrs}${panel}[data-cooldown="off"]`)
          continue
        }
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

function buildPrehydrateStyle(spec: ServerSpec): string {
  const clientIds = CLIENTS.map((c) => c.id)
  const methodIds = spec.methods.map((m) => m.id)
  const rules = [
    TAB_DEACTIVATE_RULE,
    tabActiveSelectors('client', clientIds) + TAB_ACTIVE_DECL,
    tabActiveSelectors('method', methodIds) + TAB_ACTIVE_DECL,
    scopeTabActiveSelectors() + TAB_ACTIVE_DECL,
    scopeGroupVisibleSelectors() + SCOPE_GROUP_ACTIVE_DECL,
    PANEL_DEFAULT_OVERRIDE_RULE,
    panelActiveSelectors(spec) + PANEL_ACTIVE_DECL,
    COOLDOWN_TOGGLE_CHECKED_RULES,
  ]
  return `<style>${rules.join('')}</style>`
}

// Storage keys are namespaced to this site rather than the source's
// "libtmux-mcp." prefix — that prefix named the widget's *origin* project
// (the libtmux-mcp Python docs), not this one. localStorage is
// origin-scoped regardless, so this is a naming choice, not a fix.
export const STORAGE_PREFIX = 'libtmux-docs.mcp-install'

/**
 * The method key is per port; the client and scope keys are not.
 *
 * A client is a fact about the reader — whoever uses Cursor for Python uses
 * it for TypeScript — so that choice is worth carrying between pages. A
 * method is a fact about the port: `uvx` means nothing on the TypeScript
 * page, and restoring it there left `<html data-mcp-install-method="uvx">`
 * matching no panel selector and no panel on screen.
 */
export function methodStorageKey(port: string): string {
  return `${STORAGE_PREFIX}.method.${port}`
}

function buildPrehydrateScript(spec: ServerSpec): string {
  const defaults = JSON.stringify(DEFAULT_SCOPES)
  const enabledDefault = DEFAULT_COOLDOWN_ENABLED ? '1' : '0'
  return (
    '<script data-cfasync="false">(function(){' +
    'try{' +
    'var h=document.documentElement;' +
    `var d=${defaults};` +
    `var c=localStorage.getItem("${STORAGE_PREFIX}.client")||"${CLIENTS[0]!.id}";` +
    `var m=localStorage.getItem("${methodStorageKey(spec.port)}")||"${spec.methods[0]!.id}";` +
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
export function buildMcpInstallPrehydrateSnippet(spec: ServerSpec): string {
  return buildPrehydrateStyle(spec) + buildPrehydrateScript(spec)
}
