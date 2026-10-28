import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, vi } from 'vitest'
import { parameterId } from '@libtmux/api-model'
import { parameterBindingFacts, POWER_SHELL_COMMON_HELP, POWER_SHELL_COMMON_HELP_TITLE, powerShellCommonParameterHref, powerShellCommonParameterLabel } from '../src/lib/api-sections'
import { signatureSpans, typeLayout } from '../src/lib/code-layout'
import { linkTmuxDoc } from '../src/lib/tmux-links'

const astroRequire = createRequire(realpathSync(new URL('../node_modules/astro/package.json', import.meta.url)))

/**
 * The components that draw a link from a symbol's prose and types, compiled from their source and rendered as the site renders
 * them: `ApiDoc` for documentation, `ApiType` for a type, and `ApiCommandParameters` for a PowerShell command's parameters,
 * which link each common parameter to its heading on Microsoft Learn. The helpers they import are the site's own, handed in
 * through a global because a compiled component cannot import a module Vitest loads.
 */
export async function apiComponents() {
  const { transform } = await import(astroRequire.resolve('@astrojs/compiler-rs'))
  async function compile(relative: string, imports: Record<string, string> = {}) {
    const file = new URL(relative, import.meta.url)
    const source = readFileSync(file, 'utf8').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    const result = await transform(source, { filename: file.pathname, internalURL: 'astro/compiler-runtime', resultScopedSlot: true, resolvePath: (specifier: string) => specifier })
    expect(result.diagnostics.filter((item: { severity: string }) => item.severity === 'error')).toEqual([])
    let code = result.code.replaceAll('"astro/compiler-runtime"', JSON.stringify(pathToFileURL(astroRequire.resolve('astro/compiler-runtime')).href))
    for (const [specifier, url] of Object.entries(imports)) code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(url))
    return `data:text/javascript;base64,${Buffer.from(`${code}\n//# sourceURL=${file.pathname}`).toString('base64')}`
  }
  vi.stubGlobal('__apiOracleComponents', { parameterId, parameterBindingFacts, POWER_SHELL_COMMON_HELP, POWER_SHELL_COMMON_HELP_TITLE,
    powerShellCommonParameterHref, powerShellCommonParameterLabel, linkTmuxDoc, signatureSpans, typeLayout })
  const bridge = 'data:text/javascript,export const { parameterId, parameterBindingFacts, POWER_SHELL_COMMON_HELP, POWER_SHELL_COMMON_HELP_TITLE, powerShellCommonParameterHref, powerShellCommonParameterLabel, linkTmuxDoc, signatureSpans, typeLayout } = globalThis.__apiOracleComponents'
  const name = await compile('../src/components/api/SymbolName.astro', { '../../lib/word-break': new URL('../src/lib/word-break.ts', import.meta.url).href })
  const preview = await compile('../src/components/LinkPreview.astro', { '../lib/link-preview-card': new URL('../src/lib/link-preview-card.ts', import.meta.url).href })
  const keyword = await compile('../src/components/api/ApiKeyword.astro', { '../LinkPreview.astro': preview })
  const type = await compile('../src/components/api/ApiType.astro', {
    './SymbolName.astro': name, './ApiKeyword.astro': keyword,
    '@libtmux/api-model': new URL('../../packages/api-model/src/index.ts', import.meta.url).href,
    '../../lib/code-layout': bridge,
  })
  const doc = await compile('../src/components/api/ApiDoc.astro', { '../../lib/tmux-links': bridge, '../../lib/mention-badge': new URL('../src/lib/mention-badge.ts', import.meta.url).href })
  const overloads = await compile('../src/components/api/ApiFieldOverloads.astro')
  const commands = await compile('../src/components/api/ApiCommandParameters.astro', {
    '@libtmux/api-model': bridge, '../../lib/api-sections': bridge, './ApiType.astro': type, './ApiDoc.astro': doc, './ApiFieldOverloads.astro': overloads,
  })
  const members = await compile('../src/components/api/ApiScalarMembers.astro', { './ApiDoc.astro': doc, './ApiType.astro': type })
  const load = async (url: string) => (await import(/* @vite-ignore */ url)).default
  return { doc: await load(doc), type: await load(type), commands: await load(commands), members: await load(members) }
}
