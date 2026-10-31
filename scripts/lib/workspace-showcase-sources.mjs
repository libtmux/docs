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
 * `topic` places an example under one of the tmuxp classics. `also` names the
 * other classics the same file shows. `site/test/workspace-showcase.test.ts`
 * checks that each claimed topic holds in the parsed document.
 *
 * Each test names a file in the same repository and a string to look for in it
 * (`find`, which defaults to `name`). `needles` are further strings the file
 * must contain, normally the fixture's file name, so a test that stops
 * mentioning its fixture fails the generator rather than staying listed.
 * `via` says how the test loads the file: `cli` runs the command, `loader` or
 * `builder` calls the code the command is built on, `library` calls a library
 * parser that shares the grammar with the command.
 */

/** The nine tmuxp classics, in the order the page shows them. */
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
]

/** A fixture read whole. */
const file = (path) => ({ path })

/** A document quoted inside a file, between two literal markers. */
const inside = (path, open, close, { after } = {}) => ({ path, extract: { open, close, ...(after ? { after } : {}) } })

const PARITY = {
  path: 'scripts/tmuxp-parity.py',
  name: 'tmuxp-parity.py',
  find: 'DEFAULT_FIXTURES_DIR',
  needles: ['crates/tmux-workspace/tests/fixtures/tmuxp'],
  via: 'cli',
  checks: 'Loads each fixture with tmux-workspace load and with tmuxp, and compares what they build. CI runs it on a schedule.',
}

const RS_PARSES = {
  path: 'crates/tmux-workspace/tests/build.rs',
  name: 'every_tmuxp_example_parses',
  needles: ['tests/fixtures/tmuxp'],
  via: 'library',
  checks: 'Parses every fixture in the directory.',
}

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
            path: 'tests/cli/test_load.py', name: 'test_load_workspace', needles: ['two_pane.yaml'], via: 'cli',
            checks: 'Runs load_workspace, the function tmuxp load calls, and checks the session name.',
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
    ],
  },

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

  go: {
    examples: [{
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
    examples: [
      {
        topic: 'shorthand', also: ['shell-command-before'],
        source: inside(
          'examples/workspace/tests/tmuxp_test.cpp', 'parse_tmuxp(R"(\n', ')");',
          { after: 'TEST(Tmuxp, ShorthandAndInheritedCommandsKeepPaneDefaults)' },
        ),
        tests: [{
          path: 'examples/workspace/tests/tmuxp_test.cpp', name: 'ShorthandAndInheritedCommandsKeepPaneDefaults', via: 'loader',
          checks: 'Parses the document with parse_tmuxp, which the load command calls, and checks the commands each pane inherits.',
        }],
      },
      {
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
      },
      {
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
      },
    ],
  },

  csharp: {
    examples: [{
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
    examples: [{
      topic: 'tiled', also: ['two-pane', 'environment'],
      source: file('examples/workspace.yaml'),
      tests: [
        {
          path: 'test/packaging/package_test.rb', name: 'test_installed_imports_use_declared_dependencies_without_starting_resources',
          needles: ['run_installed_examples'], via: 'cli',
          checks: 'Runs the installed example programs listed in examples/manifest.json.',
        },
        {
          path: 'examples/workspace_apply.rb', name: 'workspace_apply', find: 'workspace.yaml', via: 'cli',
          checks: 'Loads the file with Workspace.load, then runs the libtmux-workspace executable\'s validate, plan and load on it.',
        },
      ],
    }],
  },

  julia: {
    examples: [{
      topic: 'shell-command-before', also: ['environment', 'start-directory', 'two-pane'],
      source: inside(
        'packages/LibTmuxWorkspace/test/config.jl', 'document = parse_config(raw"""\n', '\n    """)',
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
    examples: [
      {
        topic: 'main-horizontal', also: ['three-pane'],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-window_options.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'window options fixture', find: 'tmuxp-v1.74.0-window_options.yaml', via: 'cli',
          checks: 'Plans and applies the file on real tmux and checks the layout, the main-pane-height option and each pane\'s directory.',
        }],
      },
      {
        topic: 'shell-command-before', also: ['environment', 'start-directory', 'two-pane'],
        source: file('tests/fixtures/workspace/corpus.yaml'),
        note: '`${PROJECT_ROOT}` and `${OPTION_TAG}` are variables the loader expands.',
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'corpus fixture', find: 'corpus.$format', needles: ['corpus.$format'], via: 'cli',
          checks: 'Applies the file on real tmux and checks the order of the commands, the environment each pane sees and each pane\'s directory.',
        }],
      },
      {
        topic: 'environment', also: [],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-environment_vars.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'environment variables fixture', find: 'tmuxp-v1.74.0-environment_vars.yaml', via: 'cli',
          checks: 'Plans and applies the file on real tmux and checks the session environment and the value each pane prints.',
        }],
      },
      {
        topic: 'start-directory', also: ['two-pane'],
        source: file('tests/fixtures/workspace/tmuxp-v1.74.0-first_pane_start_directory.yaml'),
        tests: [{
          path: 'tests/WorkspaceCorpus.Tests.ps1', name: 'first pane start directory fixture', find: 'tmuxp-v1.74.0-first_pane_start_directory.yaml', via: 'cli',
          checks: 'Plans and applies the file on real tmux and checks the directory of each pane.',
        }],
      },
    ],
  },
}
