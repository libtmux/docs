import { expect, it } from 'vitest'
import { abbreviateQualifiedName } from '../src/lib/qualified-name'

/** One unit per character, so the cases read as column counts. */
const cells = (text: string) => Array.from(text).length
const cut = (name: string, width: number, peers: string[] = []) => abbreviateQualifiedName(name, width, cells, peers).text

it('cuts a qualified name at its separators and keeps the right end, the owner when there is room', () => {
  const repository = 'com.acme.billing.internal.repository.InvoiceRepository'
  expect(cut(repository, 60)).toBe(repository)
  expect(cut(repository, 38)).toBe('com.acme…repository.InvoiceRepository')
  expect(cut(repository, 29)).toBe('…repository.InvoiceRepository')
  expect(cut(repository, 22)).toBe('…InvoiceRepository')
  expect(cut('com.acme.orders.impl.Parser', 21)).toBe('com.acme…impl.Parser')
})

it('prefers the form that tells a name apart from its peers', () => {
  expect(cut('com.acme.orders.impl.Parser', 21, ['com.acme.payments.impl.Parser'])).toBe('…orders.impl.Parser')
  expect(cut('io.github.libtmux.kotlin.Pane.capture', 22, ['io.github.libtmux.scaladsl.Pane.capture'])).toBe('…kotlin.Pane.capture')
})

it('keeps each language\'s separators, brackets, backticks and arity whole', () => {
  expect(cut('libtmux::Pane::capture', 16)).toBe('…Pane::capture')
  expect(cut('tmux_pane:capture/2', 12)).toBe('…capture/2')
  expect(cut('com.`my.package`.api.Thing', 16)).toBe('…api.Thing')
  expect(cut('Server.capture(_:includingHistory:)', 30)).toBe('…capture(_:includingHistory:)')
})

it('drops a call\'s arguments before its owner, and the owner before the name', () => {
  expect(cut('Server.capture(_:includingHistory:)', 24)).toBe('Server.capture(…)')
  expect(cut('Server.capture(_:includingHistory:)', 14)).toBe('…capture(…)')
})
