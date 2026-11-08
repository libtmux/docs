/**
 * The workspace configurations the showcase may show, and the tests that load
 * them.
 *
 * A configuration appears here only when a test in the port's own repository
 * loads it through the loader the port's `load` command uses. That is a fixture
 * file a test reads, an example or README the CLI's test runs, or a verbatim
 * document inside a test source. A document a test assembles from escaped
 * strings or builds in code is not text a reader can copy, so it is absent;
 * so is a fixture that only the port's library decoder reads when the command
 * has its own loader.
 *
 * `topic` places an example under a tmuxp classic. `also` names the other
 * classics the same file shows. `site/test/workspace-showcase.test.ts`
 * checks that each claimed topic holds in the parsed document.
 *
 * Each test names a file in the same repository and a string to look for in it
 * (`find`, which defaults to `name`). `needles` are further strings the file
 * must contain, normally the fixture's file name, so a test that stops
 * mentioning its fixture fails the generator rather than staying listed.
 * `via` says how the test loads the file:
 *   `cli`        runs the port's workspace command: spawns its binary or calls
 *                the entry point its `main` calls.
 *   `loader`     calls the loader function the command is built on.
 *   `builder`    calls the session builder the command is built on.
 *   `library`    calls a library parser that shares the grammar with the
 *                command but is not the code the command runs.
 *   `scheduled`  a scheduled parity run loads the file; no test gate on pull
 *                requests runs it.
 * `checks` must say the same: a `loader`, `builder` or `library` row reads
 * "calls", never "runs the command".
 */

import { basename } from 'node:path'

/** Every value `via` may take; the generator refuses any other. */
export const VIA = ['cli', 'loader', 'builder', 'library', 'scheduled']

/**
 * The presets, in the order the page shows them: the tmuxp classics, then the
 * rest of tmuxp's examples under their file names.
 */
export const TOPICS = [
  'shorthand',
  'two-pane',
  'three-pane',
  'four-pane',
  'tiled',
  'main-horizontal',
  'shell-command-before',
  'environment',
  'start-directory',
  '2-pane-synchronized',
  'blank-panes',
  'env-variables',
  'focus-window-and-panes',
  'main-pane-height-percentage',
  'minimal',
  'options',
  'pane-shell',
  'skip-send',
  'skip-send-pane-level',
  'sleep',
  'sleep-pane-level',
  'sleep-virtualenv',
  'suppress-history',
  'window-index',
]

/** The files in tmuxp's examples directory that the support table covers. */
export const TMUXP_EXAMPLES = [
  '2-pane-synchronized', '2-pane-vertical', '3-pane', '4-pane', 'blank-panes', 'env-variables',
  'focus-window-and-panes', 'main-pane-height-percentage', 'main-pane-height', 'minimal', 'options',
  'pane-shell', 'plugin-system', 'session-environment', 'shorthands', 'skip-send-pane-level', 'skip-send',
  'sleep-pane-level', 'sleep-virtualenv', 'sleep', 'start-directory', 'suppress-history', 'window-index',
]

/** The tmuxp example a classic topic is drawn from, when a port tests a different file for it. */
export const TOPIC_EXAMPLES = {
  shorthand: 'shorthands',
  'two-pane': '2-pane-vertical',
  'three-pane': '3-pane',
  'four-pane': '4-pane',
  'main-horizontal': 'main-pane-height',
  environment: 'session-environment',
  'start-directory': 'start-directory',
}

/** A fixture read whole. */
const file = (path) => ({ path })

/** A document quoted inside a file, between a literal opening and closing marker. */
const inside = (path, open, close, { after } = {}) => ({ path, extract: { open, close, ...(after ? { after } : {}) } })

/** The scheduled parity run: a CI job on a weekly schedule, not a test that gates pull requests. */
const PARITY = {
  path: 'scripts/tmuxp-parity.py',
  name: 'run_fixture',
  find: '[str(args.binary), "load", "-d", "-y", "-L", WORKSPACE_SOCKET',
  needles: ['crates/tmux-workspace/tests/fixtures/tmuxp'],
  via: 'scheduled',
  checks: 'Loads each fixture in the directory with tmux-workspace load and with tmuxp, each on its own tmux server, and compares the sessions, windows and panes tmux reports. A scheduled CI job runs it each week; pull requests do not.',
}

const RS_FIXTURES = 'crates/tmux-workspace/tests/fixtures/tmuxp'

/** The test that parses the command-level settings of the fixture `needle`. */
const RS_COMMAND_SETTINGS = (needle) => ({
  path: 'crates/tmux-workspace/tests/build.rs', name: 'a_command_may_carry_its_own_settings', needles: [needle], via: 'library',
  checks: 'Parses the example and checks the enter and sleep settings of each command.',
})

const RS_PARSES = {
  path: 'crates/tmux-workspace/tests/build.rs',
  name: 'every_tmuxp_example_parses',
  needles: ['tests/fixtures/tmuxp'],
  via: 'library',
  checks: 'Parses every fixture in the directory.',
}

/**
 * tmuxp's examples as a port keeps them: each file's topic, and the other
 * classics it shows. `plugin-system` is absent, as for Rust, because a plugin
 * runs through a Python bridge.
 */
