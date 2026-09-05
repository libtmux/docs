import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CONCEPTS } from '@libtmux/api-model'
import { DB_PATH, MODEL_DIR, SCHEMA_PATH, SITE_ROOT } from './paths'

/**
 * Build the API projection from the extracted models.
 *
 * Uses `node:sqlite` rather than a driver plus an ORM. Three reasons, and the
 * first is the one that decides it: Astro's `getStaticPaths` is synchronous,
 * so an async client would have to be awaited somewhere it cannot be.
 * `DatabaseSync` is synchronous, and `StatementSync` gives real prepared
 * statements — the same plan reused across thousands of lookups. It is also
 * built into Node, so the projection costs the workspace no dependency.
 *
 * The database is dropped and rebuilt every time. It is derived data over
 * `src/data/api/*.json`; there is no state to migrate and nothing to
 * reconcile, so "regenerate" is always the correct repair.
 */

interface RawSymbol {
  id: string
  publicId?: string
  name: string
  kind: string
  parent?: string
  inheritedFrom?: string
  type?: string
  value?: string
  modifiers?: string[]
  signatures?: unknown[]
  extends?: string[]
  doc?: { summary?: string } & Record<string, unknown>
  source?: { file?: string; line?: number }
}

interface RawModel {
  port: string
  revision?: string
  extractor: string
  symbols: RawSymbol[]
}

interface VersionEntry {
  slug: string
  supported: boolean
}

interface VersionManifest {
  ports?: Record<string, VersionEntry[]>
}

/**
 * Which version slugs each port is built at.
 *
 * One extraction currently serves every version of a port — there is one
 * checkout per port, not one per tag — so the same symbols are written once
 * per version. That is deliberate rather than wasteful: the moment a version
 * is extracted from its own checkout, only the seeding loop changes, because
 * `version` is already a key column everywhere it needs to be.
 */
function versionsFor(port: string, manifestPath: string): string[] {
  if (!existsSync(manifestPath)) return ['latest']
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as VersionManifest
    const entries = parsed.ports?.[port]?.filter((v) => v.supported).map((v) => v.slug)
    return entries?.length ? entries : ['latest']
  } catch {
    return ['latest']
  }
}

/** One prose mention of a symbol, as `site/src/data/mentions.json` records it. */
interface RawMention {
  port: string
  symbol: string
  page: string
  title?: string
  section?: string
}

export interface SeedOptions {
  /**
   * Generated mention index to read. Defaults to the published one.
   *
   * Absent is not empty. A missing file means the generator has not run, and
   * the seed says so in its result rather than seeding zero rows and letting
   * "no backlinks anywhere" read as a true answer about the content.
   */
  mentionsPath?: string
  /**
   * Version manifest to read. Defaults to the published one.
   *
   * Injectable so a test can drive the manifest rather than the manifest
   * driving the test — which is the only way to prove the pruning claim
   * below, since it is a claim about what happens when a version *leaves*.
   */
  manifestPath?: string
}

export interface SeedResult {
  ports: number
  rows: number
  path: string
  /** Symbols dropped because their id collided, keyed by port. Should be empty. */
  collisions: Record<string, number>
  /** Prose mentions indexed, or undefined when the generator has not run. */
  mentions?: number
}

/**
 * Rows for a version that has left the manifest are not deleted — they are
 * never written. Seeding builds a fresh database in a scratch file and renames
 * it over the old one, so the store holds exactly what the current manifest
 * asks for and nothing survives a build by inertia.
 *
 * That is worth stating because "prune stale rows" sounds like it needs a
 * DELETE, and reaching for one here would be a way to get it subtly wrong.
 * `test/api-db-prune.test.ts` drives a shrinking manifest to prove it.
 */
