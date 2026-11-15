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

import { COOLDOWN_SLOTS, formatCooldown, type CooldownUnit } from './cooldown.ts'

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
 * `cooldowns` is Python's and TypeScript's axis: uv holds a resolution back
 * with `--exclude-newer`, npm with `--min-release-age`. cargo, go, gem and
 * NuGet have no equivalent, so their specs carry the single `off` entry and
 * the widget renders no cooldown control at all.
 */
export interface ServerSpec {
  /** Port slug, as in ports.ts. */
  port: string
  /** What the server is published or built as, for the prose above the picker. */
  package: string
  methods: readonly Method[]
  cooldowns: readonly Cooldown[]
  resolve(method: Method, cooldown: Cooldown, sourceRevision?: string): ServerCommand
}

/** Pre-built cell for one (client, method, scope, cooldown) tuple. */
export interface Panel {
  client: Client
  method: Method
  scope: Scope
  cooldown: Cooldown
  language: 'console' | 'json' | 'toml'
  /** Command/config text. A console command carries no prompt: the installer draws it.
   *  May contain COOLDOWN_DURATION_SENTINEL or COOLDOWN_DATE_SENTINEL — see
   *  bodySegments(). */
  body: string
  /** The build or install step this cell needs first, where it needs one. */
  pipPrereq: string | null
  /** A caveat that holds whatever the cooldown: a path only you know. */
  note: string | null
  /** Why a cooldown mode changes nothing for this method, where it changes nothing; the installer says it beside the command. */
  cooldownReason: string | null
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

/** The single-entry axis of a port whose toolchain has no release-age gate. */
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
export const COOLDOWN_DURATION_SENTINEL = COOLDOWN_SLOTS.duration
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
    return `${method.id} has no per-package cooldown override, so this snippet runs without cooldown enforcement.`
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
  julia: {
    port: 'julia',
    package: 'LibTmuxMCP',
    methods: [{ id: 'pkg', label: 'Julia Pkg (Git)', docUrl: null }],
    cooldowns: NO_COOLDOWN,
    resolve(_method, _cooldown, sourceRevision = 'master') {
      return {
        command: '/absolute/path/to/project/bin/libtmux-mcp',
        args: ['--socket', '/absolute/path/to/tmux.sock'],
        // The script runs over several lines inside its quotes; Julia reads a newline as it reads `;`.
        prereq: [
          "julia --startup-file=no -e '",
          'using Pkg',
          'Pkg.activate(".")',
          'repo = "https://github.com/libtmux/libtmux-julia.git"',
          `ref = ${JSON.stringify(sourceRevision)}`,
          'Pkg.add([',
          '    Pkg.PackageSpec(url=repo, rev=ref),',
          '    Pkg.PackageSpec(url=repo, rev=ref, subdir="packages/LibTmuxMCP")])',
          'using LibTmuxMCP',
          `println(LibTmuxMCP.install_cli("bin"))'`,
        ].join('\n'),
        note: 'Run the setup in a consumer project directory. Replace the launcher and socket paths with absolute paths on your machine. The server borrows an existing tmux daemon. Configure tool permissions as described in the MCP server guide.',
      }
    },
  },
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
  ruby: {
    port: 'ruby',
    package: 'libtmux-mcp',
    methods: [
      { id: 'gem', label: 'RubyGems', docUrl: 'https://rubygems.org/gems/libtmux-mcp' },
      { id: 'bundler', label: 'Bundler', docUrl: 'https://bundler.io/guides/creating_gem.html' },
    ],
    cooldowns: NO_COOLDOWN,
    resolve(method) {
      const command = {
        command: method.id === 'bundler' ? 'bundle' : 'libtmux-mcp',
        args: method.id === 'bundler'
          ? ['exec', 'libtmux-mcp', '--socket-name', 'libtmux-docs', '--endpoint', 'local']
          : ['--socket-name', 'libtmux-docs', '--endpoint', 'local'],
        prereq: method.id === 'bundler'
          ? 'bundle add libtmux-mcp'
          : 'gem install libtmux-mcp',
        note: 'The server borrows an existing named socket. Start it first with `tmux -L libtmux-docs new-session -d`; `--endpoint` is only its public alias.',
      }
      return command
    },
  },
  ts: {
    port: 'ts',
    package: '@libtmux/mcp',
    methods: [
      { id: 'npx', label: 'npx', docUrl: null },
      { id: 'global', label: 'Global install', docUrl: null },
    ],
    cooldowns: COOLDOWNS,
    resolve(method, cooldown) {
      if (method.id === 'npx') {
        if (cooldown.id === 'bypass') return { command: 'npx', args: ['-y', '--min-release-age=0', '@libtmux/mcp'] }
        return {
          command: 'npx',
          args: ['-y', '@libtmux/mcp'],
          // npx resolves the package before it reads the exclusion, so a
          // cooldown would hold back @libtmux/mcp itself.
          note: cooldown.id === 'days'
            ? 'npx ignores --min-release-age-exclude, so a cooldown here would also hold back the release it runs; this runs without one.'
            : undefined,
        }
      }
      const note = 'The package installs a `libtmux-mcp` binary. Requires Node 22 or newer, or Bun 1.3.14 or newer.'
      if (cooldown.id === 'days') {
        return {
          command: 'libtmux-mcp',
          args: [],
          // @libtmux/mcp pins libtmux exactly, and both publish together, so
          // both are exempt; the SDK and zod wait out the window.
          prereq:
            `npm install --global \\\n    --min-release-age=${COOLDOWN_SLOTS.days} \\\n` +
            '    --min-release-age-exclude=@libtmux/mcp \\\n    --min-release-age-exclude=libtmux \\\n    @libtmux/mcp',
          note,
        }
      }
      if (cooldown.id === 'bypass') {
        return { command: 'libtmux-mcp', args: [], prereq: 'npm install --global --min-release-age=0 @libtmux/mcp', note }
      }
      return { command: 'libtmux-mcp', args: [], prereq: 'npm install --global @libtmux/mcp', note }
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
        note: 'The installed `tmux-mcp` binary speaks MCP on stdin and stdout.',
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
  csharp: {
    port: 'csharp',
    package: 'LibTmux.Mcp',
    methods: [
      { id: 'dnx', label: 'dnx', docUrl: null },
      { id: 'tool', label: '.NET tool', docUrl: null },
    ],
    cooldowns: NO_COOLDOWN,
    resolve(method) {
      if (method.id === 'dnx') {
        return {
          command: 'dnx',
          args: ['LibTmux.Mcp', '--yes'],
          note: 'Runs the server from NuGet without installing it; needs the .NET 10 SDK. Write LibTmux.Mcp@<version> to pin a version.',
        }
      }
      return {
        command: 'libtmux-mcp',
        args: [],
        prereq: 'dotnet tool install --global LibTmux.Mcp',
        note: 'Installs the `libtmux-mcp` tool from NuGet.',
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
        // One flag or step per line, as the C++ MCP guide shows them.
        'cmake \\\n    -S . \\\n    -B build/mcp \\\n    -DLIBTMUX_BUILD_MCP_SERVER=ON \\\n    -DLIBTMUX_FETCH_DEPS=ON && \\\n' +
          'cmake --build build/mcp && \\\n' +
          'cmake --install build/mcp --prefix ~/.local',
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

/** The spec for one port, or Python's, the reference implementation. */
export function serverSpec(port = 'py'): ServerSpec {
  const spec = SERVERS[port]
  if (!spec) throw new Error(`install-matrix.ts: no MCP server spec for port "${port}"`)
  return spec
}

// ---- panel body builders ---------------------------------------------

/**
 * The widest line of a shell command meant for pasting, without its `$ `
 * prompt. The install blocks show about 80 columns before they scroll, so a
 * wider line hides the end of a step the reader has to read before running it.
 */
export const SHELL_MAX_WIDTH = 80

/** `text` as the page shows it by default: each cooldown slot holds the default day count in its tool's unit. */
export function withDefaultCooldown(text: string): string {
  return (Object.keys(COOLDOWN_SLOTS) as CooldownUnit[])
    .reduce((filled, unit) => filled.replaceAll(COOLDOWN_SLOTS[unit], formatCooldown(unit, DEFAULT_COOLDOWN_DAYS)), text)
    .replaceAll(COOLDOWN_DATE_SENTINEL, defaultCooldownDate(DEFAULT_COOLDOWN_DAYS))
}

/**
 * A command's words, split at unquoted spaces only, so no break ever falls
 * inside a quoted word. Null where the text cannot be read that way: a
 * backslash it already carries, or a quote it leaves open.
 */
function shellWords(command: string): string[] | null {
  const words: string[] = []
  let current = ''
  let quote = ''
  for (const char of command) {
    if (quote) {
      current += char
      if (char === quote) quote = ''
    } else if (char === "'" || char === '"') {
      quote = char
      current += char
    } else if (char === '\\') {
      return null
    } else if (char === ' ') {
      if (current) words.push(current)
      current = ''
    } else current += char
  }
  if (quote) return null
  if (current) words.push(current)
  return words
}

/** A quoted program's statements: its text split at each `;` outside strings and brackets. */
function statements(program: string): string[] {
  const found: string[] = []
  let current = ''
  let quote = ''
  let depth = 0
  for (let i = 0; i < program.length; i++) {
    const char = program[i]!
    if (quote) {
      current += char
      if (char === quote && program[i - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"') quote = char
    else if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) depth--
    else if (char === ';' && depth === 0) {
      if (current.trim()) found.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) found.push(current.trim())
  return found
}

/** A statement wider than the line opens its shallowest bracket that holds a list, one item per line. */
function openList(statement: string, indent: string, width: number): string {
  if (indent.length + statement.length <= width) return statement
  interface Open { at: number; depth: number; commas: number[]; end: number }
  const stack: Open[] = []
  let best: Open | undefined
  let quote = ''
  for (let i = 0; i < statement.length; i++) {
    const char = statement[i]!
    if (quote) {
      if (char === quote && statement[i - 1] !== '\\') quote = ''
    } else if (char === '"') quote = char
    else if ('([{'.includes(char)) stack.push({ at: i, depth: stack.length, commas: [], end: -1 })
    else if (')]}'.includes(char)) {
      const open = stack.pop()
      if (open?.commas.length && (!best || open.depth < best.depth)) best = { ...open, end: i }
    } else if (char === ',' && stack.length) stack.at(-1)!.commas.push(i)
  }
  if (!best) return statement
  const cuts = [best.at + 1, ...best.commas.map((comma) => comma + 1), best.end]
  const items = cuts.slice(0, -1).map((cut, k) => statement.slice(cut, k === cuts.length - 2 ? cuts[k + 1] : cuts[k + 1]! - 1).trim())
  return `${statement.slice(0, best.at + 1)}\n${items.map((item) => `${indent}  ${item}`).join(',\n')}\n${indent}${statement.slice(best.end)}`
}

/** A quoted program after -e or -c: one statement per line. */
function quotedProgram(word: string, indent: string, width: number): string {
  if (word[0] !== "'" || word.length + indent.length <= width) return word
  const lines = statements(word.slice(1, -1))
  if (lines.length < 2) return word
  return `'\n${lines.map((line) => indent + openList(line, indent, width)).join('\n')}'`
}

/**
 * One command's words as lines: the command's own words; each flag with its
 * value; consecutive positional arguments together; and after `--` the
 * program it runs, its words on one line and its own flags one level deeper.
 */
function commandLines(words: string[], indent: string, width: number): { text: string; deep: boolean }[] {
  const lines: { text: string; deep: boolean }[] = []
  let i = 0
  let deep = false
  const head: string[] = []
  while (i < words.length && !words[i]!.startsWith('-') && !(head.length && /[/@]/.test(words[i]!))) head.push(words[i++]!)
  if (head.length) lines.push({ text: head.join(' '), deep })
  const flag = (): string => {
    const word = words[i++]!
    const value = words[i]
    if (!word.includes('=') && value !== undefined && !value.startsWith('-')) {
      i++
      return `${word} ${/^-(?:e|c)$|^--eval$/.test(word) ? quotedProgram(value, `${indent}  `, width) : value}`
    }
    return word
  }
  while (i < words.length) {
    const word = words[i]!
    if (word === '--') {
      i++
      const program: string[] = []
      while (i < words.length && !words[i]!.startsWith('-')) program.push(words[i++]!)
      lines.push({ text: `--${program.length ? ` ${program.join(' ')}` : i < words.length ? ` ${flag()}` : ''}`, deep })
      deep = true
    } else if (word.startsWith('-')) lines.push({ text: flag(), deep })
    else {
      const positional: string[] = []
      while (i < words.length && !words[i]!.startsWith('-')) positional.push(words[i++]!)
      lines.push({ text: positional.join(' '), deep })
    }
  }
  return lines
}

/**
 * One shell command broken across lines with a trailing backslash, which a
 * shell reads as the same command, so the copied text runs as the one line did.
 *
 * A command that fits, or one already written over several lines, is left
 * alone. Otherwise (WRITING.md, Code blocks) a flag stays on the line of its
 * value, positional arguments come last and stay together, and a chain breaks
 * before each `&&` or `||`. Breaks fall only at unquoted spaces. After `--`,
 * the program it runs takes one line and its flags go one level deeper; a
 * quoted program after `-e` or `-c` puts one statement on each line. A
 * cooldown slot is measured at the default day count's width.
 */
export function wrapShell(command: string, width = SHELL_MAX_WIDTH): string {
  const measure = (text: string) => withDefaultCooldown(text).length
  if (command.includes('\n') || measure(command) <= width) return command
  const words = shellWords(command)
  if (!words) return command
  const segments: string[][] = [[]]
  for (const word of words) {
    if (word === '&&' || word === '||') segments.push([word])
    else segments.at(-1)!.push(word)
  }
  const lines: string[] = []
  segments.forEach((segment, index) => {
    const operator = index ? `${segment.shift()!} ` : ''
    const lead = index ? '  ' : ''
    const whole = operator + segment.join(' ')
    if (measure(lead + whole) <= width) {
      lines.push(lead + whole)
      return
    }
    const indent = index ? '      ' : '    '
    commandLines(segment, indent, width).forEach((line, k) => {
      lines.push(k ? indent + (line.deep ? '    ' : '') + line.text : lead + operator + line.text)
    })
  })
  return lines.join(' \\\n')
}

/**
 * A path the reader replaces with their own, as the servers built from source
 * write it: `/absolute/path/to/project/bin/libtmux-mcp`.
 */
const PLACEHOLDER_PATH = /\/absolute\/path\/to\/[^\s"'<&\\]*/g

/**
 * Highlighted code with each placeholder path marked as text to replace.
 *
 * Only a span is added around the path, so the text a reader copies is the
 * code as written: the placeholder stays, and no one pastes a path of ours.
 */
export function markPlaceholders(html: string): string {
  return html.replace(PLACEHOLDER_PATH, '<span class="lm-install__slot" title="Replace with the real path">$&</span>')
}

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
  return { body: wrapShell(cliBody(client, scope, server)), language: 'console', note }
}

/** What a cooldown mode changes in a command: the same server, spelled with the same arguments, prerequisite and environment. */
const sameCommand = (a: ServerCommand, b: ServerCommand) =>
  JSON.stringify([a.command, a.args, a.configArgs, a.env, a.prereq]) === JSON.stringify([b.command, b.args, b.configArgs, b.env, b.prereq])

/** Pre-compute every legal (client, method, scope, cooldown) panel for one port. */
export function buildPanels(spec: ServerSpec, sourceRevision?: string): Panel[] {
  const panels: Panel[] = []
  CLIENTS.forEach((client, clientIndex) => {
    spec.methods.forEach((method, methodIndex) => {
      client.scopes.forEach((scope, scopeIndex) => {
        const plain = spec.resolve(method, COOLDOWNS[0]!, sourceRevision)
        spec.cooldowns.forEach((cooldown, cooldownIndex) => {
          const server = spec.resolve(method, cooldown, sourceRevision)
          const raw = bodyFor(client, scope, server)
          // A mode that leaves the command as it was says why, and what it says is not a caveat on the command.
          const refused = cooldown.id !== 'off' && sameCommand(server, plain) && server.note !== plain.note
          panels.push({
            client,
            method,
            scope,
            cooldown,
            language: raw.language,
            body: raw.body,
            pipPrereq: server.prereq ?? null,
            note: refused ? plain.note ?? null : raw.note,
            cooldownReason: refused ? server.note ?? null : null,
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
 * on over on one port's MCP page would otherwise arrive at a TypeScript page
 * whose every panel selector failed to match — and
 * `PANEL_DEFAULT_OVERRIDE_RULE` has already hidden the server-rendered
 * default by then, leaving a widget with no panel at all.
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
  '{color:var(--lm-mcp-install-fg-muted);border-color:transparent;background:transparent}'

const TAB_ACTIVE_DECL =
  '{color:var(--lm-mcp-install-accent);border-color:var(--lm-mcp-install-accent);background:transparent}'

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