const TMUXP_CATALOG = [
  ['shorthands', 'shorthand', []],
  ['2-pane-vertical', 'two-pane', []],
  ['3-pane', 'three-pane', ['shell-command-before']],
  ['4-pane', 'four-pane', ['tiled']],
  ['main-pane-height', 'main-horizontal', ['three-pane']],
  ['session-environment', 'environment', []],
  ['2-pane-synchronized', '2-pane-synchronized', []],
  ['blank-panes', 'blank-panes', ['start-directory']],
  ['env-variables', 'env-variables', ['start-directory']],
  ['focus-window-and-panes', 'focus-window-and-panes', ['shell-command-before']],
  ['main-pane-height-percentage', 'main-pane-height-percentage', ['three-pane', 'main-horizontal', 'start-directory']],
  ['minimal', 'minimal', []],
  ['options', 'options', ['main-horizontal', 'three-pane', 'start-directory']],
  ['pane-shell', 'pane-shell', []],
  ['skip-send', 'skip-send', []],
  ['skip-send-pane-level', 'skip-send-pane-level', []],
  ['sleep', 'sleep', []],
  ['sleep-pane-level', 'sleep-pane-level', []],
  ['sleep-virtualenv', 'sleep-virtualenv', ['shell-command-before']],
  ['start-directory', 'start-directory', []],
  ['suppress-history', 'suppress-history', []],
  ['window-index', 'window-index', []],
]

/**
 * The examples a port gets from tmuxp's catalog in `directory`. Each test
 * loads every file in it, so a test names the files its loader refuses in
 * `refuses` and the example does not cite it. `skip` names files a port keeps
 * out: a loader that reads a file but builds it differently from tmuxp, which
 * the support table marks unsupported, and a file whose topic the port already
 * shows with a stronger test. `prefix` starts each file's name.
 */
const tmuxpCatalog = (directory, tests, { skip = [], prefix = '' } = {}) => TMUXP_CATALOG.flatMap(([name, topic, also]) => {
  if (skip.includes(name)) return []
  const citing = tests.filter((test) => !test.refuses?.includes(name)).map(({ refuses, ...test }) => test)
  return citing.length ? [{ topic, also, source: file(`${directory}/${prefix}${name}.yaml`), tests: citing }] : []
})

