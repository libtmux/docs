/**
 * What the Workspace and MCP product pages may claim about each port.
 *
 * A page's introduction names the verbs the port's workspace tool has, the
 * formats it reads, and the SDK its MCP server is built on. Each claim lists
 * the lines of the port's own files that show it, read at the revision the
 * port's API model records for that product, so a port that has no `freeze`
 * cannot be written as having one: the command table either names it or it
 * does not. `find` strings must be present in the file; `absent` strings must
 * not be, which is how a missing command is shown.
 *
 * `gen-product-copy.mjs` locates the lines and writes
 * `site/src/data/product-copy.json`; `site/src/lib/product-copy.ts` builds the
 * copy from that file alone.
 */

/** Verbs a workspace tool may have, in the order the introduction lists them. */
export const VERBS = ['load', 'freeze', 'convert']

const YAML_JSON = ['YAML', 'JSON']
const MODEL_CONTEXT_PROTOCOL = 'https://modelcontextprotocol.io/'

/**
 * @typedef {{ path: string, find?: string | string[], absent?: string | string[] }} Check
 * @type {Record<string, { checkout?: string, verbs: string[], formats: string[], formatNote?: string, checks: Check[] }>}
 */
export const WORKSPACE = {
  py: {
    checkout: process.env.LIBTMUX_DOCS_CHECKOUT_TMUXP || '~/work/python/tmuxp',
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'src/tmuxp/cli/__init__.py', find: ['load_parser = subparsers.add_parser(', 'freeze_parser = subparsers.add_parser(', 'convert_parser = subparsers.add_parser('] },
      { path: 'src/tmuxp/workspace/constants.py', find: 'VALID_WORKSPACE_DIR_FILE_EXTENSIONS = [".yaml", ".yml", ".json"]' },
    ],
  },
  ts: {
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'packages/workspace-cli/src/grammar.json', find: ['"command": "tmuxp load"', '"command": "tmuxp freeze"', '"command": "tmuxp convert"'] },
      { path: 'packages/workspace-cli/src/documents.ts', find: 'const extensions = [".yaml", ".yml", ".json"];' },
    ],
  },
  rs: {
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'crates/tmux-workspace/src/cli/args.rs', find: ['Command::new("load")', 'Command::new("freeze")', 'Command::new("convert")'] },
      { path: 'crates/tmux-workspace/src/cli/discovery.rs', find: 'const EXTENSIONS: [&str; 3] = ["yaml", "yml", "json"];' },
    ],
  },
  go: {
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'workspace/internal/cli/cli.go', find: ['add("load"', 'add("freeze"', 'add("convert"'] },
      { path: 'workspace/internal/cli/files.go', find: 'var extensions = []string{".yaml", ".yml", ".json"}' },
    ],
  },
  java: {
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'libtmux-workspace-cli/src/main/java/io/github/libtmux/workspace/cli/Arguments.java', find: ['command("load"', 'command("freeze"', 'command("convert"'] },
      { path: 'libtmux-workspace-cli/src/main/java/io/github/libtmux/workspace/cli/Catalog.java', find: 'List.of("yaml", "yml", "json")' },
    ],
  },
  csharp: {
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'src/LibTmux.Workspace.Cli/CommandLine.cs', find: ['Add(Root, "load"', 'Add(Root, "freeze"', 'Add(Root, "convert"'] },
      { path: 'src/LibTmux.Workspace.Cli/DocumentStore.cs', find: 'Extensions = [".yaml", ".yml", ".json"]' },
    ],
  },
  cxx: {
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'apps/workspace/src/cli.cpp', find: ['add_subcommand("load"', 'add_subcommand("freeze"', 'add_subcommand("convert"'] },
      { path: 'apps/workspace/src/services.cpp', find: 'for (const auto* extension : {".yaml", ".yml", ".json"})' },
    ],
  },
  swift: {
    verbs: ['load', 'freeze', 'convert'],
    formats: YAML_JSON,
    formatNote: 'YAML needs a build with the YAMLWorkspaces trait.',
    checks: [
      { path: 'Sources/TmuxWorkspaceCLI/Commands.swift', find: ['struct Load: WorkspaceAction', 'struct Freeze: WorkspaceAction', 'struct Convert: WorkspaceAction'] },
      { path: 'Sources/TmuxWorkspaceCLI/DocumentStore.swift', find: ['static let extensions = ["yaml", "yml", "json"]', 'Build with the YAMLWorkspaces trait to read YAML.'] },
    ],
  },
  ruby: {
    verbs: ['load'],
    formats: YAML_JSON,
    checks: [{ path: 'gems/libtmux-workspace/lib/libtmux/workspace/cli.rb', find: '%w[validate plan load]', absent: ['freeze', 'convert'] },
      { path: 'gems/libtmux-workspace/lib/libtmux/workspace.rb', find: ['when ".json" then :json', 'when ".yaml", ".yml" then :yaml'] },
    ],
  },
  julia: {
    verbs: ['load', 'freeze'],
    formats: YAML_JSON,
    checks: [{ path: 'packages/LibTmuxWorkspace/src/cli.jl', find: 'Usage: libtmux-workspace <validate|plan|load|freeze>', absent: 'convert' },
      { path: 'packages/LibTmuxWorkspace/src/parser.jl', find: ['extension in (".yaml", ".yml") ? :yaml :', 'extension == ".json" ? :json :'] },
    ],
  },
  powershell: {
    verbs: ['load', 'convert'],
    formats: YAML_JSON,
    checks: [{ path: 'module/LibTmux.Workspace/LibTmux.Workspace.psd1', find: ['Invoke-TmuxWorkspace', 'ConvertTo-TmuxWorkspaceYaml', 'ConvertTo-TmuxWorkspaceJson'], absent: ['freeze', 'Freeze'] },
      { path: 'docs/reference/LibTmux.Workspace/Import-TmuxWorkspace.md', find: 'supplied YAML/JSON text' },
    ],
  },
}

