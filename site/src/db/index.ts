import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { DB_PATH } from './paths'
import { seed as rebuild, type SeedOptions, type SeedResult } from './seed'

/**
 * Read access to the API projection.
 *
 * Every query is a `StatementSync` prepared once and reused. That is where
 * the lookup cost actually goes: SQLite plans the statement on first use and
 * the plan is reused for every call after, so rendering 1,009 reference pages
 * costs 1,009 index seeks against one plan rather than 1,009 parses plus
 * 1,009 scans over parsed JSON.
 *
 * The connection is opened lazily and kept for the process. A build is one
 * process; there is nothing to pool and nothing to close.
 */

export interface SymbolRow {
  port: string
  version: string
  id: string
  public_id: string | null
  name: string
  kind: string
  parent: string | null
  inherited_from: string | null
  type: string | null
  value: string | null
  source_file: string | null
  source_line: number | null
  summary: string | null
  modifiers: string
  signatures: string
  extends: string
  doc: string | null
}

export interface ExtractionRow {
  port: string
  version: string
  revision: string | null
  extractor: string
  symbols: number
  built_at: string
}

let db: DatabaseSync | undefined
let statements: Statements | undefined

export interface MentionRow {
  port: string
  symbol_id: string
  page: string
  title: string | null
  section: string | null
}

export interface ConceptBindingRow {
  concept: string
  label: string
  port: string
  symbol_id: string | null
  absent_reason: string | null
}

interface Statements {
  mentionsOfSymbol: StatementSync
  mentionsOnPage: StatementSync
  conceptOfSymbol: StatementSync
  bindingsOfConcept: StatementSync
  byId: StatementSync
  byPublicId: StatementSync
  children: StatementSync
  byKind: StatementSync
  acrossPorts: StatementSync
  extraction: StatementSync
  extractions: StatementSync
}

/**
 * `node:sqlite` types a result row as `Record<string, SQLOutputValue>`, which
 * TypeScript will not narrow to a named row type directly. The shape is
 * guaranteed by `schema.sql` rather than by the driver, so these two helpers
 * are where that guarantee is asserted, once, instead of at every call site.
 */
function rows<T>(statement: StatementSync, ...params: Array<string | number>): T[] {
  return statement.all(...params) as unknown as T[]
}

function row<T>(statement: StatementSync, ...params: Array<string | number>): T | undefined {
  return statement.get(...params) as unknown as T | undefined
}

function connect(): { db: DatabaseSync; statements: Statements } {
  if (db && statements) return { db, statements }

  // A build that runs without the seeding integration — a bare `astro dev`,
  // or a test importing this directly — seeds on first use rather than
  // failing. Seeding is idempotent and takes about a second.
  if (!existsSync(DB_PATH)) rebuild()

  const opened = new DatabaseSync(DB_PATH, { readOnly: true })
  const SELECT = 'SELECT * FROM symbol'
  statements = {
    byId: opened.prepare(`${SELECT} WHERE port = ? AND version = ? AND id = ?`),
    byPublicId: opened.prepare(`${SELECT} WHERE port = ? AND version = ? AND public_id = ?`),
    children: opened.prepare(`${SELECT} WHERE port = ? AND version = ? AND parent = ? ORDER BY name`),
    byKind: opened.prepare(`${SELECT} WHERE port = ? AND version = ? AND kind = ? ORDER BY id`),
    acrossPorts: opened.prepare(
      `SELECT port, id, public_id, kind, summary FROM symbol
       WHERE name = ? AND version = ? AND port != ? ORDER BY port`,
    ),
    mentionsOfSymbol: opened.prepare(
      'SELECT * FROM mention WHERE port = ? AND symbol_id = ? ORDER BY section, page',
    ),
    mentionsOnPage: opened.prepare('SELECT * FROM mention WHERE page = ? ORDER BY port, symbol_id'),
    conceptOfSymbol: opened.prepare(
      `SELECT b.concept, c.label FROM concept_binding b
       JOIN concept c ON c.id = b.concept
       WHERE b.port = ? AND b.symbol_id = ?`,
    ),
    bindingsOfConcept: opened.prepare(
      `SELECT b.concept, c.label, b.port, b.symbol_id, b.absent_reason
       FROM concept_binding b JOIN concept c ON c.id = b.concept
       WHERE b.concept = ? ORDER BY b.port`,
    ),
    extraction: opened.prepare('SELECT * FROM extraction WHERE port = ? AND version = ?'),
    extractions: opened.prepare('SELECT * FROM extraction ORDER BY port, version'),
  }
  db = opened
  return { db: opened, statements }
}

