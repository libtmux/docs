/**
 * The agent prompts: text a reader copies into any coding agent to get libtmux
 * working, then to build something with it.
 *
 * THIS MODULE HAS NO VALUE IMPORTS, AND THAT IS LOAD-BEARING. The widget's
 * client script imports `composeFromParts` so the browser composes a selection
 * with exactly the function the server, the `.txt` routes and the tests used.
 * A value import of `ports.ts` would pull `site-root.ts` into that bundle,
 * which reads `process.env` at module scope, and Vite does not polyfill
 * `process` for the browser. Type imports are erased and cost nothing.
 * Callers read `PORTS` and `registryFor` themselves and pass the results in.
 *
 * Prompts are composed from parts rather than written out per combination.
 * Eight ports times nine topics is seventy-two finished prompts; the parts are
 * eight port blocks plus nine topic blocks, and every language-specific fact
 * lives in the port block so a topic is written once. That is what makes the
 * widget cheap enough to put a whole matrix on the landing page, and it is
 * also the only way the topics stay consistent with each other.
 */
import type { InstallForm, Port, RegistryEntry } from './ports'

/**
 * Stands in for the version slug inside a composed prompt.
 *
 * The widget rewrites this after the reader picks a version, the same shape
 * `McpInstall` uses for its cooldown values (`COOLDOWN_DURATION_SENTINEL`).
 * It has to be a string that never occurs in prose: `latest` and `stable` are
 * ordinary English words and appear in several topic bodies, so substituting
 * on the slug itself would rewrite sentences.
 */
export const VERSION_SENTINEL = '__LIBTMUX_VERSION__'

export interface PromptTopic {
  /** URL segment under /prompts/. */
  id: string
  /** Picker label. */
  label: string
  /** One line for the picker and the index page. */
  summary: string
  /** The prompt's opening instruction, which states the outcome. */
  opening: string
  /**
   * What to build, written for no particular language.
   *
   * Anything language-specific belongs in the port block, which every prompt
   * already carries. A topic that needs one port to be told something extra
   * uses `portNotes` rather than forking the body.
   */
  body: string
  /** Site-relative doc paths this topic anchors on, without locale or slashes. */
  pages: readonly string[]
  /** A line appended for one port only, where that port genuinely differs. */
  portNotes?: Readonly<Record<string, string>>
}

/** Where a prompt's doc links point. */
export interface PromptContext {
  /**
   * Absolute site root including the locale, with no trailing slash, e.g.
   * `https://libtmux.org/en`. Prompts are pasted outside this site, so every
   * link has to be absolute, and libtmux.org serves every page under a locale
   * prefix: the unprefixed path answers 403 rather than redirecting.
   */
  docsBase: string
  /** Version slug for port-tree URLs, or the sentinel for a live picker. */
  version: string
}

/**
 * The half of a prompt that does not depend on the language.
 *
 * Shipped once for all eight ports, which is the whole economy of this module.
 * Building the sections per port instead cost 97 KB on the landing page:
 * identical text repeated eight times, because a topic body names no API and
 * its anchors are shared pages that sit above the version axis.
 */
export interface SharedParts {
  /** Opening instruction per topic id. */
  openings: Readonly<Record<string, string>>
  /** Each topic's section, without any port's note. `setup` has none. */
  sections: Readonly<Record<string, string>>
}

/** The half that does depend on the language. */
export interface PortParts {
  /** Context, facts, reading list and setup steps for this port. */
  setup: string
  /** Topic id to this port's extra line, only where the topic writes one. */
  notes: Readonly<Record<string, string>>
}

const SETUP_ID = 'setup'

/**
 * Every topic, in the order the picker shows them.
 *
 * `setup` is first and is the base every other prompt extends, so a reader who
 * picks a topic gets a working install as part of it rather than being told to
 * run a different prompt first.
 */
