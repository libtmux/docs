import { readFileSync } from 'node:fs'
import type { Locale } from '../i18n/locales'
import type { PageSource } from './markdown-twins'

export interface NativePageContext {
  file: string
  /** Path below this native artifact's /api/ mount. */
  path: string
  url: string
  /** Page path below the locale root, for the shared locale control. */
  sourcePath: string
  source?: PageSource & { sha256: string }
  markdownHref?: string
  markdownSha256?: string
  htmlSha256: string
  articleSha256: string
  signatures: string[]
}

export interface NativeShellContext {
  schema: 1
  port: string
  version: string
  locale: Locale
  root: string
  base: string
  source: { repository: string; sha: string }
  artifactSha256: string
  pages: NativePageContext[]
  redirects: string[]
}

/** A build exports native chrome only for the artifact collected before it. */
export function nativeShellContext(): NativeShellContext | undefined {
  const file = process.env.LIBTMUX_DOCS_NATIVE_CONTEXT
  if (!file) return undefined
  const context: NativeShellContext = JSON.parse(readFileSync(file, 'utf8'))
  if (context.schema !== 1 || context.port !== process.env.LIBTMUX_DOCS_PORT ||
      context.version !== process.env.LIBTMUX_DOCS_VERSION || context.base !== `${process.env.LIBTMUX_DOCS_BASE}api/`) {
    throw new Error('Native context does not match the Astro build identity')
  }
  return context
}