/**
 * Forget the open database.
 *
 * Seeding renames a freshly built file over the old one, which is what makes
 * a half-written build harmless — but a connection opened before the rename
 * still holds the *previous* inode and keeps answering from it. The file is
 * unlinked and invisible to everything else, so the staleness is silent: rows
 * for a version that left the manifest keep coming back from a database that
 * no longer exists on disk.
 */
function closeConnection(): void {
  db?.close()
  db = undefined
  statements = undefined
}

/**
 * Rebuild the projection and drop any connection to the old one.
 *
 * Always call seeding through here rather than importing `./seed` directly —
 * that module builds the file but knows nothing about who has it open.
 */
export function seed(options: SeedOptions = {}): SeedResult {
  const result = rebuild(options)
  closeConnection()
  return result
}

/** One symbol by its declaration id. */
export function symbolById(port: string, version: string, id: string): SymbolRow | undefined {
  return row<SymbolRow>(connect().statements.byId, port, version, id)
}

/** One symbol by the path it is imported and anchored by. */
export function symbolByPublicId(
  port: string,
  version: string,
  publicId: string,
): SymbolRow | undefined {
  return row<SymbolRow>(connect().statements.byPublicId, port, version, publicId)
}

/** A type's members, in the order a reference page lists them. */
export function membersOf(port: string, version: string, parent: string): SymbolRow[] {
  return rows<SymbolRow>(connect().statements.children, port, version, parent)
}

/** Every symbol of one kind — the per-port index pages. */
export function symbolsOfKind(port: string, version: string, kind: string): SymbolRow[] {
  return rows<SymbolRow>(connect().statements.byKind, port, version, kind)
}

/**
 * The same name in the other ports.
 *
 * This is the cross-language link: from `Pane.capture_pane` in Python to
 * whatever the other seven call it. It matches on `name` because nothing else
 * is comparable across languages — the ids are `libtmux.pane.Pane.capture_pane`,
 * `libtmux::Server::wait_for` and `Server.buffers()`, which share no grammar.
 *
 * Name matching is a heuristic and will miss a port that renamed the concept.
 * It is honest about that by returning what it found rather than asserting
 * completeness; a curated mapping can override it per symbol later.
 */
export function sameNameInOtherPorts(
  name: string,
  version: string,
  excludePort: string,
): Array<Pick<SymbolRow, 'port' | 'id' | 'public_id' | 'kind' | 'summary'>> {
  return rows<Pick<SymbolRow, 'port' | 'id' | 'public_id' | 'kind' | 'summary'>>(
    connect().statements.acrossPorts,
    name,
    version,
    excludePort,
  )
}

/**
 * The prose that mentions a symbol.
 *
 * The backlink a reference page shows: "discussed in Traversal, and in
 * Server, session, window, pane". Asked once per rendered symbol, which is
 * why it is an index seek rather than a scan over every prose page.
 */
export function mentionedIn(port: string, symbolId: string): MentionRow[] {
  return rows<MentionRow>(connect().statements.mentionsOfSymbol, port, symbolId)
}

/** Everything one prose page mentions, for a "what this page covers" list. */
export function mentionsOn(page: string): MentionRow[] {
  return rows<MentionRow>(connect().statements.mentionsOnPage, page)
}

/**
 * The concept a symbol implements, if it is part of the map.
 *
 * This is the question a reference page asks once per rendered symbol, which
 * is why it is a seek rather than a scan over every concept's bindings.
 */
export function conceptOf(
  port: string,
  symbolId: string,
): { concept: string; label: string } | undefined {
  return row<{ concept: string; label: string }>(connect().statements.conceptOfSymbol, port, symbolId)
}

/**
 * What every port calls one concept, including the ports that lack it.
 *
 * An absent port comes back with `symbol_id` null and a reason. "No direct
 * equivalent, and here is why" is a real answer to "how do I do this here",
 * and better than an omission the reader has to interpret.
 */
export function bindingsOf(concept: string): ConceptBindingRow[] {
  return rows<ConceptBindingRow>(connect().statements.bindingsOfConcept, concept)
}

/** Provenance for one build target: revision, extractor, symbol count. */
export function extractionOf(port: string, version: string): ExtractionRow | undefined {
  return row<ExtractionRow>(connect().statements.extraction, port, version)
}

/** Every extraction in the store, for the status page and for tests. */
export function allExtractions(): ExtractionRow[] {
  return rows<ExtractionRow>(connect().statements.extractions)
}

export type { SeedOptions, SeedResult } from './seed'
export { DB_PATH } from './paths'
