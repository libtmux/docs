import type { ApiSymbol, DocBlock } from '../model.ts'

interface CxxExample {
  id: string
  symbols: string[]
  title: string
  description: string
  expectedOutput: string
  file: string
}

interface CxxExamples {
  schemaVersion: number
  projectFile: string
  programs: CxxExample[]
}

/** Attach complete C++ consumers read from the same revision as their library. */
export function attachCompleteCxxExamples(
  symbols: ApiSymbol[],
  read: (path: string) => string | undefined,
  source: { repo: string; revision: string },
): void {
  const raw = read('examples/api/api-examples.json')
  if (raw === undefined) return
  const manifest = JSON.parse(raw) as CxxExamples
  const require = (condition: unknown, message: string): void => {
    if (!condition) throw new Error(`Invalid complete C++ examples: ${message}`)
  }
  require(source.repo === 'libtmux/libtmux-cxx' &&
    /^[a-f0-9]{40}$/.test(source.revision), 'source must name the C++ repository and a full revision')
  require(manifest?.schemaVersion === 1 &&
    Array.isArray(manifest.programs) &&
    manifest.programs.length, 'unsupported or empty manifest')
  require(manifest.projectFile === 'examples/api/project/CMakeLists.txt', 'unexpected consumer project')
  const codeFor = (path: string): string => {
    const code = read(path)
    if (!code?.trim() || !code.endsWith('\n') || code.includes('\r')) {
      throw new Error(`Invalid complete C++ examples: missing complete LF source: ${path}`)
    }
    return code
  }
  const urlFor = (path: string) => `https://github.com/${source.repo}/blob/${source.revision}/${path}`
  const project = codeFor(manifest.projectFile)
  const names = new Set<string>()
  const targets = new Set<string>()
  for (const example of manifest.programs) {
    require(/^[a-z][a-z0-9-]*$/.test(example.id) && !names.has(example.id), 'invalid or duplicate program name')
    names.add(example.id)
    require(example.file === `examples/api/${example.id}.cpp`, 'unexpected program path')
    require(typeof example.title === 'string' &&
      example.title.trim() &&
      typeof example.description === 'string' &&
      example.description.trim(), 'task description is missing')
    require(typeof example.expectedOutput === 'string' &&
      example.expectedOutput.trim() &&
      example.expectedOutput.endsWith('\n') &&
      !example.expectedOutput.includes('\r'), 'expected output is missing or incomplete')
    require(Array.isArray(example.symbols) &&
      example.symbols.length &&
      example.symbols.every(
        (id) => typeof id === 'string' && /^libtmux::[A-Za-z_][\w:]*$/.test(id),
      ), 'API targets are missing')
    const program = codeFor(example.file)
    require(program.includes('int main()'), 'program entry point is missing')
    const blocks: NonNullable<DocBlock['examples']> = [
      {
        lang: 'console',
        intro: `${example.title}. ${example.description.replace(/\n/g, ' ')} Use Clang 18 with libc++ 18, CMake 3.25 or newer, Ninja, Git, and tmux 3.2a or newer on Linux. In an empty directory, fetch the documented library revision:`,
        code: `$ git clone https://github.com/${source.repo}.git libtmux-source && \\\n  git -C libtmux-source checkout ${source.revision}\n`,
      },
      {
        lang: 'console',
        intro: 'Build and install the C++23 library and its public testing component into this directory:',
        code: '$ cmake -S libtmux-source -B libtmux-build -G Ninja \\\n    -DCMAKE_TOOLCHAIN_FILE="$PWD/libtmux-source/cmake/toolchains/clang-libcxx.cmake" \\\n    -DCMAKE_C_COMPILER=clang \\\n    -DCMAKE_CXX_COMPILER=clang++ \\\n    -DCMAKE_BUILD_TYPE=Release \\\n    -DLIBTMUX_BUILD_TESTS=OFF \\\n    -DLIBTMUX_BUILD_EXAMPLES=OFF \\\n    -DLIBTMUX_BUILD_TESTING_LIBRARY=ON && \\\n  cmake --build libtmux-build --parallel 2 && \\\n  cmake --install libtmux-build --prefix "$PWD/libtmux-prefix"\n',
      },
      {
        lang: 'cmake',
        intro: 'Save this complete consumer project as CMakeLists.txt:',
        sourceUrl: urlFor(manifest.projectFile),
        code: project,
      },
      {
        lang: 'cpp',
        intro:
          'Save this complete program as main.cpp. `ScopedTmuxServer` owns a private daemon and stops it when the program exits. Ordinary applications use `Server` for their own socket; these examples use the fixture until setup moves to ordinary server objects.',
        sourceUrl: urlFor(example.file),
        code: program,
      },
      {
        lang: 'console',
        intro:
          'Build against the installed library and run the saved program. An operation error produces a failing exit status:',
        code: '$ cmake -S . -B build -G Ninja \\\n    -DCMAKE_PREFIX_PATH="$PWD/libtmux-prefix" \\\n    -DCMAKE_CXX_COMPILER=clang++ \\\n    -DCMAKE_CXX_FLAGS=-stdlib=libc++ && \\\n  cmake --build build --parallel 2 && \\\n  ./build/api_example\n',
      },
      { lang: 'text', intro: 'Expected output:', code: example.expectedOutput },
    ]
    for (const id of example.symbols) {
      require(!targets.has(id), `duplicate API target: ${id}`)
      const matches = symbols.filter((symbol) => symbol.id === id)
      require(matches.length === 1, `API target must resolve once: ${id}`)
      targets.add(id)
      const symbol = matches[0]
      symbol.doc = { summary: '', ...symbol.doc, examples: [...(symbol.doc?.examples ?? []), ...blocks] }
    }
  }
}