/** @type {Record<string, { checkout?: string, examples: object[] }>} */
export const SOURCES = {
  py: {
    checkout: process.env.LIBTMUX_DOCS_CHECKOUT_TMUXP || '~/work/python/tmuxp',
    examples: [
      {
        topic: 'shorthand', also: [],
        source: file('tests/fixtures/workspace/expand2-unexpanded.yaml'),
        tests: [{
          path: 'tests/workspace/test_config.py', name: 'test_workspace_expand2', needles: ['expand2.unexpanded_yaml'], via: 'loader',
          checks: 'Expands the file and compares it with the expanded fixture. Starts no tmux.',
        }],
      },
      {
        topic: 'two-pane', also: [],
        source: file('tests/fixtures/workspace/builder/two_pane.yaml'),
        tests: [
          {
            path: 'tests/workspace/test_builder.py', name: 'test_split_windows', needles: ['builder/two_pane.yaml'], via: 'builder',
            checks: 'Creates each window and its panes in a tmux session and checks the window count.',
          },
          {
            path: 'tests/cli/test_load.py', name: 'test_load_workspace', needles: ['two_pane.yaml'], via: 'loader',
            checks: 'Calls load_workspace, the function the tmuxp load command is built on, detached on a real tmux server and checks the session name. The command itself does not run.',
          },
        ],
      },
      {
        topic: 'main-horizontal', also: ['three-pane'],
        source: file('tests/fixtures/workspace/builder/three_pane.yaml'),
        tests: [{
          path: 'tests/workspace/test_builder.py', name: 'test_layout_main_horizontal', needles: ['three_pane.yaml'], via: 'builder',
          checks: 'Builds the session and checks the pane count, the height of the top pane and the pane widths.',
        }],
      },
      {
        topic: 'shell-command-before', also: [],
        source: file('tests/fixtures/workspace/shell_command_before_session.yaml'),
        tests: [{
          path: 'tests/workspace/test_config.py', name: 'test_in_session_scope', needles: ['shell_command_before_session.before'], via: 'loader',
          checks: 'Validates and expands the file and compares it with the expected fixture. Starts no tmux.',
        }],
      },
      {
        topic: 'environment', also: [],
        source: file('tests/fixtures/workspace/builder/environment_vars.yaml'),
        tests: [{
          path: 'tests/workspace/test_builder.py', name: 'test_environment_variables', needles: ['environment_vars.yaml'], via: 'builder',
          checks: 'Builds the session and checks the session environment and the value each pane sees.',
        }],
      },
      {
        topic: 'start-directory', also: ['two-pane'],
        source: file('tests/fixtures/workspace/builder/first_pane_start_directory.yaml'),
        tests: [{
          path: 'tests/workspace/test_builder.py', name: 'test_first_pane_start_directory', needles: ['first_pane_start_directory.yaml'], via: 'builder',
          checks: 'Builds the session and checks each pane\'s working directory.',
        }],
      },
      {
        topic: 'blank-panes', also: [],
        source: file('examples/blank-panes.yaml'),
        tests: [
          {
            path: 'tests/workspace/test_builder.py', name: 'test_blank_pane_spawn', needles: ['blank-panes.yaml'], via: 'builder',
            checks: 'Builds the session and checks the pane count of each window.',
          },
          {
            path: 'tests/workspace/test_config.py', name: 'test_expands_blank_panes', needles: ['blank-panes.yaml'], via: 'loader',
            checks: 'Expands the file and checks that each blank pane has no command. Starts no tmux.',
          },
        ],
      },
    ],
  },

  // These ports ship a workspace manager whose tests give no document that can be quoted.
  // TypeScript is filled in below, from the fixtures its tests load.
  ts: { examples: [] },
  java: { examples: [] },
  swift: { examples: [] },

  rs: {
    examples: [
      { topic: 'shorthand', also: [], source: file('crates/tmux-workspace/tests/fixtures/tmuxp/shorthands.yaml'), tests: [RS_PARSES, PARITY] },
      { topic: 'two-pane', also: [], source: file('crates/tmux-workspace/tests/fixtures/tmuxp/2-pane-vertical.yaml'), tests: [RS_PARSES, PARITY] },
      {
        topic: 'three-pane', also: ['shell-command-before'],
        source: file('crates/tmux-workspace/tests/fixtures/tmuxp/3-pane.yaml'), tests: [RS_PARSES, PARITY],
      },
      {
        topic: 'four-pane', also: ['tiled'],
        source: file('crates/tmux-workspace/tests/fixtures/tmuxp/4-pane.yaml'), tests: [RS_PARSES, PARITY],
      },
      { topic: 'main-horizontal', also: ['three-pane'], source: file('crates/tmux-workspace/tests/fixtures/tmuxp/main-pane-height.yaml'), tests: [RS_PARSES, PARITY] },
      { topic: 'environment', also: [], source: file('crates/tmux-workspace/tests/fixtures/tmuxp/session-environment.yaml'), tests: [RS_PARSES, PARITY] },
      { topic: '2-pane-synchronized', also: [], source: file(`${RS_FIXTURES}/2-pane-synchronized.yaml`), tests: [RS_PARSES, PARITY] },
      {
        topic: 'blank-panes', also: ['start-directory'], source: file(`${RS_FIXTURES}/blank-panes.yaml`),
        tests: [
          {
            path: 'crates/tmux-workspace/tests/build.rs', name: 'tmuxp_blank_pane_examples_build', needles: ['blank-panes.yaml'], via: 'library',
            checks: 'Builds the minimal and blank-pane examples on a real tmux server.',
          },
          RS_PARSES,
          PARITY,
        ],
      },
      { topic: 'env-variables', also: ['start-directory'], source: file(`${RS_FIXTURES}/env-variables.yaml`), tests: [RS_PARSES, PARITY] },
      {
        topic: 'focus-window-and-panes', also: ['shell-command-before'], source: file(`${RS_FIXTURES}/focus-window-and-panes.yaml`),
        tests: [
          {
            path: 'crates/tmux-workspace/tests/build.rs', name: 'a_blank_pane_is_a_pane_without_a_command', needles: ['focus-window-and-panes.yaml'], via: 'library',
            checks: 'Parses the example and checks the panes it declares.',
          },
          RS_PARSES,
          PARITY,
        ],
      },
      { topic: 'main-pane-height-percentage', also: ['three-pane', 'main-horizontal', 'start-directory'], source: file(`${RS_FIXTURES}/main-pane-height-percentage.yaml`), tests: [RS_PARSES, PARITY] },
      {
        topic: 'minimal', also: [], source: file(`${RS_FIXTURES}/minimal.yaml`),
        tests: [
          {
            path: 'crates/tmux-workspace/tests/build.rs', name: 'tmuxp_blank_pane_examples_build', needles: ['minimal.yaml'], via: 'library',
            checks: 'Builds the minimal and blank-pane examples on a real tmux server.',
          },
          RS_PARSES,
          PARITY,
        ],
      },
      { topic: 'options', also: ['main-horizontal', 'three-pane', 'start-directory'], source: file(`${RS_FIXTURES}/options.yaml`), tests: [RS_PARSES, PARITY] },
      { topic: 'pane-shell', also: [], source: file(`${RS_FIXTURES}/pane-shell.yaml`), tests: [RS_PARSES, PARITY] },
      { topic: 'skip-send', also: [], source: file(`${RS_FIXTURES}/skip-send.yaml`), tests: [RS_COMMAND_SETTINGS('skip-send.yaml'), RS_PARSES, PARITY] },
      { topic: 'skip-send-pane-level', also: [], source: file(`${RS_FIXTURES}/skip-send-pane-level.yaml`), tests: [RS_COMMAND_SETTINGS('skip-send-pane-level.yaml'), RS_PARSES, PARITY] },
      { topic: 'sleep', also: [], source: file(`${RS_FIXTURES}/sleep.yaml`), tests: [RS_COMMAND_SETTINGS('sleep.yaml'), RS_PARSES, PARITY] },
      { topic: 'sleep-pane-level', also: [], source: file(`${RS_FIXTURES}/sleep-pane-level.yaml`), tests: [RS_COMMAND_SETTINGS('sleep-pane-level.yaml'), RS_PARSES, PARITY] },
      {
        topic: 'sleep-virtualenv', also: ['shell-command-before'], source: file(`${RS_FIXTURES}/sleep-virtualenv.yaml`),
        tests: [RS_COMMAND_SETTINGS('sleep-virtualenv.yaml'), RS_PARSES, PARITY],
      },
      {
        topic: 'suppress-history', also: [], source: file(`${RS_FIXTURES}/suppress-history.yaml`),
        tests: [
          {
            path: 'crates/tmux-workspace/tests/build.rs', name: 'commands_stay_out_of_history_unless_the_file_says_otherwise', needles: ['suppress-history.yaml'], via: 'library',
            checks: 'Builds the example and checks which commands reach the shell history.',
          },
          RS_PARSES,
          PARITY,
        ],
      },
      { topic: 'window-index', also: [], source: file(`${RS_FIXTURES}/window-index.yaml`), tests: [RS_PARSES, PARITY] },
      {
        topic: 'start-directory', also: [],
        source: file('crates/tmux-workspace/tests/fixtures/tmuxp/start-directory.yaml'),
        tests: [
          {
            path: 'crates/tmux-workspace/tests/build.rs', name: 'tmuxp_start_directory_example_builds_where_tmuxp_does',
            needles: ['start-directory.yaml'], via: 'library',
            checks: 'Builds the file on a real tmux server and checks the directory of each window\'s first pane.',
          },
          RS_PARSES,
          PARITY,
        ],
      },
    ],
  },

  // The revision a pin names carries the catalog; `modelRevision` is the API
  // model's revision it was chosen against. Remove the pin when the model catches up.
  go: {
    revision: 'a0592f87f33974f502aafd1e6c1eb2dde839d356',
    modelRevision: '2de249b600d65218ee8b8fdc07c6b2b919242151',
    examples: [...tmuxpCatalog('workspace/testdata/tmuxp', [
      {
        path: 'workspace/workspace_test.go', name: 'TestEveryTmuxpExampleParses', find: 'func TestEveryTmuxpExampleParses',
        needles: ['testdata'], via: 'library', refuses: ['env-variables', 'pane-shell'],
        checks: 'Parses every fixture in the directory with workspace.Parse.',
      },
      {
        path: 'workspace/internal/cli/document_test.go', name: 'TestEveryTmuxpExampleNormalizes', find: 'func TestEveryTmuxpExampleNormalizes',
        needles: ['testdata'], via: 'loader',
        checks: 'Reads every fixture in the directory with the loader the load command calls.',
      },
    ], {
      // `environment` keeps the curated example below, which runs load on a real tmux server.
      skip: ['session-environment'],
    }), {
      topic: 'environment', also: ['two-pane', 'start-directory'],
      source: inside(
        'workspace/internal/integration/cli_test.go', '"workspace.yaml", `', '`)',
        { after: 'func TestLoadFreezeReloadAppendAndEnvironment' },
      ),
      tests: [{
        path: 'workspace/internal/integration/cli_test.go', name: 'TestLoadFreezeReloadAppendAndEnvironment', via: 'cli',
        checks: 'Runs load on a real tmux server and reads the files the panes write, which show the layered environment and each pane\'s directory.',
      }],
    }],
  },

  cxx: {
    revision: '51d209f5ea9c59c8f77b2089eab9b90c2f59ce3a',
    modelRevision: '3f93b021cb51e8349bfb9cecc6fd4091f6e79a0f',
    examples: [...tmuxpCatalog('examples/workspace/tests/fixtures/tmuxp', [
      {
        path: 'examples/workspace/tests/tmuxp_test.cpp', name: 'EveryTmuxpExampleParses', find: 'TEST(Tmuxp, EveryTmuxpExampleParses)',
        needles: ['LIBTMUX_TMUXP_FIXTURES'], via: 'loader', refuses: ['env-variables'],
        checks: 'Parses every fixture in the directory with parse_tmuxp, which the load command calls.',
      },
    ], {
      // `two-pane` and `main-horizontal` keep the curated examples below, whose tests build on a real tmux server.
      skip: ['2-pane-vertical', 'main-pane-height'],
    }), {
      topic: 'two-pane', also: ['start-directory'],
      source: inside('examples/workspace/tests/tmuxp_test.cpp', 'kDocument = R"(\n', ')";'),
      tests: [
        {
          path: 'examples/workspace/tests/tmuxp_test.cpp', name: 'ADocumentBecomesAWorkspace', via: 'loader',
          checks: 'Parses the document with parse_tmuxp and checks the names, layout, commands and start directory.',
        },
        {
          path: 'examples/workspace/tests/tmuxp_test.cpp', name: 'AParsedDocumentBuildsOnARealServer', via: 'loader',
          checks: 'Builds the document on a real tmux server and checks the window count, the pane count and each pane\'s directory.',
        },
      ],
    }, {
      topic: 'main-horizontal', also: ['shell-command-before', 'start-directory'],
      source: inside('examples/workspace/tests/tmuxp_test.cpp', 'kFullDocument = R"(\n', ')";'),
      tests: [
        {
          path: 'examples/workspace/tests/tmuxp_test.cpp', name: 'EveryKeyTheDocumentCarriesReachesTheWorkspace', via: 'loader',
          checks: 'Parses the document and checks the setup commands, focus and the main-pane-height option.',
        },
        {
          path: 'examples/workspace/tests/tmuxp_test.cpp', name: 'FocusAndOptionsLandOnTheBuiltSession', via: 'loader',
          checks: 'Builds the document on a real tmux server and checks the active window, the main-pane-height option and the pane count.',
        },
      ],
    }],
  },

  csharp: {
    revision: '4d6bd67188a8b5acba5ac7da1dfd849c4c104770',
    modelRevision: '8d47af7d89638ad267528ac56897cec67df597f7',
    examples: [...tmuxpCatalog('tests/Fixtures/tmuxp', [
      {
        path: 'tests/LibTmux.IntegrationTests/Workspace/WorkspaceFileTests.cs', name: 'Every_tmuxp_example_parses',
        needles: ['Fixtures'], via: 'library', refuses: ['pane-shell', 'sleep', 'sleep-pane-level', 'sleep-virtualenv', 'suppress-history'],
        checks: 'Parses every fixture in the directory with WorkspaceFile.Parse.',
      },
      {
        path: 'tests/LibTmux.Workspace.Cli.Tests/ContractTests.cs', name: 'Every_tmuxp_example_loads_through_the_commands_own_loader',
        needles: ['Fixtures'], via: 'loader',
        checks: 'Parses every fixture in the directory with the loader the load command calls.',
      },
    ], {
      // `two-pane` keeps the curated README example below, which runs the load command.
      skip: ['2-pane-vertical'],
    }), {
      topic: 'two-pane', also: ['start-directory'],
      source: inside('src/LibTmux.Workspace.Cli/README.md', '```yaml\n', '```'),
      tests: [{
        path: 'tests/LibTmux.Workspace.Cli.Tests/ReadmeCommandTests.cs', name: 'The_quickstart_workspace_builds_what_the_readme_describes',
        needles: ['YamlFence'], via: 'cli',
        checks: 'Reads this block from the README, runs tmux-workspace load on it and checks the windows and their pane counts.',
      }],
    }],
  },

  ruby: {
    revision: '9e1fbe1a938aab130f19939b7bcc0eeb6c438afc',
    modelRevision: '0bf78344f8babf60a7b83e11a26f58b7946fcf8d',
    examples: [...tmuxpCatalog('test/fixtures/tmuxp', [{
      path: 'test/unit/workspace_test.rb', name: 'test_tmuxp_examples_load_through_workspace_load',
      via: 'loader', checks: 'Loads the file with Workspace.load and checks its profile.',
    }], {
      // Every file the support table marks unsupported. Three of them load (`focus-window-and-panes`,
      // `main-pane-height`, `start-directory`) but the loader reads their `~` paths and bare `pane`
      // entries differently from tmuxp; the rest it refuses.
      skip: ['2-pane-synchronized', 'blank-panes', 'env-variables', 'focus-window-and-panes', 'main-pane-height-percentage',
        'main-pane-height', 'minimal', 'options', 'pane-shell', 'skip-send-pane-level', 'skip-send', 'sleep-pane-level',
        'sleep-virtualenv', 'sleep', 'start-directory', 'suppress-history'],
    }), {
      topic: 'tiled', also: ['two-pane', 'environment'],
      source: file('examples/workspace.yaml'),
      tests: [
        {
          path: 'test/packaging/package_test.rb', name: 'test_installed_imports_use_declared_dependencies_without_starting_resources',
          needles: ['run_installed_examples'], via: 'cli',
          checks: 'Installs the gems into an isolated home and runs each installed example program in examples/manifest.json, including workspace_apply, which runs the installed libtmux-workspace executable on this file.',
        },
        {
          path: 'examples/workspace_apply.rb', name: 'workspace_apply', find: 'Open3.capture2e(Gem.ruby, executable, operation', needles: ['workspace.yaml'], via: 'cli',
          checks: 'Loads the file with Workspace.load and applies it through the library, then runs the libtmux-workspace executable\'s validate, plan and load on it.',
        },
      ],
    }],
  },

  julia: {
    revision: 'dc6096bb0f58a44d17bb52a8c32a02bab71bb96b',
    modelRevision: 'f3da513be1225d36d5854cd8db5972c01857578e',
    examples: [...tmuxpCatalog('packages/LibTmuxWorkspace/test/fixtures/tmuxp', [{
      path: 'packages/LibTmuxWorkspace/test/config.jl', name: 'tmuxp example catalog', via: 'loader',
      checks: 'Reads and validates the file with read_config and validate.',
    }], {
      // The loader refuses each of these, as the support table says.
      skip: ['minimal', 'options', 'skip-send', 'skip-send-pane-level', 'sleep', 'sleep-pane-level', 'sleep-virtualenv'],
    }), {
      topic: 'shell-command-before', also: ['environment', 'start-directory', 'two-pane'],
      source: inside(
        'packages/LibTmuxWorkspace/test/config.jl', 'document = parse_config(raw"""\n', '\n        """)',
        { after: '@testset "explicit expansion and inheritance"' },
      ),
      note: '`${PROJECT}` and `${UNKNOWN}` are variables the loader expands. The test sets `PROJECT` and leaves `UNKNOWN` literal.',
      tests: [{
        path: 'packages/LibTmuxWorkspace/test/config.jl', name: 'explicit expansion and inheritance', via: 'loader',
        checks: 'Parses, validates and expands the document, as the load command does, and checks the resolved directories, commands and environment.',
      }],
    }],
  },

  powershell: {
    revision: 'aaf857bb1e17840129687ab250fa245f996228c7',
    modelRevision: '06233d3c99b40a5bce966c9e1d358f346ff4de55',
    examples: [
      // The catalog's files, beside the curated ones below. A topic shows one file, and a curated
      // file wins: its test runs the command against real tmux, where the catalog test only imports.
      ...tmuxpCatalog('tests/fixtures/workspace', [{
        path: 'tests/WorkspaceFiles.Tests.ps1', name: 'tmuxp example catalog', find: '$catalogLoaded = @(', via: 'loader',
        checks: 'Imports the file with Import-TmuxWorkspace. Starts no tmux.',
      }], {
        prefix: 'tmuxp-v1.74.0-',
        // main-horizontal, environment and start-directory have curated examples; the loader reads
        // blank-panes, env-variables and focus-window-and-panes but the support table marks them
        // unsupported; the rest it refuses; skip-send is curated too.
        skip: ['main-pane-height', 'session-environment', 'start-directory', 'blank-panes', 'env-variables',
          'focus-window-and-panes', 'pane-shell', 'skip-send', 'skip-send-pane-level', 'sleep', 'sleep-pane-level',
          'sleep-virtualenv', 'suppress-history'],
      }),
      {
        topic: 'main-horizontal', also: ['three-pane'],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-window_options.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'window options fixture', find: 'Join-Path $corpusFixtures \'tmuxp-v1.74.0-window_options.yaml\'', via: 'cli',
          checks: 'Runs the workspace cmdlets Import-TmuxWorkspace, Resolve-TmuxWorkspace, Get-TmuxWorkspacePlan and Invoke-TmuxWorkspace on the file against real tmux and checks the layout, the main-pane-height option and each pane\'s directory.',
        }],
      },
      {
        topic: 'shell-command-before', also: ['environment', 'start-directory', 'two-pane'],
        source: file('tests/fixtures/workspace/corpus.yaml'),
        note: '`${PROJECT_ROOT}` and `${OPTION_TAG}` are variables the loader expands.',
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'corpus fixture', find: 'Get-Item -LiteralPath $source | LibTmux.Workspace\\Import-TmuxWorkspace', needles: ['corpus.$format'], via: 'cli',
          checks: 'Runs the workspace cmdlets Import-TmuxWorkspace, Resolve-TmuxWorkspace, Get-TmuxWorkspacePlan and Invoke-TmuxWorkspace on the file against real tmux and checks the order of the commands, the environment each pane sees and each pane\'s directory.',
        }],
      },
      {
        topic: 'environment', also: [],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-environment_vars.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'environment variables fixture', find: 'Join-Path $corpusFixtures \'tmuxp-v1.74.0-environment_vars.yaml\'', via: 'cli',
          checks: 'Runs the workspace cmdlets Import-TmuxWorkspace, Resolve-TmuxWorkspace, Get-TmuxWorkspacePlan and Invoke-TmuxWorkspace on the file against real tmux and checks the session environment and the value each pane prints.',
        }],
      },
      {
        topic: 'start-directory', also: ['two-pane'],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-first_pane_start_directory.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'first pane start directory fixture', find: 'Join-Path $corpusFixtures \'tmuxp-v1.74.0-first_pane_start_directory.yaml\'', via: 'cli',
          checks: 'Runs the workspace cmdlets Import-TmuxWorkspace, Get-TmuxWorkspacePlan and Invoke-TmuxWorkspace on the file against real tmux, resolving it with the document\'s Resolve method, and checks the directory of each pane.',
        }],
      },
      {
        topic: 'skip-send', also: [],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-skip-send.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'skip-send fixture', find: '$enterDeclarations["tmuxp-v1.74.0-skip-send.$format"]', needles: ['tmuxp-v1.74.0-skip-send.'], via: 'builder',
          checks: 'Plans the file and its JSON twin with Get-TmuxWorkspacePlan and checks which commands are sent without Enter. Applies nothing.',
        }],
      },
      {
        topic: 'skip-send-pane-level', also: [],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-skip-send-pane-level.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'skip-send pane-level fixture', find: '$enterDeclarations["tmuxp-v1.74.0-skip-send-pane-level.$format"]', needles: ['tmuxp-v1.74.0-skip-send-pane-level.'], via: 'builder',
          checks: 'Plans the file and its JSON twin with Get-TmuxWorkspacePlan and checks which commands are sent without Enter. Applies nothing.',
        }],
      },
    ],
  },
}

