import { describe, expect, it } from 'vitest'
import { API_MODELS } from '../src/lib/api-models'
import { symbolMarkdown } from '../src/lib/symbol-markdown'

describe('Java names in copied Markdown', () => {
  for (const [id, name] of [
    ['io.github.libtmux.Server.Server', 'io.github.libtmux.Server'],
    ['io.github.libtmux.Server.Server.Builder', 'io.github.libtmux.Server.Builder'],
    ['io.github.libtmux.Server.Server.sessions', 'io.github.libtmux.Server.sessions'],
  ]) {
    it(`uses the source name of ${name} and retains its existing page URL`, () => {
      const model = API_MODELS.java
      const symbol = model.symbols.find((entry) => entry.id === id)!
      expect(symbol).toBeDefined()
      const canonical = `https://libtmux.org/en/java/latest/reference/${symbol.slug}/`
      const text = symbolMarkdown({ model, symbol, canonical })
      expect(text).toMatch(new RegExp(`^# ${name.replaceAll('.', '\\.') }\\n`))
      expect(text).toContain('- **Module:** io.github.libtmux\n')
      expect(text).toContain(`- **Page:** ${canonical}\n`)
      if (symbol.signatures.length) expect(text).toContain(`${name}(`)
      expect(symbol.id).toBe(id)
    })
  }
})
