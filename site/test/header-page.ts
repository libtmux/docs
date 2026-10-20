import { Window } from 'happy-dom'
import { vi } from 'vitest'
import { buildLocale } from '../src/i18n/locales'
import { loadAstroTemplate, renderAstroTemplate } from './astro-templates'

/**
 * Render the real `BaseLayout` and `NativeShell` headers, pickers and icons,
 * with their sibling components reduced to slots, and parse the result.
 */
const real = [
  'components/SiteHeader.astro', 'components/HeaderLinks.astro', 'components/HeaderPicker.astro', 'components/icons/RegistryIcon.astro',
]
// `i18n/resolve` reads Astro content collections, which a bare vitest run cannot load.
const modules = { '../i18n/resolve': { buildLocale } }

export interface PageOptions {
  pagePath?: string
  portSlug?: string
  pageSource?: { repo: string; ref: string; path: string }
  repository?: string
}

export interface HeaderTemplates {
  baseLayout: unknown
  nativeShell: unknown
}

export async function loadHeaderTemplates(): Promise<HeaderTemplates> {
  return {
    baseLayout: await loadAstroTemplate('layouts/BaseLayout.astro', { real, modules }),
    nativeShell: await loadAstroTemplate('layouts/NativeShell.astro', {
      real,
      modules: { ...modules, '../lib/reference-page-links': { referencePageLinks: () => ({ schema: 1, indexes: {}, symbols: {} }) } },
    }),
  }
}

export async function renderPage(baseLayout: unknown, url: string, { pagePath, portSlug, pageSource, repository }: PageOptions = {}) {
  const parsed = new URL(url, 'https://libtmux.org')
  const prefix = /^(\/pr-\d+)?\/(en|ja)\//.exec(parsed.pathname)
  vi.stubEnv('LIBTMUX_DOCS_BASE', prefix?.[0] ?? '/')
  vi.stubEnv('LIBTMUX_DOCS_PORT', '')
  vi.stubEnv('LIBTMUX_DOCS_LOCALE', prefix?.[2] ?? 'en')
  return renderAstroTemplate(baseLayout, {
    url: parsed.href,
    props: {
      title: 'Documentation', pagePath, portSlug, repository, locale: prefix?.[2] ?? 'en',
      pageSource: pageSource ?? { repo: 'libtmux/docs', ref: 'main', path: 'site/src/pages/index.astro' },
    },
    slots: { default: '<main>Page content</main>' },
  })
}

export function parseHtml(html: string, url = 'https://libtmux.org/en/py/latest/') {
  const win = new Window({
    url,
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  })
  win.document.write(html)
  return win
}
