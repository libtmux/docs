#!/usr/bin/env node
/**
 * Stage docfx's Markdown output as an Astro content collection.
 *
 * `docfx metadata --outputFormat markdown` writes one file per type plus one
 * per namespace, cross-linked with `Foo.md` hrefs and docfx's own `<xref>`
 * element. Neither survives a move into Astro: a `.md` href 404s once pages
 * are directories, and an unknown `<xref>` element renders as *nothing* —
 * the reference silently disappears rather than breaking loudly, which is
 * the worse failure. Both are rewritten here.
 *
 * Usage: node stage-docfx.mjs <docfx-api-dir> <staged-dir> <port-slug>
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const [srcDir, outDir, port] = process.argv.slice(2)
if (!srcDir || !outDir || !port) {
  console.error('usage: stage-docfx.mjs <docfx-api-dir> <staged-dir> <port-slug>')
  process.exit(2)
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

const files = readdirSync(srcDir).filter((f) => f.endsWith('.md'))
if (files.length === 0) {
  console.error(`stage-docfx: no .md files in ${srcDir}`)
  process.exit(1)
}
/** Every page docfx emitted, by UID — the set a link or xref can resolve into. */
const known = new Set(files.map((f) => f.slice(0, -3)))

/**
 * docfx's anchor slug: runs of non-alphanumerics collapse to one underscore.
 * `LibTmux.Client.GetAsync(LibTmux.Server, System.String)` becomes
 * `LibTmux_Client_GetAsync_LibTmux_Server_System_String_`, trailing `_` and all.
 */
const anchorOf = (uid) => uid.replace(/[^A-Za-z0-9]+/g, '_')

/**
 * A UID as docfx means it, with any percent-escapes resolved.
 *
 * Malformed escapes are left alone rather than throwing: a UID that does not
 * decode is still a UID, and losing the whole reference over it would be a
 * worse answer than a link that was already going to be wrong.
 */
function decodeUid(uid) {
  try {
    return decodeURIComponent(uid)
  } catch {
    return uid
  }
}

/** The page a UID lives on: its longest dotted prefix that docfx emitted. */
function pageFor(uid) {
  const bare = uid.replace(/\(.*$/, '')
  const parts = bare.split('.')
  for (let i = parts.length; i > 0; i--) {
    const candidate = parts.slice(0, i).join('.')
    if (known.has(candidate)) return { page: candidate, member: i < parts.length }
  }
  return null
}

function yamlQuote(s) {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

const pages = []

for (const file of files) {
  const uid = file.slice(0, -3)
  const raw = readFileSync(join(srcDir, file), 'utf8')
  const lines = raw.split('\n')

  const h1 = lines.findIndex((l) => l.startsWith('# '))
  if (h1 === -1) throw new Error(`stage-docfx: ${file} has no H1`)
  const heading = lines[h1].replace(/^#\s+/, '').replace(/<a id="[^"]*"><\/a>\s*/, '')
  const [, kind = 'Class', shortName = uid] = heading.match(/^(\w+)\s+(.+)$/) ?? []

  // The first prose paragraph after docfx's Namespace/Assembly preamble is
  // the type's <summary>. Everything before it is metadata, not description.
  let summary = ''
  for (let i = h1 + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith('Namespace:') || line.startsWith('Assembly:')) continue
    if (line.startsWith('#') || line.startsWith('```')) break
    summary = line
    break
  }

  let body = lines.slice(h1 + 1).join('\n')

  // Give an enum's fields the anchors that link to them.
  //
  // docfx documents a type's members under their own headings, each carrying
  // an `<a id="…">`, but an enum's fields are written as bare inline code —
  // `` `NotDispatched = 1` `` — with no heading and no anchor. Its own xrefs
  // still point at `#LibTmux_TmuxDispatchState_NotDispatched`, so every link
  // to an enum member landed on the right page at the wrong place, and the
  // reader saw the top of a page instead of the value they asked about.
  //
  // Emitting the anchor is enough: it is the same id docfx would have used,
  // derived the same way as every other member's, and it leaves the rendered
  // line unchanged.
  if (kind === 'Enum') {
    body = body.replace(
      /^(`([A-Za-z_][A-Za-z0-9_]*) = [^`]*`)/gm,
      (_whole, code, field) => `<a id="${anchorOf(`${uid}.${field}`)}"></a>${code}`,
    )
  }

  // `](Foo.md)` and `](Foo.md#anchor)` -> `](../Foo/)`. Sibling pages are one
  // directory up from this page's own directory once URLs get trailing slashes.
  //
  // docfx backslash-escapes `#` and `_` in the fragment (`Foo.md\#A\_B`),
  // which is why the naive `\.md(#...)` pattern silently matches nothing and
  // leaves a `.md` href behind. Accept the escapes, then strip them: a link
  // destination is not markdown, so a literal backslash there would 404.
  body = body.replace(/\]\(([A-Za-z0-9_.+\\-]+?)\.md(\\?#[^)]*)?\)/g, (whole, target, hash = '') => {
    const uidTarget = target.replace(/\\/g, '')
    if (!known.has(uidTarget)) return whole
    return `](../${uidTarget.toLowerCase()}/${(hash ?? '').replace(/\\/g, '')})`
  })

  // `<xref href="UID" data-throw-if-not-resolved="false"></xref>` — an
  // element no browser knows, so it renders as empty. Resolve it to a real
  // link when the target was emitted, and to inline code when it wasn't
  // (a BCL type, usually), which at least keeps the name on the page.
  body = body.replace(/<xref\s+href="([^"]+)"[^>]*>\s*<\/xref>/g, (_whole, href) => {
    // Percent-decode first. docfx writes the comma between two parameter
    // types as `%2c` in an xref href but not in the anchor it emits on the
    // member itself, and `anchorOf` collapses the `%` while keeping the `2c`
    // as literal text — so every link to a method with two or more parameters
    // pointed at `…GetOptionRequest_2cSystem…` while the page offered
    // `…GetOptionRequest_System…`. Nine broken links, all of them anchors on
    // pages that existed, which is why the page looked fine on arrival.
    const uidRef = decodeUid(href.replace(/\*$/, ''))
    const label = uidRef.split('.').slice(-2).join('.').replace(/\(.*\)$/, '()')
    const hit = pageFor(uidRef)
    if (!hit) return `\`${label}\``
    const hash = hit.member ? `#${anchorOf(uidRef)}` : ''
    return `[${label}](../${hit.page.toLowerCase()}/${hash})`
  })

  const ns = kind === 'Namespace' ? uid : uid.split('.').slice(0, -1).join('.')
  pages.push({ uid, kind, shortName, ns, summary })

  const description = summary
    ? `${kind} ${shortName} in ${ns}. ${summary}`.slice(0, 300)
    : `${kind} ${shortName} in ${ns}.`

  const frontmatter = [
    '---',
    `title: ${yamlQuote(uid)}`,
    `description: ${yamlQuote(description)}`,
    `port: ${yamlQuote(port)}`,
    'generator: "docfx metadata (--outputFormat markdown)"',
    '---',
    '',
  ].join('\n')

  // Lowercase filename, proper-case title. This is learn.microsoft.com's own
  // shape (`/dotnet/api/system.string`) and it keeps the URL stable when a
  // type is renamed only in casing.
  writeFileSync(join(outDir, `${uid.toLowerCase()}.md`), frontmatter + body)
}

