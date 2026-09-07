import type { Bucket, Match, PortNav } from './nav.ts'

/**
 * The reference sidebar, curated once for all eight ports.
 *
 * THE BUCKETS ARE SHARED, and that is a finding rather than a convenience:
 * every one of the eight ports declares Server, Session, Window, Pane and
 * Client. The domain is tmux's, so the vocabulary is tmux's, and a reader
 * moving between languages meets the same shape. Only the *rules* differ,
 * because the ports name their supporting types differently and four of them
 * have no real modules at all — Java, C++ and Swift report one module per
 * type, so module rules are useless there and name rules are not.
 *
 * The order is tmux's own containment, the same order gp-sphinx's hand-written
 * toctree uses: Server → Session → Window → Pane → Client, then the things
 * that hang off them, then the machinery, then the auxiliary trees.
 */


const nameRe = (re: string): Match => ({ kind: 'name', re })

/**
 * Matched by name or by where it is declared.
 *
 * The path is the tiebreaker where the name lies, and it lies often. Swift's
 * `ToolDefinition` reads as a generic tool type and lives in
 * `Sources/LibTmuxMCP/`; Rust's `WireVersion` reads as versioning and lives in
 * `query/serde_v1.rs`; Go's `AllowPassthrough` and `StatusJustify` carry no
 * hint at all and sit together in `tmux/option_generated.go`.
 *
 * This is the same idea Starlight and Docusaurus get from autogenerating a
 * sidebar out of a directory tree. Our routes are flat by design, so the
 * directory that means something is the source one.
 */
const nameOrPath = (re: string, pathRe: string): Match => ({
  kind: 'anyOf',
  of: [nameRe(re), { kind: 'path', re: pathRe }],
})

/**
 * What counts as an error.
 *
 * The path clause carries this one. Python and TypeScript declare their
 * exceptions in `exc.py` / `exc.ts` as plain classes, so neither the `Error`
 * suffix nor the `exception` symbol kind sees them.
 */
const ERRORS: Match = {
  kind: 'anyOf',
  of: [
    { kind: 'name', suffix: 'Error' },
    { kind: 'name', suffix: 'Exception' },
    // `TmuxSessionExists` and `BadSessionName` carry no telltale suffix, but
    // an exception is machinery whatever it is called.
    { kind: 'symbol', kinds: ['exception'] },
    { kind: 'path', re: '(^|/)exc[./]|(^|/)(errors?|exceptions?)\\.' },
    // The estate's own idiom, and the one exception name shared by all eight.
    // Java declares it as a plain class in a file of its own, so neither the
    // path nor the kind sees it.
    nameRe('DoesNotExist|MultipleObjectsReturned'),
  ],
}

/**
 * Every bucket, in the order that decides who wins a contested symbol.
 *
 * ONE chain, and that is the point. Precedence is generated into the rules
 * below rather than left to whichever bucket the evaluator reaches first, so
 * the buckets are disjoint by construction — and a symbol claimed by two
 * buckets is one of the four things the lint fails on. A config that leaned on
 * declaration order would be manufacturing the ambiguity it exists to report.
 *
 * Earlier wins. The order runs auxiliary, then machinery, then the
 * cross-cutting subsystems, then tmux's own hierarchy, then what hangs off it.
 * That is upside down from how it reads, and deliberately: `PaneCaptureRequest`
 * must land in Requests rather than under Pane, and `SessionHookValues` in
 * Hooks rather than under Session. Machinery outranks the domain *when
 * matching* precisely so the domain is clean *when read*. `ORDER` below is
 * what a person sees.
 *
 * Keeping the machinery buckets in this chain rather than beside it is a fix,
 * not a tidy-up: while `requests` and `errors` sat outside it they were not
 * subtracted from anything, and `ErrorKind` was claimed by both Errors and
 * Constants on two ports.
 */