export const TOPICS: readonly PromptTopic[] = [
  {
    id: SETUP_ID,
    label: 'Set up libtmux',
    summary: 'Install libtmux into a new or existing project and prove it drives a real tmux server.',
    opening: 'Set up libtmux in this repository and verify it against a real tmux server.',
    body: '',
    pages: ['guides/getting-started', 'concepts/server-session-window-pane'],
  },
  {
    id: 'agent-orchestrator',
    label: 'Agent orchestrator',
    summary: 'Run several coding agents in their own panes, stream their output, and notice when each finishes.',
    opening: 'Then build an orchestrator that runs several coding agents side by side in tmux.',
    body: `What it does:
- Takes a list of tasks and starts one agent per task, each in its own pane of
  a dedicated session, so I can watch all of them at once.
- Streams each pane's output as it arrives rather than polling on a timer.
- Detects when an agent has finished or gone quiet, and reports which task that
  was. Say in a comment how you decide "finished", because the agent's exit and
  the shell's prompt returning are different events.
- Lets me attach to the session and take over any pane by hand.

Constraints:
- Do not block the whole orchestrator on one pane. If this language has an
  async or streaming API, use it, and say why you picked the API you did.
- Send input as data, not as shell text the pane will re-parse. Task text can
  contain quotes, newlines and semicolons.
- Tear down cleanly on interrupt, and leave no stray server behind.
- Keep a task's output attributable to that task. Interleaved output nobody can
  attribute is the failure mode here.`,
    pages: ['guides/sending-keys', 'guides/capturing-output', 'concepts/transports'],
    portNotes: {
      py: 'libtmux for Python is synchronous. There is no `async def` in the package, so reach for threads or processes rather than looking for an async API that is not there.',
    },
  },
  {
    id: 'eval-sweep',
    label: 'Eval sweep',
    summary: 'Send one prompt to every agent CLI on this machine in parallel panes and compare the transcripts.',
    opening: 'Then build an eval sweep that runs one prompt across every coding agent on this machine.',
    body: `What it does:
- Finds which agent CLIs are actually on PATH and reports the ones it found,
  rather than assuming a fixed list.
- Runs the same prompt through each of them at the same time, one pane each,
  in a session I can attach to and watch.
- Captures each pane's full transcript to its own file, with the agent name,
  the prompt, and how long the run took.
- Prints a comparison at the end: who answered, who failed, who was slowest.

Constraints:
- Capture the whole transcript, including what scrolled past. A pane's visible
  area is not the run.
- Record wall-clock time per agent from the same clock, so the numbers compare.
- One agent hanging must not stall the sweep. Give each a deadline and record a
  timeout as a result rather than as a crash.
- Do not send my prompt anywhere except the agents I asked for.`,
    pages: ['guides/capturing-output', 'concepts/queries', 'examples/capture-pane-output'],
  },
  {
    id: 'service-manager',
    label: 'Detached service manager',
    summary: 'Start Jupyter and other long-running services in a detached session at login, and reattach later.',
    opening: 'Then build a manager that keeps long-running services in a detached tmux session.',
    body: `What it does:
- Reads a small config listing services to run, each with a name, a working
  directory and a command. Start with a Jupyter notebook server as the worked
  example.
- Starts them in one detached session at login, one window per service, so
  nothing depends on a terminal staying open.
- Is idempotent. Running it twice does not start a second copy of anything;
  it reports what was already up and starts only what was missing.
- Restarts a service that has died, and tells me which one and when.
- Gives me a command to attach and look at any service's output.

Constraints:
- Decide whether a service is running by asking the tmux server what exists,
  not by writing a PID file that outlives the process.
- A service that fails to start must be reported, not silently skipped.
- Say in a comment how this gets invoked at login on this platform, and why
  detached is the right mode.`,
    pages: ['concepts/workspaces', 'concepts/server-session-window-pane', 'examples/workspace-from-file'],
  },
  {
    id: 'session-switcher',
    label: 'Session switcher',
    summary: 'A fuzzy picker over every session, window and pane, that attaches or switches to the selection.',
    opening: 'Then build a tmux session switcher.',
    body: `What it does:
- Lists every session on the server with its windows, and shows what each
  window's active pane is running, so the list says something more useful than
  a set of names.
- Filters as I type and attaches to, or switches the client to, what I pick.
- Works both from outside tmux and from inside it. Those need different calls,
  and getting the inside case wrong is the usual bug here: attaching from
  within a session nests one client inside another.

Constraints:
- Read the live server every time. Do not cache a session list between runs.
- Handle there being no server running at all, which is the first-run case.
- Fetch the listing in as few round trips as the API allows and say how many it
  costs. One call per pane is the slow shape this should avoid.
- Keep it to one file I can read in a sitting.`,
    pages: ['concepts/queries', 'guides/querying-and-filtering', 'guides/attaching-to-tmux'],
  },
  {
    id: 'session-freezer',
    label: 'Session freezer',
    summary: 'Snapshot a running session to a workspace file, then rebuild it later on any machine.',
    opening: 'Then build a session freezer that snapshots a running tmux session and rebuilds it later.',
    body: `What it does:
- Reads a live session and writes a workspace file describing it: windows,
  their names and layouts, each pane's working directory and running command.
- Rebuilds that session from the file, on this machine or another one.
- Round-trips. Freezing a session, rebuilding it, and freezing it again gives
  the same file. Show me that this holds rather than asserting it.

Constraints:
- Record the working directory each pane is actually in, not the directory the
  session started in.
- A running command and a shell sitting at a prompt are different states. Do
  not write a shell prompt out as if it were a command to re-run.
- Say what you deliberately do not capture. Scrollback and program state do not
  survive this, and a reader should know that before trusting it.`,
    pages: ['concepts/workspaces', 'concepts/queries', 'examples/workspace-from-file'],
  },
  {
    id: 'session-supervisor',
    label: 'Session supervisor',
    summary: 'Declare the sessions you want, reconcile what is running, and restart what died.',
    opening: 'Then build a supervisor that reconciles running tmux sessions against a declared set.',
    body: `What it does:
- Reads a declared set of sessions and windows from a file.
- Compares it against what the server is running and reports the difference
  before changing anything.
- Applies the difference: creates what is missing, and leaves alone anything
  already correct.
- Has a dry-run mode that prints the plan and touches nothing.

Constraints:
- Converge. Running it repeatedly against an unchanged server must do nothing
  the second time and say so.
- Never kill a window it did not create unless I pass an explicit flag.
- Compare against the server's own state rather than against a file this tool
  wrote last time.
- Report what changed in terms I can read, not a diff of internal structures.`,
    pages: ['concepts/workspaces', 'concepts/queries', 'guides/querying-and-filtering'],
  },
  {
    id: 'test-fixtures',
    label: 'Test fixtures',
    summary: 'Give each test its own isolated tmux server, torn down afterwards.',
    opening: 'Then set up tmux test fixtures so this project can test code that drives tmux.',
    body: `What it does:
- Gives each test an isolated tmux server on its own socket, so tests do not
  see each other's sessions and do not touch the tmux I am using right now.
- Tears the server down when the test ends, including when it fails.
- Provides a ready-made session or window for tests that need one.
- Includes two example tests: one that creates a session and asserts on it, and
  one that sends input to a pane and asserts on the captured output.

Constraints:
- Use this port's own test helper rather than writing a new one. Find it in the
  API reference above; every port ships something for this. Do not invent a
  name for it.
- Waiting for a program to produce output is a synchronisation problem, not a
  sleep. A fixed delay makes the suite slow and flaky at the same time.
- Make sure a failing test cannot leak a server. Show how the teardown runs on
  the failure path.`,
    pages: ['guides/testing-with-libtmux', 'concepts/transports'],
    portNotes: {
      py: 'The pytest plugin ships with the package: the `server` and `session` fixtures, and `TestServer` for a socket of your own. See src/libtmux/pytest_plugin.py.',
      rs: 'Use `libtmux::test::TestServer`, which runs an isolated server and shuts it down on drop.',
      go: 'Use `tmuxtest.NewServer(ctx, t)` from `github.com/libtmux/libtmux-go/tmux/tmuxtest`, which registers its own cleanup.',
      java: 'Use the JUnit 5 support in `io.github.libtmux.junit5`: `TmuxExtension`, and `NamedServerFixture` when the socket name matters.',
      dotnet: 'Use `LibTmux.Testing.TemporaryServerScope`, which is `IAsyncDisposable`, so `await using` handles teardown on the failure path.',
      cxx: 'Use `libtmux::testing::ScopedTmuxServer` from `<libtmux/testing/scoped_server.hpp>`, whose destructor reports teardown.',
      swift: 'Use `withTmuxServer { }` from the `TmuxFixture` library product, which scopes the server to the closure.',
      ts: 'This port does not export a test fixture yet; its launcher is internal. Build the fixture on the public API and say what you needed that was missing, so it can be vended properly.',
    },
  },
  {
    id: 'output-watcher',
    label: 'Output watcher',
    summary: 'Wait for text to appear in a pane, then act on it, without polling on a timer.',
    opening: 'Then build a watcher that waits for output in a tmux pane and acts on it.',
    body: `What it does:
- Watches one or more panes for a pattern I give it.
- Runs an action when the pattern appears: print it, run a command, or send
  input back into that pane.
- Keeps watching after a match, so a long-running build that prints several
  interesting lines produces several events.

Constraints:
- Do not poll on a fixed interval if this port offers a way to be notified.
  Say which mechanism you used and why.
- Do not miss output that arrives between two reads, and do not report the same
  line twice. Say how your approach avoids both.
- Match against text that has already had terminal escapes handled, so a
  pattern does not fail on invisible bytes.
- Give it a timeout, and make a timeout a result the caller can handle.`,
    pages: ['guides/capturing-output', 'examples/capture-pane-output', 'concepts/transports'],
    portNotes: {
      py: 'Python is the one port whose persistent control client is not public: `ControlMode` lives in `libtmux._internal`. Poll captured output behind `retry_until` from `libtmux.test.retry`, which takes a predicate, an interval and a timeout, rather than reaching into the private module or writing a bare sleep.',
    },
  },
]