/** The one test that loads each of tmuxp's examples through `tmux-workspace load -d`. */
const TS_LOADS = {
  path: 'packages/workspace-cli/tests/tmuxp-examples.test.ts',
  name: 'every tmuxp example workspace loads through the CLI',
  via: 'cli',
  checks: 'Runs the CLI\'s load -d on each of tmuxp\'s example files, each on its own tmux server, and checks the session, the windows and the panes tmux reports.',
}

/** What the test supplies to files that read their values from the environment. */
const TS_SUBSTITUTIONS = {
  'env-variables': 'The test supplies `MY_ENV_VAR`, `PWD` and `USER` and a `before_script` that leaves a marker; the file loads as written.',
  options: 'The test supplies `MAIN_PANE_HEIGHT`, which the file reads from the environment; the file loads as written.',
}

// TypeScript loads the same files as Rust, as copies of tmuxp's examples that the test refuses to see edited.
SOURCES.ts.examples = SOURCES.rs.examples.map((example) => {
  const name = basename(example.source.path)
  const topic = example.topic
  const substitution = TS_SUBSTITUTIONS[topic]
  return {
    topic, also: example.also, source: file(`packages/workspace-cli/tests/fixtures/tmuxp-examples/${name}`),
    ...(substitution ? { note: substitution } : {}),
    tests: [TS_LOADS],
  }
})

