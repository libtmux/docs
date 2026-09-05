#!/usr/bin/env node
/**
 * Extract a port's API model to JSON, ahead of the Astro build.
 *
 * The site reads `site/src/data/api/<port>.json`. Unlike its neighbours
 * `parity.json` and `mcp-tools.json`, this one is *not* checked in —
 * `.gitignore` names the directory. It is 5 MB of derived JSON that changes
 * whenever any of eight sibling ports does, and its diff says nothing a
 * reader can use.
 *
 * Extraction is separate from the Astro build because that build runs
 * fourteen times per assembly, and because the source checkouts are siblings
 * of this repository rather than dependencies of it: a shell build on a
 * machine without `~/work/python/libtmux` would silently render an empty
 * reference. Generating once, up front, turns that into one loud failure, and
 * `--check` says when a model is stale.
 *
 * Because the models are not in the tree, a fresh clone has none until this
 * runs — so everything that reads them (`gen-mentions.mjs`,
 * `check-source-links.mjs`) reports their absence rather than counting it as
 * zero.
 *
 * Usage: node scripts/gen-api-model.mjs [--port py] [--check]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapLine, parseHunks } from '../packages/api-model/src/source-lines.ts'
import { extractProject } from '../packages/api-model/src/project.ts'
import { pageSlug, OWNER_KINDS } from '../packages/api-model/src/prose.ts'
import { moduleOf } from '../packages/api-model/src/modules.ts'
import { CONCEPTS } from '../packages/api-model/src/concepts.ts'
import { NAV } from '../packages/api-model/src/nav-config.ts'
import { compileNav } from '../packages/api-model/src/nav.ts'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Four base-36 characters of a string, enough to separate 96 collisions. */
function shortHash(text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).slice(0, 4)
}
const expand = (p) => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)