export const TOPIC_BY_ID: Readonly<Record<string, PromptTopic>> = Object.fromEntries(
  TOPICS.map((topic) => [topic.id, topic]),
)

/** A doc page's absolute URL. Shared prose sits above the version axis. */
function pageUrl(ctx: PromptContext, path: string): string {
  return `${ctx.docsBase}/${path}/`
}

/** A port-tree URL, which does carry the version. */
function portUrl(ctx: PromptContext, port: Port, path: string): string {
  return `${ctx.docsBase}/${port.slug}/${ctx.version}/${path}`
}

/**
 * Hard-wrap prose to a fixed column with a hanging indent.
 *
 * Prompts are pasted into chat boxes, terminals and issue bodies, none of which
 * agree about soft wrapping, and several of which do not wrap at all. A
 * paragraph that arrives as one 300-character line is unreadable in a terminal
 * and unscannable everywhere. 76 leaves room for a quote marker.
 */
export function wrap(text: string, width = 76, indent = ''): string {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length + indent.length > width && line) {
      lines.push(indent + line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(indent + line)
  return lines.join('\n')
}

/**
 * A scannable list of links with what each one is.
 *
 * Aligned into two columns when that fits, because a column of URLs is what a
 * reader scans. A URL cannot be wrapped without breaking it, so one long URL
 * would otherwise push every row in its list past the margin: Go's
 * `pkg.go.dev/github.com/libtmux/libtmux-go/tmux` is 53 characters and widens
 * the pad for all four of its rows. When alignment does not fit, the whole
 * list drops its notes to their own indented line rather than leaving some
 * rows aligned and others not.
 */
function linkList(entries: readonly (readonly [string, string])[], width = 80): string {
  const pad = Math.max(...entries.map(([url]) => url.length))
  const fits = entries.every(([, note]) => pad + note.length + 4 <= width)
  if (fits) return entries.map(([url, note]) => `- ${url.padEnd(pad)}  ${note}`).join('\n')
  return entries.map(([url, note]) => `- ${url}\n  ${note}`).join('\n')
}

/**
 * The install step, stated so an agent knows whether to trust the pin.
 *
 * Two sentences and a command. The wording comes from the registry state
 * rather than from a fixed template, because "there is no stable release" and
 * "this is the current release" call for opposite advice about checking for
 * something newer.
 */
function installStep(port: Port, entry: RegistryEntry, install: InstallForm, wording: string): string {
  const lines = [wrap(`3. Add the dependency. ${wording}`, 76, '').replace(/\n/g, '\n   ')]
  // Indented as a block rather than prefixed with `$`: half these forms are
  // manifest lines, not shell commands, and a prompt that tells an agent to
  // run `implementation("...")` in a shell gets exactly that.
  lines.push(install.code.split('\n').map((line) => `       ${line}`).join('\n'))
  const check =
    entry.status === 'stable'
      ? `Check ${(port.registry?.url ?? `https://github.com/${port.repo}`)} if you need a different version.`
      : `Check ${(port.registry?.url ?? `https://github.com/${port.repo}`)} for a newer version, and prefer a stable release over this one if there now is any.`
  lines.push(wrap(check, 76, '   '))
  if (port.installNote) lines.push(wrap(port.installNote, 76, '   '))
  return lines.join('\n')
}

/**
 * Every topic's section, built once and shared by all eight ports.
 *
 * Takes only the context, which is the proof that a topic body is
 * language-independent: there is no `Port` in scope to leak one in.
 */
export function sharedParts(ctx: PromptContext): SharedParts {
  const sections: Record<string, string> = {}
  const openings: Record<string, string> = {}
  for (const topic of TOPICS) {
    openings[topic.id] = topic.opening
    if (topic.id === SETUP_ID) continue
    const anchors = topic.pages.map((path) => [pageUrl(ctx, path), pageTitle(path)] as const)
    sections[topic.id] = [
      // The label repeated as a header. The opening instruction is at the top
      // of the prompt and the work is at the bottom, with the whole setup block
      // between them, so without this the reader meets "What it does" with
      // nothing saying what "it" is.
      topic.label,
      '',
      topic.body,
      '',
      'Anchor it in these pages:',
      linkList(anchors),
    ].join('\n')
  }
  return { openings, sections }
}

/**
 * One port's share of every prompt.
 *
 * Everything here is a fact about the port or the registry. Nothing about what
 * the reader is building appears, which is what lets one topic body serve all
 * eight languages.
 */
export function portParts(args: {
  port: Port
  entry: RegistryEntry
  install: InstallForm
  /** `releaseWording(port, entry)`; passed in so this module imports no values. */
  wording: string
  ctx: PromptContext
}): PortParts {
  const { port, entry, install, wording, ctx } = args

  const reading: (readonly [string, string])[] = [
    [portUrl(ctx, port, 'llms.txt'), `every page for ${port.name}, as a list`],
    [portUrl(ctx, port, 'docs.json'), 'the same list with headings, as JSON'],
    [`${ctx.docsBase}/reference/${port.slug}/`, `the ${port.name} API reference`],
  ]
  if (port.ecosystemHost) {
    reading.push([port.ecosystemHost.url, `${port.name} reference on ${port.ecosystemHost.name}`])
  }

  const setup = [
    'libtmux drives a real tmux server from code. It gives you objects for the',
    'server, its sessions, windows and panes. Documentation for every language',
    `is at ${ctx.docsBase}/.`,
    '',
    `Language:   ${port.language}`,
    `Package:    ${port.packageName} (${(port.registry?.name ?? 'its repository')})`,
    `Repository: https://github.com/${port.repo}`,
    '',
    'Read these before writing code:',
    linkList(reading),
    'If you cannot fetch URLs, clone the repository above and read its README',
    'and examples instead, or ask me to paste those pages in.',
    '',
    'Set up first:',
    '1. Report the tmux version with `tmux -V`. libtmux drives a real tmux, so',
    '   nothing below works without one. Stop and tell me if it is missing.',
    ...(port.initProject.lang === 'text'
      ? [wrap(`2. If this directory is not a ${port.language} project yet, ${port.initProject.code}`, 76, '').replace(/\n/g, '\n   ')]
      : [
          `2. If this directory is not a ${port.language} project yet, start one:`,
          `       ${port.initProject.code}`,
        ]),
    '   Skip this in a project that already exists, and match what is here.',
    installStep(port, entry, install, wording),
    '4. Write the smallest program that proves the install works: connect to a',
    '   tmux server, create a session, confirm it is there, then kill it. Give',
    '   that server a socket of its own rather than using the default one, so',
    '   this never touches a tmux I am already running. Run it, and show me the',
    '   output and the files you added.',
    '',
    'Rules for everything below:',
    '- Use the reference above rather than guessing names. The eight libtmux',
    '  ports do not share spellings, and a name from another language will look',
    '  plausible and not exist.',
    '- If the reference does not have something you expected, say so instead of',
    '  writing a call that does not exist.',
    '- Follow the conventions already in this repository.',
  ].join('\n')

  const notes: Record<string, string> = {}
  for (const topic of TOPICS) {
    const note = topic.portNotes?.[port.slug]
    if (note) notes[topic.id] = wrap(`For ${port.name}: ${note}`)
  }

  return { setup, notes }
}

/** A readable label for a doc path, for the right-hand column of a link list. */
function pageTitle(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1)
  return last.replace(/-/g, ' ')
}

/**
 * The finished prompt for one port and topic.
 *
 * This is the function the browser runs too, so it stays a pure string
 * operation over the two halves. The widget ships the shared half once and one
 * port block each, then calls this on every picker change rather than
 * downloading seventy-two finished prompts.
 */
export function composeFromParts(shared: SharedParts, port: PortParts, topicId: string): string {
  const opening = shared.openings[topicId]
  if (!opening) throw new Error(`composeFromParts: no topic "${topicId}"`)
  const section = shared.sections[topicId]
  const note = port.notes[topicId]
  return [
    wrap(opening),
    '',
    port.setup,
    ...(section ? ['', section] : []),
    ...(note ? ['', note] : []),
  ].join('\n')
}

/** Convenience for the routes and tests, which have the port to hand. */
export function composePrompt(args: Parameters<typeof portParts>[0] & { topicId: string }): string {
  return composeFromParts(sharedParts(args.ctx), portParts(args), args.topicId)
}