/**
 * What each port's `load` loader does with the keys of tmuxp's examples,
 * judged from its schema or normalizer at the pinned revision.
 *
 * A preset is supported unless named here. `unsupported` presets use a key the
 * loader refuses, ignores or models differently, and `caveats` presets load
 * with a difference a reader should know. Each `cite` names a file and a string
 * on the line that shows it; the generator reads the file at the pinned
 * revision (`from` names another port whose revision it is) and stores the
 * line. `libraryOnly` lists presets the port's tests load only through a
 * library parser the command does not use. `defaultLayout` is what a window
 * with no `layout` gets, where the port documents the default.
 */
const cite = (path, find, from) => ({ path, find, ...(from ? { from } : {}) })
const RUBY = 'gems/libtmux-workspace/lib/libtmux/workspace/normalizer.rb'
const ruby = (reason, find) => ({ reason, cite: cite(RUBY, find) })
const ROOT_KEYS = 'ROOT = (COMMON + %w[profile version session_name windows options window_options])'
const PANE_KEYS = 'PANE = (COMMON + %w[focus split size])'
const COMMAND_TEXT = 'value.map { |command| text(command, path) }'
const REQUIRES_NAME = 'fail_at("#{path}.window_name", "window name")'
const JULIA = 'packages/LibTmuxWorkspace/src/config.jl'
const julia = (reason, find) => ({ reason, cite: cite(JULIA, find) })
const DOTNET = 'src/LibTmux.Workspace/WorkspaceYamlParser.cs'
const dotnet = (reason, find, path = DOTNET) => ({ reason, cite: cite(path, find, 'csharp') })
const BAD_PANE = '`pane` and `blank` entries are typed into the shell as commands.'

