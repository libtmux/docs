import { describe, expect, it } from 'vitest'
import { pageIdentity, judgeLabel } from '../../scripts/lib/api-identities.mjs'
import { languageProblem } from '../../scripts/lib/api-links.mjs'
import { apiHostOf } from '../../scripts/lib/api-destinations.mjs'
import { readPage } from '../../scripts/lib/api-html.mjs'

describe('native Perl POD destinations', () => {
  it.each([
    ['https://metacpan.org/pod/Future', 'Future'],
    ['https://metacpan.org/pod/IO::Async::Loop', 'IO::Async::Loop'],
    ['https://perldoc.perl.org/5.44.0/JSON::PP', 'JSON::PP'],
  ])('reads %s from its NAME declaration', (url, module) => {
    const page = readPage(`<title>Perl documentation</title><h1 id="NAME"><a href="#NAME">#</a>NAME</h1><p><code>${module}</code> - module description</p>`)
    const identity = pageIdentity(url, page)
    expect(apiHostOf(url)).toBe(new URL(url).hostname)
    expect(languageProblem('perl', url)).toBeUndefined()
    expect(identity).toMatchObject({ via: 'pod', kind: 'module', path: module.split('::') })
    expect(judgeLabel(module, identity)).toBeUndefined()
    expect(judgeLabel('Wrong::Module', identity)).toMatchObject({ failure: 'label' })
  })

  it('rejects a search or challenge page and never infers identity from its URL', () => {
    const url = 'https://metacpan.org/pod/Future'
    expect(pageIdentity(url, readPage('<title>Client Challenge</title><h1>Client Challenge</h1>')))
      .toMatchObject({ kind: 'other', path: [] })
    const wrong = pageIdentity(url, readPage('<h1 id="NAME">NAME</h1><p>IO::Async - framework</p>'))
    expect(judgeLabel('Future', wrong)).toMatchObject({ failure: 'label' })
    expect(languageProblem('perl', 'https://docs.python.org/3/library/asyncio.html')).toMatchObject({ failure: 'language' })
  })
})