export function seed(options: SeedOptions = {}): SeedResult {
  const manifestPath = options.manifestPath ?? join(SITE_ROOT, 'public/versions.json')
  const mentionsPath = options.mentionsPath ?? join(SITE_ROOT, 'src/data/mentions.json')
  mkdirSync(dirname(DB_PATH), { recursive: true })

  // Build into a private file and rename it into place at the end.
  //
  // `rename` within a directory is atomic, so a reader either sees the
  // previous complete database or the new complete one, never a partial. That
  // matters in two places: a build killed halfway leaves the old store intact
  // rather than a truncated one that opens without error, and two processes
  // seeding at once (vitest runs test files in parallel) stop corrupting each
  // other — they each build their own and the last rename wins, which is fine
  // because the content is identical derived data.
  const scratch = `${DB_PATH}.${process.pid}.tmp`
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${scratch}${suffix}`, { force: true })

  const db = new DatabaseSync(scratch)
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'))

  const insertExtraction = db.prepare(
    `INSERT INTO extraction (port, version, revision, extractor, symbols, built_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  // `ON CONFLICT DO NOTHING` rather than a plain insert, because a duplicate
  // id is an upstream defect and crashing the build is the wrong response to
  // one: it takes down all eight ports over a handful of symbols in one.
  //
  // It is not swallowed either. Every collision is counted and returned, so a
  // test can assert the number and name the port. Swift currently produces 29
  // of them — its ids come from the symbol graph's title path, which omits
  // parameter types, so `FilterOperator.equals(_:)` collides with its own
  // overloads six ways. The fix belongs in that adapter (the graph's
  // `preciseIdentifier` distinguishes them); until then this reports rather
  // than hides it.
  const insertSymbol = db.prepare(
    `INSERT INTO symbol (
       port, version, id, public_id, name, kind, parent, inherited_from,
       type, value, source_file, source_line, summary, modifiers,
       signatures, extends, doc
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (port, version, id) DO NOTHING`,
  )

  const builtAt = new Date().toISOString()
  let ports = 0
  let rows = 0
  const collisions: Record<string, number> = {}
  let mentions: number | undefined

  db.exec('BEGIN')
  try {
    for (const port of ['py', 'ts', 'rs', 'go', 'java', 'dotnet', 'cxx', 'swift']) {
      const file = join(MODEL_DIR, `${port}.json`)
      if (!existsSync(file)) continue
      const model = JSON.parse(readFileSync(file, 'utf8')) as RawModel
      ports += 1

      for (const version of versionsFor(port, manifestPath)) {
        insertExtraction.run(
          port,
          version,
          model.revision ?? null,
          model.extractor,
          model.symbols.length,
          builtAt,
        )
        for (const s of model.symbols) {
          const result = insertSymbol.run(
            port,
            version,
            s.id,
            s.publicId ?? null,
            s.name,
            s.kind,
            s.parent ?? null,
            s.inheritedFrom ?? null,
            s.type ?? null,
            s.value ?? null,
            s.source?.file ?? null,
            s.source?.line ?? null,
            typeof s.doc?.summary === 'string' ? s.doc.summary : null,
            JSON.stringify(s.modifiers ?? []),
            JSON.stringify(s.signatures ?? []),
            JSON.stringify(s.extends ?? []),
            s.doc ? JSON.stringify(s.doc) : null,
          )
          // `changes` is 0 when the conflict clause suppressed the insert.
          if (result.changes === 0) collisions[port] = (collisions[port] ?? 0) + 1
          else rows += 1
        }
      }
    }
    // Project the concept map. The module stays the source of truth — see
    // schema.sql — this is the index over it.
    const insertConcept = db.prepare('INSERT INTO concept (id, label) VALUES (?, ?)')
    const insertBinding = db.prepare(
      `INSERT INTO concept_binding (concept, port, symbol_id, absent_reason)
       VALUES (?, ?, ?, ?)`,
    )
    for (const [id, concept] of Object.entries(CONCEPTS)) {
      insertConcept.run(id, concept.label)
      for (const [port, symbolId] of Object.entries(concept.symbols)) {
        insertBinding.run(id, port, symbolId, null)
      }
      for (const [port, reason] of Object.entries(concept.absent ?? {})) {
        // A port cannot both implement and lack an operation; if the map ever
        // says so, the binding insert fails on the primary key rather than
        // one silently overwriting the other.
        insertBinding.run(id, port, null, reason)
      }
    }

    // Prose mentions, when the generator has produced them. A mention whose
    // port is unknown is dropped rather than stored: it would answer no query
    // and would quietly inflate the count that says how much was indexed.
    if (existsSync(mentionsPath)) {
      const insertMention = db.prepare(
        'INSERT INTO mention (port, symbol_id, page, title, section) VALUES (?, ?, ?, ?, ?) ' +
          'ON CONFLICT (port, symbol_id, page) DO NOTHING',
      )
      const parsed = JSON.parse(readFileSync(mentionsPath, 'utf8')) as {
        mentions?: RawMention[]
      }
      mentions = 0
      for (const m of parsed.mentions ?? []) {
        if (!m.port || !m.symbol || !m.page) continue
        const result = insertMention.run(m.port, m.symbol, m.page, m.title ?? null, m.section ?? null)
        if (result.changes > 0) mentions += 1
      }
    }

    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${scratch}${suffix}`, { force: true })
    throw error
  }

  // Let SQLite pick indexes from real distributions rather than its defaults.
  // Cheap here, and it is what keeps the cross-port `name` lookup a seek.
  db.exec('ANALYZE')
  // Fold the WAL back into the main file before renaming: the sidecars are
  // named after the scratch file and would be orphaned by the rename, losing
  // anything still uncheckpointed.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.close()

  for (const suffix of ['-wal', '-shm']) rmSync(`${scratch}${suffix}`, { force: true })
  renameSync(scratch, DB_PATH)

  return { ports, rows, path: DB_PATH, collisions, mentions }
}