/** One git command, or undefined when it fails — several are expected to. */
function git(repo, ...args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/**
 * The newest ancestor of `head` that exists in the public repository.
 *
 * Source links point at `github.com/<repo>/blob/<revision>/…`, and `revision`
 * was `rev-parse HEAD`. Several ports are extracted from a `-docs` worktree
 * whose head lives only on the private `tony` fork, so that URL 404s for
 * every reader — measured across the estate, three of eight ports were
 * publishing links to commits the public repository has never seen, and
 * `check-links.mjs` cannot see it because these are external URLs.
 *
 * `merge-base` with the public default branch is the newest commit that is
 * both an ancestor of what was extracted and something a reader can open.
 * Resolved through `origin/HEAD` rather than a hardcoded `master`, because
 * this estate has both `master` and `main` ports.
 *
 * Falls back to `head` loudly. A dead link is worse than a live one, but a
 * silently missing source link is worse than both.
 */
function publicRevision(checkout, head, port, repo) {
  if (!head) return undefined

  // The blob URL and the merge-base have to name the same repository;
  // nothing else ties the `repo` field to the checkout it is paired with.
  const origin = git(checkout, 'remote', 'get-url', 'origin')
  if (origin && repo && !origin.replace(/\.git$/, '').endsWith(repo)) {
    console.error(`gen-api-model: ${port} origin is ${origin}, but repo says ${repo}`)
    process.exit(1)
  }

  const ref =
    git(checkout, 'symbolic-ref', 'refs/remotes/origin/HEAD') ??
    ['refs/remotes/origin/master', 'refs/remotes/origin/main'].find((r) =>
      git(checkout, 'rev-parse', '--verify', '--quiet', r),
    )
  if (!ref) {
    console.warn(`gen-api-model: ${port} has no public branch; source links may 404`)
    return head
  }
  const base = git(checkout, 'merge-base', head, ref)
  if (!base) {
    console.warn(`gen-api-model: ${port} head shares no history with ${ref}`)
    return head
  }
  return base
}

/**
 * Carry each symbol's line from the extracted commit to the public one.
 *
 * The public ancestor's line numbers are its own. Where a docs branch added
 * comment lines above a declaration the declaration did not change but its
 * line did, and pointing at the old number would put the reader somewhere
 * else in the file with nothing to show it. `git diff -U0` says how far each
 * line moved; a line the diff rewrote has no counterpart and loses its number
 * rather than getting a wrong one.
 */
function remapLines(checkout, symbols, from, to) {
  if (!from || !to || from === to) return { shifted: 0, dropped: 0 }
  const maps = new Map()
  let shifted = 0
  let dropped = 0
  for (const s of symbols) {
    const { file, line } = s.source
    if (!file || !line) continue
    if (!maps.has(file)) {
      const diff = git(checkout, 'diff', '-U0', `${from}..${to}`, '--', file)
      maps.set(file, diff ? parseHunks(diff) : [])
    }
    const mapped = mapLine(maps.get(file), line)
    if (mapped === null) {
      const { line: _drop, ...rest } = s.source
      s.source = rest
      dropped++
    } else if (mapped !== line) {
      s.source = { ...s.source, line: mapped }
      shifted++
    }
  }
  return { shifted, dropped }
}

/** Where each port's sources live, and what to feed the extractor. */
const PORTS = {
  py: {
    checkout: '~/work/python/libtmux',
    root: 'src',
    repo: 'tmux-python/libtmux',
    // libtmux's own conf.py passes both; specialMembers is ours, because
    // `__enter__` and `__getitem__` are part of how the library is used.
    options: { privateMembers: true, specialMembers: true, inheritedMembers: true },
  },
  ts: {
    checkout: '~/work/libtmux/libtmux-ts',
    roots: ['packages/libtmux/src', 'packages/workspace/src'],
    repo: 'libtmux/libtmux-ts',
    // `_internal` is 1,426 of this port's 2,242 symbols — generated graph
    // projections and normalisers no consumer can import.
    options: { inheritedMembers: true, excludePaths: [/^_internal\./, /^_generated\./] },
  },
  rs: {
    checkout: '~/work/libtmux/libtmux-rs',
    roots: ['crates/libtmux/src', 'crates/tmux-workspace/src'],
    repo: 'libtmux/libtmux-rs',
    options: { inheritedMembers: false, excludePaths: [/^internal\./] },
  },
  go: {
    checkout: '~/work/libtmux/libtmux-go',
    roots: ['tmux', 'tmuxq', 'workspace'],
    repo: 'libtmux/libtmux-go',
    // Go has no inheritance; embedding is composition and resolving it by
    // name would invent members the language does not promote.
    options: { inheritedMembers: false, excludePaths: [/^internal\./, /^tmux\.internal\./] },
  },
  java: {
    checkout: '~/work/libtmux/libtmux-java',
    roots: ['libtmux/src/main/java', 'libtmux-workspace/src/main/java', 'libtmux-jackson/src/main/java', 'libtmux-junit5/src/main/java'],
    repo: 'libtmux/libtmux-java',
    options: { inheritedMembers: true },
  },
  dotnet: {
    checkout: '~/work/libtmux/libtmux-dotnet',
    roots: ['src/LibTmux', 'src/LibTmux.Workspace', 'src/LibTmux.Query.Json', 'src/LibTmux.Testing'],
    repo: 'libtmux/libtmux-dotnet',
    options: { inheritedMembers: true },
  },
  // C++ comes from the Doxygen XML this project's own build already produces:
  // tree-sitter has no preprocessor, so `LIBTMUX_NAMESPACE_BEGIN` derails the
  // file and `void f(std::string s = {})` loses its default argument.
  // `root` is the checkout, which holds both `xml/` and the headers the prose
  // is read from — Doxygen sees only `///`, and this port documents with `//`.
  cxx: {
    checkout: '~/work/libtmux/libtmux-cxx-docs',
    root: '.',
    repo: 'libtmux/libtmux-cxx',
    options: {},
  },
  // Swift comes from `swift build -Xswiftc -emit-symbol-graph`, whose output
  // carries typed throws and pre-resolved cross-references. The tree-sitter
  // grammar mis-parses 50 of this port's 91 files.
  swift: {
    checkout: '~/work/libtmux/libtmux-swift-docs',
    root: '.',
    repo: 'libtmux/libtmux-swift',
    options: {},
  },
}

const args = process.argv.slice(2)
const only = args.includes('--port') ? args[args.indexOf('--port') + 1] : undefined
const check = args.includes('--check')

let stale = 0
let skipped = 0
for (const [port, cfg] of Object.entries(PORTS)) {
  if (only && only !== port) continue
  const checkout = expand(cfg.checkout)
  if (!existsSync(checkout)) {
    // Generating without source is impossible, so that still fails. Checking
    // without source is merely unanswerable, and a fresh clone and a CI runner
    // both lack every sibling checkout — failing there would make this
    // impossible to gate anywhere but a fully provisioned machine. Say which
    // ports went unchecked, the shape check-source-links.mjs already uses.
    if (check) {
      console.log(`gen-api-model: ${port} skipped, no checkout at ${cfg.checkout}`)
      skipped++
      continue
    }
    console.error(`gen-api-model: no checkout for ${port} at ${cfg.checkout}`)
    process.exit(1)
  }

  const head = git(checkout, 'rev-parse', 'HEAD')
  // The commit a reader can actually open, which is not always the one the
  // model is generated from. See `publicRevision`.
  const revision = publicRevision(checkout, head, port, cfg.repo)

  const roots = (cfg.roots ?? [cfg.root])
    .map((r) => join(checkout, r))
    .filter((r) => existsSync(r))
  if (!roots.length) {
    console.error(`gen-api-model: no source roots exist for ${port}`)
    process.exit(1)
  }
  const model = await extractProject({
    port,
    root: roots[0],
    roots,
    revision,
    options: cfg.options,
  })

  /**
   * A source path a blob URL can use.
   *
   * Absolute paths are machine-specific and would churn the diff on every
   * clone, so they are stored relative to the repository root. Two things
   * make that more than one `relative()` call, and getting it wrong made
   * every C++ and Swift "source" link a 404 — GitHub does not normalise `..`
   * in a blob path, and `check-links.mjs` never saw it because these are
   * external URLs.
   *
   * Doxygen already reports paths relative to its own input root, and
   * `relative()` resolves a relative second argument against the *process*
   * cwd — which is this repository, not the checkout. That turned
   * `include/libtmux/abi.hpp` into `../docs/include/libtmux/abi.hpp`.
   *
   * Swift's symbol graph reports absolute paths into the sibling source
   * checkout rather than the `-docs` worktree the graph was built in, so
   * relativising against the worktree produced `../libtmux-swift/Sources/…`.
   * The path belongs to the repository it names, which is the checkout with
   * the `-docs` suffix removed.
   */
  const repoRoots = [checkout, checkout.replace(/-docs$/, '')]
  for (const s of model.symbols) {
    const file = s.source.file
    if (!isAbsolute(file)) continue
    const base = repoRoots.find((r) => file.startsWith(`${r}/`)) ?? checkout
    s.source = { ...s.source, file: relative(base, file) }
  }
  /*
   * A unique URL segment per symbol, decided here rather than derived.
   *
   * Every symbol gets its own page, so its slug has to be injective — and
   * `pageSlug` alone is not. It lowercases, so `libtmux::Client::name` and
   * `libtmux::client::name` collapse together, and it strips punctuation, so
   * Swift's `!=(_:_:)` and `==(_:_:)` do too. 96 symbols across five ports
   * would have shared a page with something else, silently: Astro keeps the
   * last writer.
   *
   * Colliding slugs take a short hash of the full id. Only the collisions do,
   * so 11,496 URLs stay readable, and the hash is of the id rather than of a
   * position in a sorted list — a new symbol joining a group must not rename
   * the pages of the ones already in it.
   */
  const bySlug = new Map()
  for (const s of model.symbols) {
    const base = pageSlug(s.publicId ?? s.id)
    if (!bySlug.has(base)) bySlug.set(base, [])
    bySlug.get(base).push(s)
  }
  let disambiguated = 0
  for (const [base, group] of bySlug) {
    if (group.length === 1) {
      group[0].slug = base
      continue
    }
    for (const s of group) {
      s.slug = `${base}-${shortHash(s.publicId ?? s.id)}`
      disambiguated++
    }
  }

  model.repo = cfg.repo

  // Lines are the extracted commit's; the link names the public one.
  const moved = remapLines(checkout, model.symbols, revision, head)

  const out = join(repoRoot, 'site/src/data/api', `${port}.json`)
  mkdirSync(dirname(out), { recursive: true })
  const text = `${JSON.stringify(model, null, 0)}\n`

  if (check) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : ''
    // The revision moves whenever the port does, which is not staleness of
    // *this* file's content. Compare everything else.
    const strip = (t) => t.replace(/"revision":"[0-9a-f]*",?/, '')
    if (strip(current) !== strip(text)) {
      console.error(`gen-api-model: ${port}.json is stale — re-run without --check`)
      stale++
    } else {
      console.log(`gen-api-model: ${port}.json current (${model.symbols.length} symbols)`)
    }
    continue
  }

  writeFileSync(out, text)

  /*
   * The files this port ships at that revision, for prose that names one.
   *
   * Written here because this is where the checkout and the revision are
   * already resolved. The alternative is `git ls-tree` inside the markdown
   * pipeline, which runs fourteen times per assembly across eight
   * repositories — a hundred and twelve git invocations to answer a question
   * whose answer cannot change during a build.
   */
  /*
   * The sidebar, compiled once.
   *
   * Placing every symbol costs milliseconds and the answer cannot change
   * during a build, so it is decided here beside `slug` and written as a
   * sidecar. The alternative is every page scanning every symbol, which is
   * how the old flat sidebar worked.
   */
  const navTypes = model.symbols.filter((s) => !s.parent && OWNER_KINDS.has(s.kind))
  const conceptIds = Object.fromEntries(
    Object.entries(CONCEPTS)
      .map(([k, c]) => [k, c.symbols[port]])
      .filter(([, v]) => typeof v === 'string'),
  )
  const nav = NAV[port]
    ? compileNav(NAV[port], navTypes, { conceptIds, moduleOf })
    : undefined
  if (nav) {
    const byId = new Map(model.symbols.map((s) => [s.publicId ?? s.id, s]))
    writeFileSync(
      join(repoRoot, 'site/src/data/api', `${port}.nav.json`),
      `${JSON.stringify({
        port,
        buckets: (function shape(bs) {
          return bs.map((b) => ({
            id: b.id,
            label: b.label,
            collapsed: b.collapsed ?? false,
            ...(b.children ? { children: shape(b.children) } : {}),
          }))
        })(NAV[port].buckets),
        assignments: Object.fromEntries(
          Object.entries(nav.assignments).map(([bucket, ids]) => [
            bucket,
            ids
              .map((id) => byId.get(id))
              .filter(Boolean)
              .map((sym) => ({ id: sym.publicId ?? sym.id, name: sym.name, slug: sym.slug, kind: sym.kind })),
          ]),
        ),
        // Every symbol, including the unplaced: a page looks its bucket up
        // and never scans a list to discover it has none.
        placement: Object.fromEntries([
          ...Object.entries(nav.assignments).flatMap(([bucket, ids]) =>
            ids.map((id) => [id, bucket]),
          ),
          ...nav.unplaced.map((id) => [id, '__unplaced']),
        ]),
        unplaced: nav.unplaced
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((sym) => ({ id: sym.publicId ?? sym.id, name: sym.name, slug: sym.slug, kind: sym.kind })),
        diagnostics: nav.diagnostics,
      })}\n`,
    )
  }

  const tree = git(checkout, 'ls-tree', '-r', '--name-only', head ?? 'HEAD')
  if (tree) {
    writeFileSync(
      join(repoRoot, 'site/src/data/api', `${port}.paths.json`),
      `${JSON.stringify({ port, repo: cfg.repo, revision, paths: tree.split('\n').filter(Boolean) })}\n`,
    )
  }

  const kinds = model.symbols.reduce((a, s) => ((a[s.kind] = (a[s.kind] ?? 0) + 1), a), {})
  console.log(
    `gen-api-model: ${port} -> ${model.symbols.length} symbols ` +
      `(${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}) ` +
      `${(text.length / 1024 / 1024).toFixed(1)} MB` +
      (disambiguated ? ` [${disambiguated} slugs disambiguated]` : '') +
      (moved.shifted || moved.dropped
        ? ` [${revision?.slice(0, 8)}: ${moved.shifted} lines shifted, ${moved.dropped} dropped]`
        : ''),
  )
}
if (check && skipped) console.log(`gen-api-model: ${skipped} port(s) skipped`)
process.exit(stale ? 1 : 0)