// ---------------------------------------------------------------------------
// Index: namespaces, then their types by kind. docfx's own toc.yml is not
// used — it is a second parse of data already in hand, and it drifts.
//
// Links here are `./name/`, not `../name/` as on every other page, and the
// asymmetry is real rather than an oversight. A type page renders at
// /<port>/<version>/api/<uid>/ and reaches a sibling by going up one; the
// index renders at /<port>/<version>/api/ and is already in the directory its
// siblings live in. Using `../` here sent all 215 links to
// /<port>/<version>/<uid>/, which does not exist.
// ---------------------------------------------------------------------------
const namespaces = pages.filter((p) => p.kind === 'Namespace').map((p) => p.uid).sort()
const KIND_ORDER = ['Interface', 'Class', 'Struct', 'Enum', 'Delegate']
const plural = { Interface: 'Interfaces', Class: 'Classes', Struct: 'Structs', Enum: 'Enums', Delegate: 'Delegates' }

const out = []
out.push('---')
out.push('title: ".NET API reference"')
out.push(
  'description: "Every public type in LibTmux, LibTmux.Query.Json, LibTmux.Workspace and LibTmux.Mcp, generated from the C# XML documentation comments."',
)
out.push(`port: ${yamlQuote(port)}`)
out.push('generator: "docfx metadata (--outputFormat markdown)"')
out.push('---')
out.push('')
out.push(
  `Generated from the XML documentation comments in the C# sources: ${pages.length - namespaces.length} public types across ${namespaces.length} namespaces.`,
)
out.push('')

for (const ns of namespaces) {
  const members = pages.filter((p) => p.ns === ns && p.kind !== 'Namespace')
  if (members.length === 0) continue
  out.push(`## [${ns}](./${ns.toLowerCase()}/)`)
  out.push('')
  for (const kind of KIND_ORDER) {
    const inKind = members.filter((m) => m.kind === kind).sort((a, b) => a.shortName.localeCompare(b.shortName))
    if (inKind.length === 0) continue
    out.push(`### ${plural[kind] ?? kind}`)
    out.push('')
    for (const m of inKind) {
      const summary = m.summary ? ` — ${m.summary.replace(/\s+/g, ' ')}` : ''
      out.push(`- [${m.shortName}](./${m.uid.toLowerCase()}/)${summary}`)
    }
    out.push('')
  }
}

writeFileSync(join(outDir, 'index.md'), out.join('\n'))
console.log(`stage-docfx: staged ${files.length} pages plus an index into ${outDir}`)