const CHAIN: { id: string; label: string; match: Match }[] = [
  // The auxiliary trees outrank everything: `TestServer` is a fixture before
  // it is a Server, and `TmuxTestOptions` is one before it is a constant.
  { id: 'mcp', label: 'MCP', match: nameOrPath('Mcp|MCP', 'mcp') },
  {
    id: 'testing',
    label: 'Testing utilities',
    match: nameOrPath('Test|Fixture|Mock|Fake', 'test|fixture|mock|junit'),
  },
  {
    id: 'internal',
    label: 'Internal',
    match: {
      kind: 'anyOf',
      of: [
        nameRe('Internal|Generated'),
        { kind: 'path', re: '(^|/)_?internal' },
        // .NET says so in the namespace and nowhere else: `Materializer` sits
        // in `Materialization/` and is declared in `LibTmux.Internal`.
        { kind: 'module', re: '(^|\\.)_?[Ii]nternal(\\.|$)' },
      ],
    },
  },
  // Machinery. Most of Go's types are one of these three, and they are why
  // the old sidebar was unreadable: `BindKeyRequest` sorted next to `Server`
  // and looked equally important.
  { id: 'requests', label: 'Requests', match: nameOrPath('Request$', '(^|/)requests?[./]') },
  { id: 'errors', label: 'Errors', match: ERRORS },
  {
    id: 'constants',
    label: 'Constants and enums',
    match: {
      kind: 'anyOf',
      of: ['Kind', 'Mode', 'Style', 'Action', 'Options', 'Result', 'Event'].map(
        (suffix): Match => ({ kind: 'name', suffix }),
      ),
    },
  },
  // Cross-cutting subsystems: these words appear inside domain type names.
  { id: 'hooks', label: 'Hooks', match: nameOrPath('Hook', '(^|/)hooks?[./]') },
  {
    id: 'control',
    label: 'Control mode',
    match: nameOrPath('Control|Notification|Subscribe', '(^|/)control'),
  },
  { id: 'formats', label: 'Formats', match: nameOrPath('Format', '(^|/)formats?[./]') },
  {
    id: 'queries',
    label: 'Queries',
    match: nameOrPath(
      'Query|Filter|Predicate|Matcher|Criteria|Operator|Quantifier|Expr|Node$|Field$',
      '(^|/)quer(y|ies)[./]|(^|/)matching|(^|/)filter',
    ),
  },
  { id: 'snapshots', label: 'Snapshots', match: nameOrPath('Snapshot|Capture', '(^|/)snapshots?[./]') },
  { id: 'workspace', label: 'Workspaces', match: nameOrPath('Workspace|Plan', '(^|/)plan[./]') },
  // tmux's own object hierarchy, in tmux's order.
  { id: 'server', label: 'Server', match: nameOrPath('^Server|Server$', '(^|/)server[./]') },
  { id: 'session', label: 'Session', match: nameOrPath('Session', '(^|/)session[./]') },
  { id: 'window', label: 'Window', match: nameOrPath('Window', '(^|/)window[./]') },
  { id: 'pane', label: 'Pane', match: nameOrPath('Pane', '(^|/)pane[./]') },
  { id: 'client', label: 'Client', match: nameOrPath('Client', '(^|/)client[./]') },
  // What hangs off the hierarchy.
  { id: 'options', label: 'Options', match: nameOrPath('^Option|Option$', '(^|/)options?') },
  { id: 'keys', label: 'Keys and bindings', match: nameOrPath('Key|Binding', '(^|/)(keys?|binding)') },
  { id: 'buffers', label: 'Buffers', match: nameOrPath('Buffer', '(^|/)buffers?[./]') },
  {
    id: 'layout',
    label: 'Layout and geometry',
    match: nameOrPath('Layout|Split|Resize|Direction|Dimension|Rotation', '(^|/)layouts?[./]'),
  },
  { id: 'environment', label: 'Environment', match: nameOrPath('Environment', '(^|/)environment') },
  {
    id: 'capabilities',
    label: 'Terminal capabilities',
    match: nameOrPath('Capabilit|Terminal', '(^|/)capabilit'),
  },
  { id: 'version', label: 'Versions', match: nameOrPath('Version|Release', '(^|/)versions?[./]') },
  {
    id: 'commands',
    label: 'Commands',
    match: nameOrPath(
      'Command|Cmd|cmd|Dispatch|Transport|Connection',
      '(^|/)(commands?|dispatch|transport|connection)',
    ),
  },
]

