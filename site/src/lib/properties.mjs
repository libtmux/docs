/** Java properties syntax; INI does not share its escapes or logical lines. */
export const properties = {
  // A distinct name prevents Shiki's bundled INI alias replacing this grammar.
  name: 'java-properties',
  scopeName: 'source.properties',
  patterns: [
    { match: '^[ \\t\\f]*[#!].*$', name: 'comment.line.properties' },
    {
      begin: '^[ \\t\\f]*(?=\\S)',
      end: String.raw`(?<![\\\r\n])(?:\\\\)*(?=\r?$)`,
      endCaptures: { 0: { name: 'constant.character.escape.properties' } },
      name: 'meta.property.properties',
      contentName: 'keyword.other.properties',
      patterns: [
        { include: '#escape' },
        // Indentation on a continued key is not a key/value separator.
        { match: '^[ \\t\\f]+', name: 'punctuation.whitespace.properties' },
        {
          begin: '[ \\t\\f]*[:=][ \\t\\f]*|[ \\t\\f]+',
          beginCaptures: { 0: { name: 'punctuation.separator.key-value.properties' } },
          end: String.raw`(?<![\\\r\n])(?=(?:\\\\)*\r?$)`,
          contentName: 'string.unquoted.properties',
          patterns: [{ include: '#escape' }],
        },
      ],
    },
  ],
  repository: {
    escape: { match: '\\\\(?:u[0-9a-fA-F]{4}|.|$)', name: 'constant.character.escape.properties' },
  },
}
