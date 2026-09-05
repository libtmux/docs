-- The API projection: every port's symbols in one queryable store.
--
-- Read-only at page-render time and rebuilt from scratch on every build, so
-- there are no migrations and no drift to reconcile — src/data/api/*.json is
-- the source of truth and this is a derived index over it.
--
-- Why a database at all, when the JSON is right there: rendering one port's
-- reference means answering "what are this type's members", "what does this
-- name resolve to", and "does this symbol exist in the other seven ports"
-- thousands of times per build. Against parsed JSON each of those is a linear
-- scan over 13,753 symbols. Here each is an index seek.
--
-- Every table carries `port` and `version` as leading key columns. That is the
-- whole point of one store rather than one file per build target: a local dev
-- run holds every port and every version at once, so cross-language and
-- cross-version queries are ordinary joins rather than a fan-out over files.

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- One row per extraction. `revision` and `extractor` are properties of the
-- extraction, not of a symbol, so they live here rather than on every row.
--
-- `extractor` is worth querying, not just recording: it is what explains why
-- Swift rows carry resolved cross-references (a compiler symbol graph
-- produced them) and Go rows do not (tree-sitter cannot resolve types).
CREATE TABLE extraction (
  port       TEXT NOT NULL,
  version    TEXT NOT NULL,
  revision   TEXT,
  extractor  TEXT NOT NULL,
  symbols    INTEGER NOT NULL,
  built_at   TEXT NOT NULL,
  PRIMARY KEY (port, version)
) WITHOUT ROWID;

-- One row per documented symbol.
--
-- `id` is opaque: it is whatever the port's extractor writes, and the shapes
-- genuinely differ — `libtmux.pane.Pane.capture_pane` in Python,
-- `libtmux::Server::wait_for` in C++, `Server.buffers()` in Swift. Nothing
-- here splits or parses it. It is unique within a port, never globally, which
-- is why it is only ever a key alongside `port` and `version`.
--
-- The nested parts of the model (signatures, doc blocks, modifiers) stay as
-- JSON text. They are rendered whole and never filtered on, so decomposing
-- them into tables would buy nothing and cost a join per symbol.
CREATE TABLE symbol (
  port           TEXT NOT NULL,
  version        TEXT NOT NULL,
  id             TEXT NOT NULL,
  public_id      TEXT,
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL,
  parent         TEXT,
  inherited_from TEXT,
  type           TEXT,
  value          TEXT,
  source_file    TEXT,
  source_line    INTEGER,
  -- Denormalised out of `doc` so a listing can show a one-line summary
  -- without parsing every symbol's whole doc block.
  summary        TEXT,
  modifiers      TEXT NOT NULL DEFAULT '[]',
  signatures     TEXT NOT NULL DEFAULT '[]',
  extends        TEXT NOT NULL DEFAULT '[]',
  doc            TEXT,
  PRIMARY KEY (port, version, id),
  FOREIGN KEY (port, version) REFERENCES extraction (port, version)
) WITHOUT ROWID;

-- Members of a type, which is the query the reference makes most: once per
-- rendered page, and every page is a type.
CREATE INDEX symbol_children ON symbol (port, version, parent);

-- Anchors and permalinks resolve through `public_id` — the shortest importable
-- path — not through `id`.
CREATE INDEX symbol_public ON symbol (port, version, public_id);

-- The cross-language index, and the reason `name` is stored separately from
-- `id`. "Does `capture_pane` exist in the other seven ports" is a seek here,
-- and it deliberately does NOT lead with `port`: the whole question is which
-- ports have it.
CREATE INDEX symbol_by_name ON symbol (name, port, version);

-- Kind-filtered listing, for the per-port index pages ("all classes").
CREATE INDEX symbol_by_kind ON symbol (port, version, kind);

-- The concept map, projected.
--
-- The map itself lives in `packages/api-model/src/concepts.ts` and stays
-- there: it is hand-written, and what keeps it from rotting is
-- `concepts.test.ts` resolving every id against the extracted models, so a
-- rename upstream fails a test rather than silently dropping a link. A table
-- cannot do that, and replacing the module with one would trade the only
-- thing that makes the map trustworthy for queryability.
--
-- This is the projection, not the source. It exists so the questions a
-- reference page asks are one seek rather than a scan over every concept:
-- "is this symbol part of a concept" and "what does the reader call this in
-- their language".
CREATE TABLE concept (
  id     TEXT NOT NULL PRIMARY KEY,
  label  TEXT NOT NULL
) WITHOUT ROWID;

-- One row per (concept, port). A port that genuinely lacks the operation gets
-- a row too, with `symbol_id` null and `absent_reason` set — "no direct
-- equivalent, and here is why" is a real answer to "how do I do this here",
-- and a better one than a missing row that reads as an oversight.
CREATE TABLE concept_binding (
  concept       TEXT NOT NULL,
  port          TEXT NOT NULL,
  symbol_id     TEXT,
  absent_reason TEXT,
  PRIMARY KEY (concept, port),
  FOREIGN KEY (concept) REFERENCES concept (id)
) WITHOUT ROWID;

-- The lookup a symbol page makes: "is what I am rendering part of a concept?"
CREATE INDEX concept_binding_symbol ON concept_binding (port, symbol_id);

-- Where prose mentions a symbol.
--
-- The forward direction already works: `rehype-api-links` turns a symbol
-- named in a topic's call-shape table into a link to the reference. This is
-- the reverse — the reference page saying "this is discussed in Traversal and
-- in Server, session, window, pane" — which needs an index, because asking it
-- per rendered symbol otherwise means scanning every prose page.
--
-- Rows come from a generated `site/src/data/mentions.json`, computed before
-- the build rather than recorded during it. `Resolver.resolve` is pure, so it
-- gives the same answer with nothing rendering, and a pre-computed index has
-- one property a render-time recorder cannot: it survives a cache hit. A
-- recorder observes nothing on a fully cached build and reports that as "no
-- mentions", which is indistinguishable from a page that stopped mentioning
-- anything.
CREATE TABLE mention (
  port      TEXT NOT NULL,
  symbol_id TEXT NOT NULL,
  page      TEXT NOT NULL,
  title     TEXT,
  section   TEXT,
  PRIMARY KEY (port, symbol_id, page)
) WITHOUT ROWID;

-- The question a symbol page asks once per rendered symbol.
CREATE INDEX mention_by_symbol ON mention (port, symbol_id);

-- The reverse, for a prose page listing what it covers.
CREATE INDEX mention_by_page ON mention (page);
