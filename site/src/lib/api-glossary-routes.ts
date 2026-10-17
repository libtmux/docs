/** The glossary pages served beside each available API reference. */
import { symbolsForProduct } from '@libtmux/api-model'
import { API_MODELS } from './api-models.ts'
import { apiGlossary, API_GLOSSARY_PATH } from './api-glossary.ts'
import { buildLocale, DEFAULT_LOCALE } from '../i18n/locales.ts'
import { PORT_BY_SLUG, referenceUrl } from './ports.ts'
import { buildTarget } from './versions.ts'

export function glossaryPages() {
  const buildPort = process.env.LIBTMUX_DOCS_PORT
  let defaults: Record<string, string> = {}
  try { defaults = JSON.parse(process.env.LIBTMUX_DOCS_PORT_DEFAULTS || '{}') } catch { /* Local defaults use latest. */ }
  const pages: (ReturnType<typeof apiGlossary> & { version: string })[] = Object.entries(API_MODELS).filter(([port]) => !buildPort || port === buildPort).flatMap(([port, model]) => {
    const version = buildPort ? buildTarget(process.env).version : defaults[port] ?? 'latest'
    return (['core', 'mcp', 'workspace'] as const)
      .filter((product) => product === 'core' || symbolsForProduct(model, product).length)
      .map((product) => ({ ...apiGlossary(`${referenceUrl(PORT_BY_SLUG[port], version, product)}glossary/`), version }))
  })
  if (!buildPort) pages.push({ ...apiGlossary(API_GLOSSARY_PATH), version: '' })
  return pages
}

/** Product HTML and both twins share the same availability and route set. */
export function productGlossaryPaths() {
  if (buildLocale() !== DEFAULT_LOCALE) return []
  const buildPort = process.env.LIBTMUX_DOCS_PORT
  return glossaryPages().flatMap(({ port, product, version }) => port && product ? [{
    params: { scope: buildPort ? product : `${port}/${version}/${product}` },
    props: { port, product, version },
  }] : [])
}
