import type { Bucket, Match, PortNav } from './nav.ts'

/**
 * The reference sidebar, curated once for all ten ports.
 *
 * THE BUCKETS ARE SHARED, and that is a finding rather than a convenience:
 * every port declares Server, Session, Window, Pane and
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
 * A symbol that owns no members: a function, a value or a type alias.
 *
 * The `name` patterns below were written for the types that do. A free
 * symbol is `has_version`, `paneStartDirectory` or `TMUX_MIN_VERSION`, so each
 * rule also matches the words of its name, or the last segment of its module,
 * for these kinds only: no type with members can move because of a word. A
 * word is the weakest clause and decides only where no other clause of any
 * rule claims the symbol; see `compileNav`.
 */
const FREE: Match = {
  kind: 'symbol',
  kinds: ['function', 'method', 'constant', 'attribute', 'property', 'typealias'],
}

/** Declared in one of these files, for a free symbol only. */
const freePath = (re: string): Match => ({ kind: 'allOf', of: [FREE, { kind: 'path', re }] })

const words = (...is: string[]): Match => ({
  kind: 'allOf',
  of: [
    FREE,
    {
      kind: 'anyOf',
      // `libtmux::pane::id` is a pane field whose own name says nothing.
      of: [{ kind: 'word', is }, { kind: 'module', re: `(^|[.:/])(${is.join('|')})$` }],
    },
  ],
})

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
const nameOrPath = (re: string, pathRe: string, ...vocabulary: string[]): Match => ({
  kind: 'anyOf',
  of: [nameRe(re), { kind: 'path', re: pathRe }, ...(vocabulary.length ? [words(...vocabulary)] : [])],
})

/**
 * A tmux object's own bucket: its name, or its file when no later bucket names it.
 *
 * A file groups what an object's implementation needs, not only the object.
 * Lua declares `CommandOutcome` in `server.lua` and TypeScript the same type
 * in `common.ts`; by path alone the Lua one sat under Server while its twin
 * sat under Commands. A name says what a type is, so a name rule further down
 * the chain outranks this path. The name clauses here stay as strong as
 * before: `PaneCommand` is still a Pane type.
 */
const hierarchy = (re: string, pathRe: string, ...vocabulary: string[]): Match => ({
  kind: 'anyOf',
  of: [
    nameRe(re),
    {
      kind: 'allOf',
      of: [{ kind: 'path', re: pathRe }, { kind: 'not', of: nameRe(Object.values(ATTACHED_NAMES).join('|')) }],
    },
    words(...vocabulary),
  ],
})

