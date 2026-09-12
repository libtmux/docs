/*
 * Which port examples the docs arena runs, and how to build and run each one
 * from its port's `tmux-arena` worktree.
 *
 * Each entry names the artifact its adapter accepts and the sources that
 * artifact executes, in `site/src/data/example-sources.json` key form
 * (`<slug>:<path>`), or `<slug>:page:<path>` for a port documentation page.
 * A quoted source that no entry runs is reported as not yet arena-capable
 * instead of passing silently.
 *
 * `LIBTMUX_DOCS_ARENA_<SLUG>` overrides one port's worktree, which otherwise
 * sits beside its checkout as `<checkout>-tmux-arena`.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { arch } from 'node:os'
import { join } from 'node:path'
import { PORTS } from '../../site/src/lib/ports.ts'
import { expand } from '../../site/src/plugins/remark-port-code.mjs'

export function arenaWorktree(slug) {
  const override = process.env[`LIBTMUX_DOCS_ARENA_${slug.toUpperCase()}`]
  if (override) return expand(override)
  const port = PORTS.find((candidate) => candidate.slug === slug)
  return port ? `${expand(port.checkout)}-tmux-arena` : ''
}

// Prints the examples module's runtime classpath, so the example runs as a plain JVM program.
const gradleClasspath = (out) => `gradle.allprojects { p ->
  if (p.path == ':examples') {
    p.plugins.withId('java') {
      def classpath = p.sourceSets.main.runtimeClasspath
      def out = new File(${JSON.stringify(out)})
      p.tasks.register('docsArenaClasspath') {
        dependsOn p.tasks.named('classes')
        doLast { out.text = classpath.asPath }
      }
    }
  }
}
`

const swiftTriple = () => `${arch() === 'arm64' ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`

/**
 * `prepare(build)` returns build steps; `run(build)` returns the one command
 * the arena lends its server to. `build` is a scratch directory for outputs
 * that must not land in the worktree. Every `cwd` is relative to the worktree.
 */