export const SUPPORT = {
  py: { caveats: { 'plugin-system': { reason: 'The plugin class must be importable.' } } },
  rs: {
    caveats: {
      'env-variables': { reason: '`$VAR` in a command is left to the pane shell, so `$PWD` is the pane\'s directory. An expanded session name with `.` or `:` is refused.' },
      options: { reason: 'A window option listed under the session\'s `options` applies to every window.' },
      'plugin-system': { reason: 'A non-empty `plugins` runs through a tmuxp Python bridge. The parity run skips this example.' },
    },
    defaultLayout: { layout: 'tiled', cite: cite('crates/tmux-workspace/docs/cli.md', 'A window that names no `layout` is tiled') },
  },
  go: {
    caveats: {
      'blank-panes': { reason: 'An empty-string pane sends no Enter.', cite: cite('workspace/internal/cli/document.go', 'v != "pane" && v != "blank" && v != ""') },
      options: { reason: 'A window option listed under the session\'s `options` applies to every window.' },
      'plugin-system': { reason: 'A `plugins` key runs through a tmuxp Python bridge.', cite: cite('workspace/internal/cli/document.go', 'Bridge') },
    },
    defaultLayout: { layout: 'tiled', cite: cite('workspace/CLI.md', 'A window naming no `layout` tiles') },
  },
  ts: {
    caveats: {
      'env-variables': { reason: '`${NAME}` and `$NAME` in the file are read from the CLI\'s own environment, and `before_script` runs; the test supplies the variables.' },
      options: { reason: 'A window option listed under the session\'s `options` applies to every window. `${MAIN_PANE_HEIGHT}` is read from the environment.' },
      'plugin-system': { reason: 'A `plugins` key runs through a tmuxp Python bridge that needs tmuxp and the plugin\'s package, so the test asserts the refusal when neither is there.' },
    },
    defaultLayout: { layout: 'tiled', cite: cite('packages/workspace-cli/README.md', 'no `layout` tiles its panes') },
  },
  java: {
    caveats: {
      'env-variables': { reason: '`before_script` runs and a nonzero exit aborts the load.' },
      'plugin-system': { reason: 'A `plugins` key runs through a tmuxp Python bridge.' },
    },
  },
  csharp: {
    caveats: {
      'blank-panes': { reason: 'An empty-string pane sends no Enter.', cite: cite('src/LibTmux.Workspace.Cli/WorkspacePlan.cs', 'commandText is "" or "blank" or "pane"') },
      'pane-shell': { reason: 'The load command takes `window_shell`; `WorkspaceFile.Parse`, the library decoder, refuses it.', cite: cite('src/LibTmux.Workspace/WorkspaceYamlParser.cs', 'private static readonly string[] WindowKeys') },
      'plugin-system': { reason: 'Only a detached load can hand off to tmuxp.', cite: cite('src/LibTmux.Workspace.Cli/ExecutionCommands.cs', 'Python extension handoff is not yet supported') },
      sleep: { reason: 'The load command takes `sleep_before` and `sleep_after`; `WorkspaceFile.Parse`, the library decoder, refuses them.', cite: cite('src/LibTmux.Workspace/WorkspaceYamlParser.cs', 'private static readonly string[] PaneKeys') },
      'sleep-pane-level': { reason: 'The load command takes `sleep_before` and `sleep_after`; `WorkspaceFile.Parse`, the library decoder, refuses them.', cite: cite('src/LibTmux.Workspace/WorkspaceYamlParser.cs', 'private static readonly string[] PaneKeys') },
      'sleep-virtualenv': { reason: 'The load command takes `sleep_before` and `sleep_after`; `WorkspaceFile.Parse`, the library decoder, refuses them.', cite: cite('src/LibTmux.Workspace/WorkspaceYamlParser.cs', 'private static readonly string[] PaneKeys') },
      'suppress-history': { reason: 'The load command takes `suppress_history`; `WorkspaceFile.Parse`, the library decoder, refuses it.', cite: cite('src/LibTmux.Workspace/WorkspaceYamlParser.cs', 'private static readonly string[] RootKeys') },
    },
  },
  cxx: {
    unsupported: {
      'plugin-system': { reason: '`plugins` is not a document key, so the load is refused.', cite: cite('examples/workspace/src/tmuxp.cpp', 'unknown_key(root, kDocumentKeys)') },
    },
    caveats: {
      'env-variables': { reason: 'The command runs `before_script` itself; the parser alone refuses it.' },
    },
  },
  swift: {
    unsupported: {
      'plugin-system': { reason: '`plugins` is not an allowed key, so the load is refused before a session is made.', cite: cite('Sources/TmuxWorkspaceCLI/WorkspaceCommands.swift', '"workspace_builder_options"') },
      sleep: { reason: 'A command accepts only `cmd` and `enter`, so `sleep_before` and `sleep_after` are refused.', cite: cite('Sources/TmuxWorkspaceCLI/WorkspaceCommands.swift', '["cmd", "enter"]') },
      'sleep-virtualenv': { reason: 'A command accepts only `cmd` and `enter`, so `sleep_before` and `sleep_after` are refused.', cite: cite('Sources/TmuxWorkspaceCLI/WorkspaceCommands.swift', '["cmd", "enter"]') },
    },
    caveats: {
      shorthands: { reason: 'A YAML file loads only in a build with the `YAMLWorkspaces` trait.' },
    },
    libraryOnly: ['2-pane-vertical', '3-pane', 'blank-panes', 'skip-send', 'sleep'],
  },
  ruby: {
    unsupported: {
      '2-pane-synchronized': ruby('A window has no `options_after`.', 'WINDOW = (COMMON + %w[window_name window_index panes focus layout options])'),
      'blank-panes': ruby('A null pane is refused; a pane is a mapping.', 'fail_at(path, "configuration object") unless value.is_a?(Hash)'),
      'env-variables': ruby('`before_script` is refused.', 'known_unsupported = %w[before_script plugins hooks erb callback callbacks]'),
      'focus-window-and-panes': ruby('A bare string pane is a command, so the `pane` entries would be typed into the shell.', 'pane = {"shell_command" => pane} if pane.is_a?(String)'),
      'main-pane-height-percentage': ruby('`main-pane-height` takes a row count, not `67%`.', 'unless value.is_a?(Integer) && value.between?(0, maximum)'),
      'main-pane-height': ruby('`~` is not the home directory; a relative path joins the file\'s directory.', 'File.expand_path(value.start_with?(File::SEPARATOR) ? value : File.join(@base, value))'),
      minimal: ruby('A window needs a `window_name`, and a null pane is refused.', REQUIRES_NAME),
      options: ruby('There is no `global_options`, and `main-pane-height` is not a session option.', ROOT_KEYS),
      'pane-shell': ruby('A pane has no `shell`, and a window has no `window_shell` or `suppress_history`.', PANE_KEYS),
      'plugin-system': ruby('`plugins` is refused.', 'known_unsupported = %w[before_script plugins hooks erb callback callbacks]'),
      'skip-send-pane-level': ruby('A pane has no `enter`.', PANE_KEYS),
      'skip-send': ruby('A command is a string, not a mapping with `cmd` and `enter`.', COMMAND_TEXT),
      'sleep-pane-level': ruby('A pane has no `sleep_before`.', PANE_KEYS),
      'sleep-virtualenv': ruby('A command is a string, not a mapping with `cmd` and `sleep_before`.', COMMAND_TEXT),
      sleep: ruby('A command is a string, not a mapping with `cmd` and `sleep_before`.', COMMAND_TEXT),
      'start-directory': ruby('A relative directory joins the file\'s directory, and `~` is literal.', 'File.expand_path(value.start_with?(File::SEPARATOR) ? value : File.join(@base, value))'),
      'suppress-history': ruby('`suppress_history` is not a key at any level.', ROOT_KEYS),
    },
  },
  julia: {
    unsupported: {
      minimal: julia('A window needs a `window_name`.', '_required(data, "window_name", path)'),
      options: julia('A window needs a `window_name`; the example\'s window has none.', '_required(data, "window_name", path)'),
      'plugin-system': julia('`plugins` is not part of schema 1.', '"plugins",'),
      'skip-send': julia('A window needs a `window_name`; the example\'s window has none.', '_required(data, "window_name", path)'),
      'skip-send-pane-level': julia('A window needs a `window_name`; the example\'s window has none.', '_required(data, "window_name", path)'),
      'sleep-pane-level': julia('`sleep_before` is refused.', '"sleep_before",'),
      'sleep-virtualenv': julia('A command accepts only `cmd` and `enter`.', 'Set(("cmd", "enter"))'),
      sleep: julia('A command accepts only `cmd` and `enter`.', 'Set(("cmd", "enter"))'),
    },
    caveats: {
      'env-variables': { reason: 'Only values passed with `--env` expand; an unset name stays literal.' },
      'pane-shell': { reason: 'A pane launcher with commands needs `--no-readiness`.' },
    },
  },
  powershell: {
    unsupported: {
      'blank-panes': dotnet(BAD_PANE, 'shellCommands: command is null ? [] : [command]'),
      'env-variables': dotnet('Session and window names and `before_script` are not expanded, and a host script needs `-AllowHostScripts`.', 'names and environment values remain literal', 'src/LibTmux.Workspace/WorkspaceFile.cs'),
      'focus-window-and-panes': dotnet(BAD_PANE, 'shellCommands: command is null ? [] : [command]'),
      'pane-shell': dotnet('`window_shell`, `shell` and `suppress_history` are not keys.', 'PaneKeys'),
      'plugin-system': dotnet('`plugins` is not a key.', 'RootKeys'),
      'sleep-pane-level': dotnet('`sleep_before` is not a pane key.', 'PaneKeys'),
      'sleep-virtualenv': dotnet('A command accepts only `cmd` and `enter`.', '["cmd", "enter"]'),
      sleep: dotnet('A command accepts only `cmd` and `enter`.', '["cmd", "enter"]'),
      'suppress-history': dotnet('`suppress_history` is not a key at any level.', 'RootKeys'),
    },
  },
}
