/**
 * The files a model's declarations cite, and the revision each is cited at.
 *
 * The source cache is written from this list (`scripts/gen-api-sources.mjs`)
 * and a build reads it back against the same list (`site/src/lib/api-source-pages.ts`),
 * so a copy of a file is shown only beside the model that cites that file at
 * that revision.
 */
import type { ApiModelBase } from './model.ts'

export const REVISION = /^[a-f0-9]{40}$/

/** A file of a repository, at the commit that cites it. */
export interface CitedFile {
  repo: string
  revision: string
  file: string
}

/** Every file a model's declarations and signatures cite, keyed by path. A path cited at two revisions or repositories throws. */
export function citedFiles(model: Pick<ApiModelBase, 'repo' | 'revision' | 'symbols'> & { port?: string }): Map<string, CitedFile> {
  const cited = new Map<string, CitedFile>()
  const collisions: string[] = []
  const add = (source?: { file?: string; repo?: string; revision?: string }) => {
    if (!source?.file) return
    const repo = source.repo ?? model.repo
    const revision = source.revision ?? model.revision
    if (!repo || !REVISION.test(revision ?? '')) return
    const known = cited.get(source.file)
    if (known && (known.repo !== repo || known.revision !== revision)) collisions.push(source.file)
    else cited.set(source.file, { repo, revision: revision!, file: source.file })
  }
  for (const symbol of model.symbols ?? []) {
    add(symbol.source)
    for (const signature of symbol.signatures ?? []) add(signature.source)
  }
  if (collisions.length) {
    throw new Error(`${model.port}: ${[...new Set(collisions)].join(', ')} cited at two revisions or repositories; a file path must name one`)
  }
  return cited
}