export const ARTIFACTS = [
  {
    slug: 'py',
    artifact: 'python-workspace-setup',
    runs: ['py:page:docs/topics/workspace_setup.md'],
    tools: ['uv'],
    prepare: () => [],
    run: () => ({
      cwd: '.',
      command: [
        'uv', 'run', '--frozen', 'python', '-B', '-m', 'pytest', '--reruns=0', '-p', 'no:cacheprovider', '-q',
        '--libtmux-arena-target', 'docs/topics/workspace_setup.md', 'docs/topics/workspace_setup.md',
      ],
    }),
  },
  // One entry per site-quoted ts example. They share the port slug, so
  // `--port ts` and LIBTMUX_DOCS_ARENA_TS still select all four, and each
  // names its own artifact, test file and `runs` key. Install and build steps
  // repeat here because every entry declares what it needs; docs-arena runs a
  // given command once per worktree, so they are not paid for four times.
  {
    slug: 'ts',
    artifact: 'typescript-quickstart',
    runs: ['ts:examples/quickstart/quickstart.ts'],
    tools: ['mise'],
    prepare: () => [
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'install', '--frozen-lockfile'] },
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'run', '--cwd', 'packages/libtmux', 'build'] },
    ],
    run: () => ({ cwd: 'examples', command: ['mise', 'exec', '--', 'bun', 'test', '--no-orphans', 'quickstart/quickstart.test.ts'] }),
  },
  {
    slug: 'ts',
    artifact: 'typescript-capture',
    runs: ['ts:examples/capture/capture.ts'],
    tools: ['mise'],
    prepare: () => [
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'install', '--frozen-lockfile'] },
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'run', '--cwd', 'packages/libtmux', 'build'] },
    ],
    run: () => ({ cwd: 'examples', command: ['mise', 'exec', '--', 'bun', 'test', '--no-orphans', 'capture/capture.test.ts'] }),
  },
  {
    slug: 'ts',
    artifact: 'typescript-agent',
    runs: ['ts:examples/agent/agent.ts'],
    tools: ['mise'],
    prepare: () => [
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'install', '--frozen-lockfile'] },
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'run', '--cwd', 'packages/libtmux', 'build'] },
    ],
    run: () => ({ cwd: 'examples', command: ['mise', 'exec', '--', 'bun', 'test', '--no-orphans', 'agent/agent.test.ts'] }),
  },
  {
    slug: 'ts',
    artifact: 'typescript-workspace',
    runs: ['ts:examples/workspace/workspace.ts'],
    tools: ['mise'],
    prepare: () => [
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'install', '--frozen-lockfile'] },
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'run', '--cwd', 'packages/libtmux', 'build'] },
      // This example imports the published package, not its source.
      { cwd: '.', command: ['mise', 'exec', '--', 'bun', 'run', '--cwd', 'packages/workspace', 'build'] },
    ],
    run: () => ({ cwd: 'examples', command: ['mise', 'exec', '--', 'bun', 'test', '--no-orphans', 'workspace/workspace.test.ts'] }),
  },
  {
    slug: 'rs',
    artifact: 'rust-inspect',
    runs: ['rs:crates/libtmux/examples/inspect.rs'],
    tools: ['cargo'],
    prepare: (build) => [{
      cwd: '.',
      command: ['cargo', 'build', '--locked', '--quiet', '--manifest-path', 'crates/libtmux/Cargo.toml', '--example', 'inspect', '--target-dir', build],
    }],
    run: (build) => ({ cwd: '.', command: [join(build, 'debug', 'examples', 'inspect')] }),
  },
  {
    slug: 'go',
    artifact: 'go-quickstart',
    runs: ['go:examples/quickstart/main.go'],
    tools: ['go'],
    prepare: (build) => [{ cwd: 'examples', command: ['go', 'test', '-c', '-o', join(build, 'quickstart.test'), './quickstart'] }],
    run: (build) => ({ cwd: 'examples/quickstart', command: [join(build, 'quickstart.test'), '-test.run=^TestQuickstart$', '-test.count=1'] }),
  },
  {
    slug: 'java',
    artifact: 'java-build-a-workspace',
    runs: ['java:examples/src/main/java/io/github/libtmux/examples/BuildAWorkspace.java'],
    tools: ['java'],
    prepare: (build) => {
      const init = join(build, 'classpath.gradle')
      writeFileSync(init, gradleClasspath(join(build, 'classpath.txt')))
      return [{
        cwd: '.',
        command: ['./gradlew', '--no-daemon', '--quiet', '--no-configuration-cache', '--init-script', init, ':examples:docsArenaClasspath'],
      }]
    },
    run: (build) => ({
      cwd: '.',
      command: ['java', '-cp', readFileSync(join(build, 'classpath.txt'), 'utf8').trim(), 'io.github.libtmux.examples.BuildAWorkspace'],
    }),
  },
  {
    slug: 'dotnet',
    artifact: 'csharp-one-shot',
    runs: ['dotnet:examples/LibTmux.Examples/Snippets/OneShot.cs'],
    tools: ['dotnet'],
    prepare: () => [{
      cwd: '.',
      command: ['dotnet', 'build', 'examples/LibTmux.Examples/LibTmux.Examples.csproj', '--configuration', 'Release', '--framework', 'net10.0', '--nologo', '--verbosity', 'quiet'],
    }],
    run: () => ({ cwd: '.', command: ['dotnet', 'examples/LibTmux.Examples/bin/Release/net10.0/LibTmux.Examples.dll', '--arena-one-shot'] }),
  },
  {
    slug: 'cxx',
    artifact: 'cpp-tour',
    runs: ['cxx:examples/01-tour.cpp'],
    tools: ['cmake'],
    prepare: () => [
      { cwd: '.', command: ['cmake', '--preset', 'cxx-dev'] },
      { cwd: '.', command: ['cmake', '--build', '--preset', 'cxx-dev', '--target', 'libtmux_example_01_tour'] },
    ],
    run: () => ({ cwd: '.', command: ['build/cxx-dev/examples/libtmux_example_01_tour'] }),
  },
  // The other examples that can borrow. Each names its own artifact and
  // builds its own target; the configure step is shared, and docs-arena
  // runs a given command once per worktree.
  {
    slug: 'cxx',
    artifact: 'cpp-workspace',
    runs: ['cxx:examples/02-workspace.cpp'],
    tools: ['cmake'],
    prepare: () => [
      { cwd: '.', command: ['cmake', '--preset', 'cxx-dev'] },
      { cwd: '.', command: ['cmake', '--build', '--preset', 'cxx-dev', '--target', 'libtmux_example_02_workspace'] },
    ],
    run: () => ({ cwd: '.', command: ['build/cxx-dev/examples/libtmux_example_02_workspace'] }),
  },
  {
    slug: 'cxx',
    artifact: 'cpp-readme',
    runs: ['cxx:examples/05-readme.cpp'],
    tools: ['cmake'],
    prepare: () => [
      { cwd: '.', command: ['cmake', '--preset', 'cxx-dev'] },
      { cwd: '.', command: ['cmake', '--build', '--preset', 'cxx-dev', '--target', 'libtmux_example_05_readme'] },
    ],
    run: () => ({ cwd: '.', command: ['build/cxx-dev/examples/libtmux_example_05_readme'] }),
  },
  {
    slug: 'cxx',
    artifact: 'cpp-streaming',
    runs: ['cxx:examples/06-streaming.cpp'],
    tools: ['cmake'],
    prepare: () => [
      { cwd: '.', command: ['cmake', '--preset', 'cxx-dev'] },
      { cwd: '.', command: ['cmake', '--build', '--preset', 'cxx-dev', '--target', 'libtmux_example_06_streaming'] },
    ],
    run: () => ({ cwd: '.', command: ['build/cxx-dev/examples/libtmux_example_06_streaming'] }),
  },
  {
    slug: 'swift',
    artifact: 'swift-querying',
    runs: ['swift:Examples/Sources/ExampleCode/Querying.swift'],
    tools: ['swift'],
    prepare: () => [{
      cwd: '.',
      command: ['swift', 'build', '--package-path', 'Examples', '--scratch-path', 'Examples/.build/docs-arena', '--build-tests'],
    }],
    run: () => ({
      cwd: '.',
      command: [`Examples/.build/docs-arena/${swiftTriple()}/debug/ExamplesPackageTests.xctest`, '--testing-library', 'swift-testing', '--filter', 'theThreeListings'],
    }),
  },
]