/**
 * @typedef {{ name: string, href: string }} Sdk
 * @type {Record<string, { checkout?: string, sdk?: Sdk, protocol?: { name: string, href: string }, checks: Check[] }>}
 *
 * `sdk` is the library the server is built on. A server that carries its own
 * JSON-RPC layer has `protocol` instead, naming the protocol it implements.
 */
export const MCP = {
  py: {
    checkout: process.env.LIBTMUX_DOCS_CHECKOUT_LIBTMUX_MCP || '~/work/python/libtmux-mcp',
    sdk: { name: 'FastMCP', href: 'https://gofastmcp.com/' },
    checks: [{ path: 'pyproject.toml', find: '"fastmcp>=4.0.2,<5.0.0"' }],
  },
  ts: {
    sdk: { name: 'MCP TypeScript SDK', href: 'https://github.com/modelcontextprotocol/typescript-sdk' },
    checks: [{ path: 'packages/mcp/package.json', find: '"@modelcontextprotocol/sdk"' }],
  },
  rs: {
    sdk: { name: 'rmcp', href: 'https://github.com/modelcontextprotocol/rust-sdk' },
    checks: [{ path: 'crates/tmux-mcp/Cargo.toml', find: 'rmcp = {' }],
  },
  go: {
    sdk: { name: 'MCP Go SDK', href: 'https://github.com/modelcontextprotocol/go-sdk' },
    checks: [{ path: 'mcp/go.mod', find: 'github.com/modelcontextprotocol/go-sdk' }],
  },
  java: {
    sdk: { name: 'MCP Java SDK', href: 'https://github.com/modelcontextprotocol/java-sdk' },
    checks: [{ path: 'gradle/libs.versions.toml', find: 'mcp-core' }],
  },
  csharp: {
    sdk: { name: 'MCP C# SDK', href: 'https://github.com/modelcontextprotocol/csharp-sdk' },
    checks: [{ path: 'Directory.Packages.props', find: '<PackageVersion Include="ModelContextProtocol" ' }],
  },
  ruby: {
    sdk: { name: 'MCP Ruby SDK', href: 'https://github.com/modelcontextprotocol/ruby-sdk' },
    checks: [{ path: 'gems/libtmux-mcp/libtmux-mcp.gemspec', find: 'spec.add_dependency "mcp"' }],
  },
  julia: {
    sdk: { name: 'ModelContextProtocol.jl', href: 'https://github.com/JuliaSMLM/ModelContextProtocol.jl' },
    checks: [{ path: 'packages/LibTmuxMCP/Project.toml', find: 'ModelContextProtocol =' }],
  },
  cxx: {
    protocol: { name: 'Model Context Protocol', href: MODEL_CONTEXT_PROTOCOL },
    checks: [
      { path: 'apps/mcp/README.md', find: 'speaks newline-delimited JSON-RPC over stdio' },
      { path: 'apps/mcp/CMakeLists.txt', absent: 'modelcontextprotocol' },
    ],
  },
  swift: {
    protocol: { name: 'Model Context Protocol', href: MODEL_CONTEXT_PROTOCOL },
    checks: [
      { path: 'Sources/LibTmuxMCP/MCPProtocol.swift', find: 'JSON-RPC handling lives in the library target' },
      { path: 'Package.swift', absent: 'modelcontextprotocol' },
    ],
  },
}