/**
 * The order a reader sees, which is not the order the rules are applied in.
 *
 * Patterns demote; curation ranks. `CHAIN` above is machinery-first because
 * that is what makes the domain clean; this is tmux's own containment, the
 * same order gp-sphinx's hand-written toctree uses, with the machinery and the
 * auxiliary trees collapsed underneath it.
 *
 * A bucket missing from this list is a build error rather than a silent
 * omission — see `SHARED`.
 */
const ORDER = [
  'server',
  'session',
  'window',
  'pane',
  'client',
  'hooks',
  'options',
  'keys',
  'buffers',
  'layout',
  'environment',
  'capabilities',
  'version',
  'commands',
  'control',
  'formats',
  'queries',
  'snapshots',
  'workspace',
  'requests',
  'errors',
  'constants',
  'mcp',
  'testing',
  'internal',
]

/**
 * Machinery, marked as such.
 *
 * This is curation, not rendering: the sidebar shows the entries of the
 * bucket being read and one line for every other, so nothing here decides
 * what is open on a page. It travels in the sidecar for the port index, which
 * still groups by module and should not.
 */
const COLLAPSED = new Set(['requests', 'errors', 'constants', 'mcp', 'testing', 'internal'])

/** "Matches mine, and none of the rules that outrank mine." */
function disjoint(index: number): Match {
  const above = CHAIN.slice(0, index).map((c): Match => ({ kind: 'not', of: c.match }))
  return above.length === 0
    ? CHAIN[index]!.match
    : { kind: 'allOf', of: [CHAIN[index]!.match, ...above] }
}

/**
 * How a bucket splits when it is too big to scan.
 *
 * A bucket of 55 is a list, not a grouping. These divide the ones that grow —
 * measured, not guessed: Requests reached 60 on Go, Queries 55 on Rust,
 * Internal 54 on .NET, Constants 46 on TypeScript.
 *
 * The machinery buckets split by the tmux object they act on, reusing the
 * hierarchy the sidebar already teaches: `SplitPaneRequest` sits under Pane
 * inside Requests, where a reader looking for it would think to look. The two
 * that have no such object — Queries and Internal — split by their own
 * vocabulary instead.
 *
 * A child's rule is intersected with its parent's, so a child can only ever
 * take symbols the parent already had. Without that a broad child pattern
 * would reach outside its own bucket and `compileNav` would report it as a
 * symbol two buckets claim, which is exactly right and exactly not what was
 * meant.
 */
/** tmux's own objects, as a reusable split. */
const BY_OBJECT = [
  { id: 'server', label: 'Server', re: 'Server' },
  { id: 'session', label: 'Session', re: 'Session' },
  { id: 'window', label: 'Window', re: 'Window' },
  { id: 'pane', label: 'Pane', re: 'Pane' },
  { id: 'client', label: 'Client', re: 'Client' },
]

const SPLITS: Record<string, { id: string; label: string; re: string }[]> = {
  requests: BY_OBJECT,
  // No Client entry: not one of the eight ports declares a client-related
  // error, and the dead-rule check said so the first time this ran.
  errors: BY_OBJECT.filter((c) => c.id !== 'client'),
  constants: BY_OBJECT,
  queries: [
    { id: 'fields', label: 'Fields', re: 'Field' },
    { id: 'operators', label: 'Operators', re: 'Operator|Op$|Quantifier|Combine|Negation' },
    { id: 'expressions', label: 'Expressions', re: 'Expr|Node|Constant|Predicate' },
    // No Serialisation entry. Rust's wire types are `pub(crate)` and .NET's
    // are `internal`, so once the reference stopped publishing what the ports
    // do not export, this claimed nothing anywhere.
  ],
  // What is left of Internal is Python's `_internal` and Java's internal
  // packages. Materialisation, Compatibility, Diagnostics, Formats,
  // Environment, Capabilities and Server all went with .NET's 504 internal
  // symbols and Rust's 528 crate-private ones, and the dead-rule check said so.
  internal: [
    { id: 'commands', label: 'Commands', re: 'Command|Dispatch|Transport|Connection|Process|Endpoint' },
    { id: 'options', label: 'Options', re: 'Option' },
  ],
  workspace: [
    { id: 'plan', label: 'Plans', re: 'Plan|Workspace' },
    { id: 'steps', label: 'Steps', re: 'Step|Operation|Outcome|Attribution|Executor|Chainable' },
    { id: 'targets', label: 'Targets and slots', re: 'Slot|Target|Part|Scope|Identity' },
    // A workspace plan addresses sessions, windows and panes; it never names
    // a server or a client, and the dead-rule check said so.
    ...BY_OBJECT.filter((c) => c.id !== 'server' && c.id !== 'client'),
  ],
}

