import { describe, expect, it } from 'vitest'
import { wordBreak } from '../src/lib/word-break'

describe('wordBreak', () => {
  it('breaks a Ruby name after a namespace colon, before the hash and before an underscore', () => {
    expect(wordBreak('Async::Server#list_panes')).toEqual(['Async::', 'Server', '#list', '_panes'])
    expect(wordBreak('LibTmux::Server#search_panes')).toEqual(['Lib', 'Tmux::', 'Server', '#search', '_panes'])
    expect(wordBreak('Session#list_panes')).toEqual(['Session', '#list', '_panes'])
  })

  it('keeps the other ports break points and joins back to the name', () => {
    expect(wordBreak('Server.paneFields')).toEqual(['Server', '.pane', 'Fields'])
    expect(wordBreak('init(id:index:width:)')).toEqual(['init(id:', 'index:', 'width:)'])
    expect(wordBreak('panes')).toEqual(['panes'])
    for (const name of ['Async::Server#list_panes', 'Server.paneFields', 'panes']) expect(wordBreak(name).join('')).toBe(name)
  })

  it('does not break at a trailing or leading hash', () => {
    expect(wordBreak('C#')).toEqual(['C#'])
    expect(wordBreak('#{pane_id}')).toEqual(['#{pane', '_id}'])
  })
})
