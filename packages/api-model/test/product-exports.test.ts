import { describe, expect, it } from 'vitest'
import { scopeProductSymbols } from '../src/product-exports.ts'
import type { ApiSymbol } from '../src/model.ts'

const declaration = (name: string, file: string, kind: ApiSymbol['kind'] = 'interface'): ApiSymbol => ({ id: name, name, kind, source: { file }, modifiers: [], signatures: [] })

describe('package export boundaries', () => {
  it('keeps an exported signature type without advertising an internal helper', () => {
    const symbols = [
      { ...declaration('createServer', '/pkg/server.ts', 'function'), signatures: [{ params: [{ name: 'options', type: 'Startup' }] }] },
      declaration('Policy', '/pkg/policy.ts'),
      declaration('Startup', '/pkg/startup.ts'),
      declaration('ImplementationContext', '/pkg/startup.ts'),
    ]
    const files: Record<string, string> = {
      '/pkg/server.ts': 'export function createServer() {}\nexport type { Policy } from "./policy.js";',
      '/pkg/policy.ts': 'export interface Policy {}',
      '/pkg/startup.ts': 'export interface Startup {}\ninterface ImplementationContext {}',
    }
    scopeProductSymbols(symbols, { port: 'ts', entries: ['/pkg/server.ts'], readSource: (file) => files[file] })
    expect(symbols.map((symbol) => symbol.apiScope)).toEqual(['exported', 'exported', 'supporting', 'internal'])
  })

  it('distinguishes a Rust re-export from a private module and a doctest marker', () => {
    const symbols = [declaration('Workspace', '/crate/config.rs'), declaration('Secret', '/crate/config.rs'), declaration('MacrosReadme', '/crate/lib.rs')]
    const files: Record<string, string> = {
      '/crate/lib.rs': 'mod config;\npub use config::{Workspace};\n#[cfg(doctest)]\npub struct MacrosReadme;',
      '/crate/config.rs': 'pub struct Workspace;\npub struct Secret;',
    }
    scopeProductSymbols(symbols, { port: 'rs', entries: ['/crate/lib.rs'], readSource: (file) => files[file] })
    expect(symbols.map((symbol) => symbol.apiScope)).toEqual(['exported', 'internal', 'internal'])
  })

  it('excludes Java package-private catalogs and Python package metadata', () => {
    const catalog = declaration('Catalog', '/Catalog.java', 'class')
    scopeProductSymbols([catalog], { port: 'java', entries: [], readSource: () => 'final class Catalog {}' })
    expect(catalog.apiScope).toBe('internal')
    const email = declaration('__email__', '/src/tmuxp/__about__.py', 'constant')
    scopeProductSymbols([email], { port: 'py', entries: [], readSource: () => '' })
    expect(email.apiScope).toBe('internal')
  })
})