const SHARED: Bucket[] = ORDER.map((id) => {
  const index = CHAIN.findIndex((c) => c.id === id)
  if (index === -1) throw new Error(`nav-config: ORDER names '${id}', which no rule in CHAIN defines`)
  const match = disjoint(index)
  const splits = SPLITS[id]
  return {
    id,
    label: CHAIN[index]!.label,
    collapsed: COLLAPSED.has(id),
    match,
    ...(splits
      ? {
          children: splits.map((c, i): Bucket => ({
            id: `${id}-${c.id}`,
            label: c.label,
            // Intersected with the parent, and with every sibling above it, so
            // `PaneCaptureRequest` lands in one child rather than two.
            match: {
              kind: 'allOf',
              of: [
                match,
                nameRe(c.re),
                ...splits.slice(0, i).map((prev): Match => ({ kind: 'not', of: nameRe(prev.re) })),
              ],
            },
          })),
        }
      : {}),
  }
})

if (SHARED.length !== CHAIN.length) {
  const missing = CHAIN.filter((c) => !ORDER.includes(c.id)).map((c) => c.id)
  throw new Error(`nav-config: CHAIN defines ${missing.join(', ')}, which ORDER never places`)
}

/**
 * Per-port exemptions.
 *
 * A port adds `unsettled` entries rather than renaming buckets: the shared
 * vocabulary is the point, and a port with its own bucket names would break
 * the promise that the same shape appears in every language.
 */