/** The name rules of the buckets that hang off the hierarchy, which its paths yield to. */
const ATTACHED_NAMES = {
  options: '^Option|Option$',
  keys: 'Key|Binding',
  buffers: 'Buffer',
  layout: 'Layout|Split|Resize|Direction|Dimension|Rotation',
  environment: 'Environment',
  capabilities: 'Capabilit|Terminal',
  version: 'Version|Release',
  commands:
    'Command|Cmd|cmd|Dispatch|Transport|Connection|Process|Receipt|^Running$|^TmuxArg$|^TmuxWait$|^ReadyStatus$|^WaitPath$',
}

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
    // Go's sentinel values, `ErrNoServer` and `ErrUnknownOption`: an error
    // whatever it is about and wherever it is declared, as an error type is.
    { kind: 'allOf', of: [FREE, nameRe('^Err[A-Z]')] },
    words('error', 'errors', 'exception', 'raise'),
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
  { id: 'mcp', label: 'MCP', match: nameOrPath('Mcp|MCP', 'mcp', 'mcp') },
  { id: 'async', label: 'Async', match: nameOrPath('Async', '(^|/)libtmux-async/', 'async') },
  {
    id: 'runtime',
    label: 'Runtime adapters',
    match: {
      kind: 'allOf',
      of: [
        { kind: 'symbol', kinds: ['module'] },
        { kind: 'path', re: '(^|/)runtime/' },
      ],
    },
  },
  {
    id: 'testing',
    label: 'Testing utilities',
    // Less the module logger, which goes to Internal with the others even when
    // its module is `pytest_plugin.py`.
    match: {
      kind: 'allOf',
      of: [
        nameOrPath('Test|Fixture|Mock|Fake', 'test|fixture|mock|junit', 'test', 'tests', 'testing', 'fixture', 'mock', 'fake'),
        { kind: 'not', of: { kind: 'allOf', of: [FREE, nameRe('^logger$')] } },
      ],
    },
  },
  {
    id: 'internal',
    label: 'Internal',
    match: {
      kind: 'anyOf',
      of: [
        nameRe('Internal|Generated'),
        // A public API can live in a private implementation directory. Lua
        // exposes Server, Session, Window, Pane and Client from `_internal/`;
        // their public contract outranks that layout detail while retained
        // internal declarations still stay here.
        {
          kind: 'allOf',
          of: [
            { kind: 'not', of: { kind: 'apiScope', is: 'exported' } },
            { kind: 'path', re: '(^|/)_?internal' },
          ],
        },
        // .NET says so in the namespace and nowhere else: `Materializer` sits
        // in `Materialization/` and is declared in `LibTmux.Internal`.
        { kind: 'module', re: '(^|\\.)_?[Ii]nternal(\\.|$)' },
        // A module's logger, in whichever module: plumbing, not Server's API
        // because `server.py` declares one.
        { kind: 'allOf', of: [FREE, nameRe('^logger$')] },
        // C++'s `detail` namespace and ABI macros, and its `expected` polyfill.
        words('internal', 'detail', 'abi', 'namespace'),
        freePath('(^|/)expected\\.hpp$'),
        // Package metadata: `__author__` and `__license__` are not versions,
        // though `__version__` beside them is, and goes to Versions.
        { kind: 'allOf', of: [freePath('(^|/)__about__\\.'), { kind: 'not', of: nameRe('^__version__$') }] },
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
      kind: 'allOf',
      of: [
        {
          kind: 'anyOf',
          of: ['Kind', 'Mode', 'Style', 'Action', 'Options', 'Result', 'Event'].map(
            (suffix): Match => ({ kind: 'name', suffix }),
          ),
        },
        // Suffixes that name a type. `normalizePlanWorkspaceOptions` is a
        // function that takes one.
        { kind: 'not', of: { kind: 'symbol', kinds: ['function', 'method'] } },
      ],
    },
  },
  // Cross-cutting subsystems: these words appear inside domain type names.
  { id: 'hooks', label: 'Hooks', match: nameOrPath('Hook', '(^|/)hooks?[./]', 'hook', 'hooks') },
  {
    id: 'control',
    label: 'Control mode',
    match: {
      kind: 'anyOf',
      of: [
        nameOrPath(
          'Control|Notification|Subscribe',
          '(^|/)control',
          'control', 'notification', 'notifications', 'subscribe', 'subscription',
        ),
        freePath('(^|/)notification\\.hpp$'),
      ],
    },
  },
  {
    id: 'formats',
    label: 'Formats',
    match: {
      kind: 'anyOf',
      of: [
        nameOrPath('Format', '(^|/)formats?[./]', 'format', 'formats'),
        // Python's `neo` builds a format string per object and parses the
        // rows it asks for; `libtmux.neo.Obj` itself stays unsettled.
        freePath('(^|/)neo\\.py$'),
        // Lua's `libtmux.Fields.Session` and its siblings are the format
        // fields a record of each kind carries. Named after the object, they
        // otherwise took its bucket, and Session opened on a field list
        // instead of the handle that has the methods.
        // Java's `query.Fields` is the query builder's own class, and stays.
        {
          kind: 'allOf',
          of: [
            { kind: 'module', re: '(^|[.:])Fields$' },
            nameRe('^(Server|Session|Window|WindowLink|Pane|Client|Buffer)$'),
          ],
        },
      ],
    },
  },
  {
    id: 'queries',
    label: 'Queries',
    match: {
      kind: 'anyOf',
      of: [
        nameOrPath(
          'Query|Filter|Predicate|Matcher|Criteria|Operator|Quantifier|Expr|Node$|Field$',
          '(^|/)quer(y|ies)[./]|(^|/)matching|(^|/)filter',
          'query', 'queries', 'filter', 'predicate', 'matcher', 'criteria', 'where', 'relation', 'field', 'fields',
        ),
        // The query language's own files, whose helpers are `any_of`,
        // `children_of` and `WhereOf`.
        freePath('(^|/)(selection\\.ts|relations\\.hpp|cardinality\\.hpp|lowering\\.hpp|legacy_lookup\\.hpp)$'),
      ],
    },
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    match: {
      kind: 'anyOf',
      of: [
        nameOrPath('Snapshot|Capture|^TextOutcome$|^TypedText$', '(^|/)snapshots?[./]', 'snapshot', 'capture'),
        { kind: 'path', re: '(^|/)libtmux/selection\\.rb$' },
        freePath('(^|/)capture\\.hpp$'),
      ],
    },
  },
  {
    id: 'workspace',
    label: 'Workspaces',
    match: {
      kind: 'anyOf',
      of: [
        nameOrPath('Workspace|Plan', '(^|/)plan[./]|(^|/)tmuxp/', 'workspace', 'plan'),
        // A workspace package's own functions, whatever they are named:
        // TypeScript's `paneStartDirectory` reads a workspace file's pane.
        {
          kind: 'allOf',
          of: [FREE, { kind: 'path', re: '(^|/)(packages/|crates/tmux-)?workspace/|libtmux_consumers/' }],
        },
      ],
    },
  },
  // tmux's own object hierarchy, in tmux's order.
  {
    id: 'server',
    label: 'Server',
    match: hierarchy('^Server|Server$', '(^|/)server[./]', 'server', 'socket', 'daemon'),
  },
  { id: 'session', label: 'Session', match: hierarchy('Session', '(^|/)session[./]', 'session', 'sessions') },
  { id: 'window', label: 'Window', match: hierarchy('Window', '(^|/)window[./]', 'window', 'windows') },
  { id: 'pane', label: 'Pane', match: hierarchy('Pane', '(^|/)pane[./]', 'pane', 'panes') },
  { id: 'client', label: 'Client', match: hierarchy('Client', '(^|/)client[./]', 'client', 'clients') },
  // What hangs off the hierarchy.
  { id: 'options', label: 'Options', match: nameOrPath(ATTACHED_NAMES.options, '(^|/)options?', 'option', 'options') },
  {
    id: 'keys',
    label: 'Keys and bindings',
    match: nameOrPath(ATTACHED_NAMES.keys, '(^|/)(keys?|binding)', 'key', 'keys', 'binding'),
  },
  { id: 'buffers', label: 'Buffers', match: nameOrPath(ATTACHED_NAMES.buffers, '(^|/)buffers?[./]', 'buffer', 'buffers') },
  {
    id: 'layout',
    label: 'Layout and geometry',
    match: nameOrPath(
      ATTACHED_NAMES.layout,
      '(^|/)layouts?[./]',
      'layout', 'split', 'resize', 'direction', 'dimension', 'rotation',
    ),
  },
  {
    id: 'environment',
    label: 'Environment',
    match: nameOrPath(ATTACHED_NAMES.environment, '(^|/)environment', 'environment', 'env'),
  },
  {
    id: 'capabilities',
    label: 'Terminal capabilities',
    match: nameOrPath(ATTACHED_NAMES.capabilities, '(^|/)capabilit', 'capability', 'capabilities', 'terminal'),
  },
  {
    id: 'version',
    label: 'Versions',
    match: nameOrPath(ATTACHED_NAMES.version, '(^|/)versions?[./]|(^|/)__about__\\.|(^|/)build_info\\.go$', 'version', 'release'),
  },
  {
    id: 'commands',
    label: 'Commands',
    match: nameOrPath(
      ATTACHED_NAMES.commands,
      '(^|/)(commands?|dispatch|transport|connection|process)|(^|/)libtmux/endpoint\\.rb$',
      'command', 'commands', 'cmd', 'dispatch', 'transport', 'connection', 'process', 'engine',
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
  'runtime',
  'async',
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

/**
 * A split by what a symbol is rather than by its name.
 *
 * For the buckets that free symbols made long: Rust's Options holds 218
 * generated constants beside its 3 types, Python's Workspaces 120 tmuxp
 * functions, and its MCP bucket 94. Types never match either child, so a
 * bucket still opens on its types.
 */
const BY_KIND: Split[] = [
  { id: 'functions', label: 'Functions', match: { kind: 'symbol', kinds: ['function', 'method'] } },
  {
    id: 'constants',
    label: 'Constants and variables',
    match: { kind: 'symbol', kinds: ['constant', 'attribute', 'property'] },
  },
]

/** A child of a split bucket: a name pattern, or any rule. */
type Split = { id: string; label: string; re?: string; match?: Match }
const splitMatch = (c: Split): Match => c.match ?? nameRe(c.re ?? '')

const SPLITS: Record<string, Split[]> = {
  options: BY_KIND,
  mcp: BY_KIND,
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
    ...BY_KIND,
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
                splitMatch(c),
                ...splits.slice(0, i).map((prev): Match => ({ kind: 'not', of: splitMatch(prev) })),
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
  lua: {
    unsettled: {
      'libtmux.Configurable': 'options and hooks shared by sessions, windows and panes; the concrete handle is the subclass',
      'libtmux.Creation': 'creation receipt shared by several tmux objects',
      'libtmux.Entity': 'base of the tmux entity hierarchy; the concrete entity is the subclass',
      'libtmux.LinkDestination': 'window-link target shared by sessions and windows',
      'libtmux.Observation': 'observation record shared by several tmux objects',
      'libtmux.ObservationCoverage': 'observation coverage metadata shared by several tmux objects',
      'libtmux.Reference': 'target reference shared by every tmux entity',
      'libtmux.Runtime': 'runtime protocol shared by host integrations',
      'libtmux.Watch': 'watch handle shared by several tmux objects',
    },
  },
  ruby: {
    unsettled: {
      'LibTmux::Entity': 'base of the tmux entity hierarchy; the concrete entity is the subclass',
      'LibTmux::EntityRef': 'target identity shared by every entity, owned by none',
    },
  },
  py: {
    unsettled: {
      'libtmux._vendor._structures.InfinityType': 'vendored from packaging; version comparison, not tmux',
      'libtmux._vendor._structures.NegativeInfinityType':
        'vendored from packaging; version comparison, not tmux',
      'libtmux.constants._DefaultOptionScope': 'private sentinel for an option scope left unset',
      'libtmux.neo.Obj': 'base of the neo object layer; the tmux entity is the subclass',
      'libtmux.__all__': 'the package export list, not an API of its own',
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
      'types.MenuItem': 'display-menu entry; see the Menus note below',
      'common.TmuxId': 'tmux object ids; used by every entity, owned by none',
      'common.TmuxIdInput': 'tmux object ids; used by every entity, owned by none',
      'common.LogicalRef': 'union of the entity reference types; the tmux entity is the member',
      'common.SafeInteger': 'integer validation for numbers tmux reports; plumbing',
      'common.isSafeInteger': 'integer validation for numbers tmux reports; plumbing',
      'common.safeInteger': 'integer validation for numbers tmux reports; plumbing',
      'common.DeliveryStatus': 'notification delivery status; plumbing',
      'common.OperationStatus': 'operation outcome status; no tmux object of its own',
      'common.TmuxLogContext': 'diagnostics plumbing; no tmux object of its own',
      'common.TmuxInvocationReport': 'invocation diagnostics shared by every entity',
      'common.TmuxInvocationObserver': 'invocation diagnostics shared by every entity',
      'field_types.RowWithIdentities': 'row typing shared by every entity, owned by none',
      'types.Digit': 'numeric literal types for tmux indices',
      'types.NonZeroDigit': 'numeric literal types for tmux indices',
      'types.ZeroToNinetyNine': 'numeric literal types for tmux indices',
      'types.isTmuxName': 'tmux name validation; used by every entity, owned by none',
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
      'src.MigrationGuide': 'extractor leak: a doc-only module surfaced as a struct',
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
      'tmux.Poll': 'wait and watch plumbing',
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
      'LibTmux.TmuxDiagnostics': 'diagnostic source names shared by every entity',
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
      'libtmux::path_component': 'target addressing; used by every entity, owned by none',
      'libtmux::EntityId': 'tmux object ids; used by every entity, owned by none',
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
  ['py', 'ruby', 'lua', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift'].map((port) => [
    port,
    {
      port,
      buckets: SHARED,
      unsettled: OVERRIDES[port]?.unsettled,
    },
  ]),
)
