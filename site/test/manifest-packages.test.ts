import { describe, expect, it } from 'vitest'
import { compareSemver, readPort } from '../../scripts/lib/manifest-packages.mjs'

/** A repository held in memory: the readers ask for files, a file's text, whether a path exists and the release tags. */
const repo = (files: Record<string, string>, tags: string[] = []) => ({
  revision: 'test', files: () => Object.keys(files), read: (path: string) => {
    if (!(path in files)) throw new Error(`no ${path}`)
    return files[path]!
  }, has: (path: string) => path in files, tags: () => tags,
})
const names = (result: { distributions: { name: string }[] }) => result.distributions.map((entry) => entry.name)

describe('manifest packages', () => {
  it('orders prereleases numerically and puts a release above its prereleases', () => {
    expect(['0.1.0-alpha.10', '0.1.0-alpha.9', '0.1.0', '0.0.9'].sort(compareSemver)).toEqual(['0.0.9', '0.1.0-alpha.9', '0.1.0-alpha.10', '0.1.0'])
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0)
  })

  it('reads a Python project from its [project] table, not a tool table that also has a name', () => {
    const toml = '[tool.other]\nname = "wrong"\nversion = "9"\n\n[project]\nname = "libtmux"\nversion = "0.62.0"\n'
    expect(readPort('py', repo({ 'pyproject.toml': toml })).distributions).toEqual([{ name: 'libtmux', version: '0.62.0', manifest: 'pyproject.toml' }])
  })

  it('leaves out a private npm package and a Cargo crate that opts out of publishing, and keeps the rest', () => {
    const npm = (json: object) => JSON.stringify(json)
    const ts = (isPrivate: boolean) => readPort('ts', repo({
      'packages/a/package.json': npm({ name: 'a', version: '1.0.0' }),
      'packages/b/package.json': npm({ name: '@x/b', version: '1.0.0', private: isPrivate }),
    }))
    expect(names(ts(true))).toEqual(['a'])
    expect(names(ts(false))).toEqual(['a', '@x/b'])
    const cargo = (publish: string) => readPort('rs', repo({
      'Cargo.toml': '[workspace.package]\nversion = "0.1.0-alpha.15"\n',
      'crates/core/Cargo.toml': '[package]\nname = "core"\nversion.workspace = true\n',
      'crates/tool/Cargo.toml': `[package]\nname = "tool"\nversion = "0.2.0"\n${publish}\n`,
    }))
    expect(cargo('publish = false').distributions).toEqual([{ name: 'core', version: '0.1.0-alpha.15', manifest: 'crates/core/Cargo.toml' }])
    expect(cargo('').distributions.map((entry) => [entry.name, entry.version])).toEqual([['core', '0.1.0-alpha.15'], ['tool', '0.2.0']])
  })

  it('takes a Go module as published only when it has a tag series, and finds packages and commands without internals', () => {
    const files = {
      'go.mod': 'module example.com/lib\n', 'mcp/go.mod': 'module example.com/lib/mcp\n', 'tools/go.mod': 'module example.com/lib/tools\n',
      'tmux/tmux.go': 'package tmux', 'tmux/tmux_test.go': 'package tmux', 'tmux/internal/x.go': 'package x', 'tmuxq/q.go': 'package tmuxq',
      'mcp/server.go': 'package mcp', 'mcp/cmd/lib-mcp/main.go': 'package main', 'examples/e.go': 'package main', 'tools/t.go': 'package tools', 'main.go': 'package lib',
    }
    const tags = ['v0.0.1-alpha.9', 'v0.0.1-alpha.10', 'mcp/v0.0.1-alpha.12', 'tools-v1']
    const result = readPort('go', repo(files, tags))
    expect(result.distributions.map((entry) => [entry.name, entry.version])).toEqual([['example.com/lib', '0.0.1-alpha.10'], ['example.com/lib/mcp', '0.0.1-alpha.12']])
    expect(result.units.map((unit) => [unit.unit, unit.name]).sort((a, b) => a.join().localeCompare(b.join())))
      .toEqual([['command', 'lib-mcp'], ['package', 'tmux'], ['package', 'tmuxq']])
    // Control: a tag series makes the tools module a distribution too.
    expect(names(readPort('go', repo(files, [...tags, 'tools/v0.1.0'])))).toContain('example.com/lib/tools')
  })

  it('takes a Gradle module as published when it applies a publication plugin, with its Scala suffix and no SNAPSHOT', () => {
    const files = (plugin: string) => ({
      'gradle.properties': 'libtmuxVersion=0.0.1-alpha.17-SNAPSHOT\n', 'settings.gradle.kts': 'include("lib")\ninclude("facade")\ninclude("docs")\n',
      'lib/build.gradle.kts': 'plugins { id("libtmux.published-library") }', 'facade/build.gradle.kts': `plugins { id("${plugin}") }`, 'docs/build.gradle.kts': 'plugins { base }',
    })
    expect(readPort('java', repo(files('libtmux.published-scala-library'))).distributions.map((entry) => [entry.name, entry.version]))
      .toEqual([['io.github.libtmux:lib', '0.0.1-alpha.17'], ['io.github.libtmux:facade_3', '0.0.1-alpha.17']])
    // Control: a module with no publication plugin is not published.
    expect(names(readPort('java', repo(files('java-library'))))).toEqual(['io.github.libtmux:lib'])
  })

  it('takes a .NET project as a package only when it is packable, with the props file’s prerelease version', () => {
    const project = (packable: boolean) => `<Project><PropertyGroup><IsPackable>${packable}</IsPackable><PackageId>X.Y</PackageId></PropertyGroup></Project>`
    const files = (packable: boolean) => ({
      'Directory.Build.props': '<Project><VersionPrefix>0.0.0</VersionPrefix><VersionSuffix>alpha.22</VersionSuffix></Project>', 'src/Y/Y.csproj': project(packable),
    })
    expect(readPort('csharp', repo(files(true))).distributions).toEqual([{ name: 'X.Y', version: '0.0.0-alpha.22', manifest: 'src/Y/Y.csproj' }])
    expect(readPort('csharp', repo(files(false))).distributions).toEqual([])
  })

  it('reads gems, modules and rocks from the file each ecosystem versions by', () => {
    expect(readPort('ruby', repo({
      'gems/a/a.gemspec': 'Gem::Specification.new do |spec|\n  spec.name = "a"\nend', 'gems/a/lib/a/version.rb': 'module A\n  VERSION = "0.1.0.alpha.1"\nend',
    })).distributions).toEqual([{ name: 'a', version: '0.1.0.alpha.1', manifest: 'gems/a/a.gemspec' }])
    expect(readPort('powershell', repo({
      'module/M/M.psd1': "@{\n  ModuleVersion = '0.1.0'\n  PrivateData = @{\n    PSData = @{\n      Prerelease = 'alpha2'\n    }\n  }\n}", 'module/N.psd1': "@{ ModuleVersion = '9' }",
    })).distributions).toEqual([{ name: 'M', version: '0.1.0-alpha2', manifest: 'module/M/M.psd1' }])
    expect(readPort('lua', repo({ 'release.json': '{"package":"libtmux","version":"0.1.0alpha2-1"}', 'rockspecs/libtmux-mcp-scm-1.rockspec': 'package = "libtmux-mcp"' })).distributions)
      .toEqual([{ name: 'libtmux', version: '0.1.0alpha2-1', manifest: 'release.json' }])
  })

  it('reads Julia packages with their extensions and embedded modules', () => {
    const result = readPort('julia', repo({
      'Project.toml': 'name = "LibTmux"\nversion = "0.1.0-alpha.1"\n[extensions]\nLibTmuxJSONExt = "JSON"\n[extras]\nTest = "x"\n',
      'packages/LibTmuxMCP/Project.toml': 'name = "LibTmuxMCP"\nversion = "0.1.0-alpha.1"\n',
      'src/LibTmux.jl': 'module LibTmux\nend', 'src/criteria.jl': 'module Filters\nend',
    }))
    expect(names(result)).toEqual(['LibTmux', 'LibTmuxMCP'])
    expect(result.units).toEqual([{ unit: 'extension', name: 'LibTmuxJSONExt' }, { unit: 'module', name: 'LibTmux.Filters' }])
  })

  it('reads a SwiftPM package’s products and targets, and not its test targets', () => {
    const manifest = `let package = Package(name: "libtmux", products: [
      .library(name: "LibTmux", targets: ["LibTmux"]), .executable(name: "tool", targets: ["ToolCLI"]) ],
      targets: [ .target(
        name: "LibTmux"), .executableTarget(
        name: "ToolCLI"), .testTarget(name: "LibTmuxTests") ])`
    const result = readPort('swift', repo({ 'Package.swift': manifest }, ['0.1.0-alpha.5', '0.1.0-alpha.6']), { identity: 'libtmux-swift' })
    expect(result.distributions).toEqual([{ name: 'libtmux-swift', version: '0.1.0-alpha.6', manifest: 'Package.swift' }])
    expect(result.units.map((unit) => `${unit.unit}: ${unit.name}`)).toEqual(['product: LibTmux', 'executable product: tool', 'target: LibTmux', 'executable target: ToolCLI'])
  })

  it('reads the vcpkg port as the one C++ distribution', () => {
    expect(readPort('cxx', repo({ 'ports/libtmux/vcpkg.json': '{"name":"libtmux","version-semver":"0.1.0-alpha.11"}' })).distributions)
      .toEqual([{ name: 'libtmux', version: '0.1.0-alpha.11', manifest: 'ports/libtmux/vcpkg.json' }])
  })

  it('refuses a port it has no reader for', () => {
    expect(() => readPort('nope', repo({}))).toThrow('no manifest reader for nope')
  })
})
