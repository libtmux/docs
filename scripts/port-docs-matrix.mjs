#!/usr/bin/env node
/** Expand version identities into separately published library trees. */
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PORTS, PORT_BY_SLUG } from '../site/src/lib/ports.ts'

/**
 * @template {object} T
 * @param {{ include: T[] }} matrix
 * @param {string} slug
 * @param {string} repository
 */
export function publicationMatrix(matrix, slug, repository, includeWrappers = false) {
  const port = PORT_BY_SLUG[slug]
  if (!port) throw new Error(`unknown documentation port: ${slug}`)
  if (port.repo !== repository)
    throw new Error(`${repository} cannot build ${slug}; its source belongs to ${port.repo}`)
  const family = [port, ...(includeWrappers ? PORTS.filter((entry) => entry.parentLibrary?.slug === slug) : [])]
  return { include: matrix.include.flatMap((version) => family.map((member) => ({ ...version, port: member.slug }))) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const matrix = publicationMatrix(
    JSON.parse(process.env.IDENTITY_MATRIX),
    process.env.PORT,
    process.env.CALLER_REPOSITORY,
    process.env.INCLUDE_WRAPPERS === 'true',
  )
  appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`)
  console.log(JSON.stringify(matrix, null, 2))
}