const OVERRIDES: Record<string, { unsettled?: Record<string, string> }> = {
  py: {
    unsettled: {
      'libtmux._vendor._structures.InfinityType': 'vendored from packaging; version comparison, not tmux',
      'libtmux._vendor._structures.NegativeInfinityType':
        'vendored from packaging; version comparison, not tmux',
      'libtmux.constants._DefaultOptionScope': 'private sentinel for an option scope left unset',
      'libtmux.neo.Obj': 'base of the neo object layer; the tmux entity is the subclass',
    },
  },
  ts: {
    unsettled: {
      'common.TmuxLogger': 'diagnostics plumbing; no tmux object of its own',
      'common.TmuxWarning': 'diagnostics plumbing; no tmux object of its own',
      'common.TmuxWarningSink': 'diagnostics plumbing; no tmux object of its own',
      'common.LogicalRefBase': 'base of the entity reference types; the tmux entity is the subclass',
      'selection.Selection': 'copy-mode selection; belongs with Buffers once TypeScript grows them',
      'types.AbortLike': 'structural type for a host-provided abort signal',
      'types.TmuxEventStream': 'structural type for a host-provided stream',
      'types.MenuEntry': 'display-menu entry; see the Menus note below',
    },
  },
  rs: {
    unsettled: {
      'blocking.Runtime': 'the blocking facade’s runtime handle; async plumbing',
      'limits.OutputLimits': 'output byte and line caps; plumbing',
      'config.Entry': 'workspace config entry; Workspaces covers the plan, not the file it parses',
      'target.EndpointInputs': 'socket endpoint resolution; sits below Server rather than inside it',
      'target.ResolvedEndpoint': 'socket endpoint resolution; sits below Server rather than inside it',
      'target.ResolvedSocketSelector':
        'socket endpoint resolution; sits below Server rather than inside it',
      'target.OsString': 'extractor leak: std::ffi::OsString is not declared by this crate',
      'src.DesignNotes': 'extractor leak: a doc-only module surfaced as a struct',
      'src.MacrosReadme': 'extractor leak: a doc-only module surfaced as a struct',
    },
  },
  go: {
    unsettled: {
      'tmux.Warning': 'version-gating diagnostics; plumbing',
      'tmux.WarningHandler': 'version-gating diagnostics; plumbing',
      'tmux.UnsupportedPolicy': 'version-gating diagnostics; plumbing',
      'tmux.SparseArray': 'generic sparse container used by the format parser',
      'tmux.SparseEntry': 'generic sparse container used by the format parser',
      'tmux.SocketSelection': 'socket endpoint resolution; sits below Server rather than inside it',
      'tmux.MenuItem': 'display-menu entry; see the Menus note below',
      'tmux.PromptType': 'command-prompt UI; see the Menus note below',
      'tmux.TreeSortOrder': 'choose-tree UI; see the Menus note below',
      'workspace.Bool': 'extractor leak: a generic helper surfaced as a struct',
    },
  },
  java: {
    unsettled: {
      'io.github.libtmux.Channel.Channel': 'async channel plumbing for control mode',
      'io.github.libtmux.WakeReason.WakeReason': 'async channel plumbing for control mode',
      'io.github.libtmux.FindSpec.FindSpec': 'target addressing; used by every entity, owned by none',
      'io.github.libtmux.TargetIds.TargetIds': 'target addressing; used by every entity, owned by none',
      'io.github.libtmux.batch.Batch.Batch': 'batch execution; no tmux object of its own',
      'io.github.libtmux.batch.OperationOutcome.OperationOutcome':
        'batch execution; no tmux object of its own',
      'io.github.libtmux.jackson.LibTmuxModels.LibTmuxModels':
        'Jackson serialisation registration, not tmux API',
    },
  },
  dotnet: {
    unsettled: {
      'LibTmux.LibTmuxInfo': 'assembly metadata',
      'LibTmux.TmuxChain': 'command chaining builder; sits beside Commands rather than inside it',
      'LibTmux.TmuxChaining': 'command chaining builder; sits beside Commands rather than inside it',
      'LibTmux.TmuxWaitChannel': 'wait-for channel plumbing',
      'LibTmux.TmuxMenuItem': 'display-menu entry; see the Menus note below',
    },
  },
  cxx: {
    unsettled: {
      'libtmux::Chain': 'command chaining builder; sits beside Commands rather than inside it',
      'libtmux::DeliveryStatus': 'notification delivery status; plumbing',
      'libtmux::NodeCollector': 'query lowering helper; below Queries rather than inside it',
      'libtmux::detail::Row': 'extractor leak: a detail:: implementation type',
    },
  },
  swift: {
    unsettled: {
      Endpoint: 'socket endpoint resolution; sits below Server rather than inside it',
      TmuxServers: 'server discovery namespace',
      TmuxContext: 'ambient context threaded through every call',
      TmuxReply: 'raw command reply; sits beside Commands rather than inside it',
      OutputWait: 'wait and watch plumbing',
      SubscriptionChange: 'wait and watch plumbing',
      RegexPattern: 'regex translation for query matching; below Queries rather than inside it',
      RegexUnsupportedConstruct:
        'regex translation for query matching; below Queries rather than inside it',
    },
  },
}

/*
 * The Menus note.
 *
 * Four ports expose the display-menu, command-prompt and choose-tree UI as
 * types — `MenuEntry`, `MenuItem`, `TmuxMenuItem`, `PromptType`,
 * `TreeSortOrder` — and no port has enough of them to earn a bucket. They are
 * left unplaced deliberately rather than filed under Client, which is where a
 * substring rule would have put them. If a fifth port grows the same family,
 * add a `menus` entry to CHAIN and delete these five exemptions; the stale
 * check will fail until they are.
 */

export const NAV: Record<string, PortNav> = Object.fromEntries(
  ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'].map((port) => [
    port,
    {
      port,
      buckets: SHARED,
      unsettled: OVERRIDES[port]?.unsettled,
    },
  ]),
)
