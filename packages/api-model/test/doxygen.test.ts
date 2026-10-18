import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tokenizeDoc } from '../src/doc/roles.ts'
import { extractDoxygen, normalizeCppTemplateSpacing } from '../src/languages/doxygen.ts'

function extractCompound(xml: string) {
  const dir = mkdtempSync(join(tmpdir(), 'libtmux-api-doxygen-'))
  try {
    writeFileSync(join(dir, 'class.xml'), `<doxygen>${xml}</doxygen>`)
    return extractDoxygen(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('Doxygen C++ template spacing', () => {
  it.each([
    ['expected< std::vector< Session >, CommandFailure >', 'expected<std::vector<Session>, CommandFailure>'],
    ['std::less< >', 'std::less<>'],
    ['template < typename T >\nstd::array< int, (8 >> 1) >', 'template <typename T>\nstd::array<int, (8 >> 1)>'],
    ['std::array< int, (a < b ? 1 : 2) >', 'std::array<int, (a < b ? 1 : 2)>'],
    ['std::array< char, sizeof(R"tag(< x > )tag") >', 'std::array<char, sizeof(R"tag(< x > )tag")>'],
    ['T< /* < preserve > */ U >', 'T</* < preserve > */ U>'],
    ['T< "😀 < text > " >', 'T<"😀 < text > ">'],
  ])('removes only template padding in %s', (input, expected) => {
    expect(normalizeCppTemplateSpacing(input)).toBe(expected)
    expect(normalizeCppTemplateSpacing(expected)).toBe(expected)
  })

  it.each([
    'bool operator < (const Value & other) const;',
    'std::ostream & operator << (std::ostream & out, const Value & value);',
    'bool operator > (const Value & other) const;',
    'auto operator <=> (const Value & other) const = default;',
    'bool valid() requires (a < b && c > d && x <= y && z >= w);',
    'int shifted(int value = (8 >> 1), int mask = (1 << 2));',
    'const char * text(const char * value = " < keep  > ");',
    'T<\n  U\n> multiline();',
  ])('preserves native operators, literals and newlines in %s', (input) => {
    expect(normalizeCppTemplateSpacing(input)).toBe(input)
  })

  it('normalizes declaration, return, parameter, default, alias, field and base types together', () => {
    const symbols = extractCompound(`<compounddef kind="struct"><compoundname>sample::Value</compoundname>
      <basecompoundref prot="public">Base&lt; int &gt;</basecompoundref><sectiondef>
      <memberdef kind="function" prot="public"><type>std::vector&lt; int &gt;</type>
        <definition>std::vector&lt; int &gt; sample::Value::read</definition><qualifiedname>sample::Value::read</qualifiedname><name>read</name>
        <argsstring>(std::optional&lt; int &gt; value = std::optional&lt; int &gt;{}) const</argsstring>
        <param><type>std::optional&lt; int &gt;</type><declname>value</declname><defval>std::optional&lt; int &gt;{}</defval></param>
      </memberdef>
      <memberdef kind="variable" prot="public"><type>std::optional&lt; std::size_t &gt;</type><name>limit</name></memberdef>
      <memberdef kind="typedef" prot="public"><type>std::vector&lt; int &gt;</type><name>Values</name></memberdef>
    </sectiondef><location file="value.hpp" line="1"/></compounddef>`)
    expect(symbols.find((symbol) => symbol.name === 'Value')?.extends).toEqual(['Base<int>'])
    expect(symbols.find((symbol) => symbol.name === 'read')?.signatures[0]).toMatchObject({
      raw: 'std::vector<int> read(std::optional<int> value = std::optional<int>{}) const;',
      returns: 'std::vector<int>', params: [{ name: 'value', type: 'std::optional<int>', default: 'std::optional<int>{}' }],
    })
    expect(symbols.find((symbol) => symbol.name === 'limit')?.type).toBe('std::optional<std::size_t>')
    expect(symbols.find((symbol) => symbol.name === 'Values')?.type).toBe('std::vector<int>')
  })
})

describe('Doxygen public inheritance', () => {
  it('keeps native C++ overload spelling, defaulting, explicit conversion and trailing qualifiers', () => {
    const symbols = extractCompound(`<compounddef kind="struct"><compoundname>sample::Arguments</compoundname><sectiondef>
      <memberdef kind="function" prot="public"><type/><definition>sample::Arguments::Arguments</definition><qualifiedname>sample::Arguments::Arguments</qualifiedname><name>Arguments</name><argsstring>()=default</argsstring></memberdef>
      <memberdef kind="function" prot="public" explicit="yes"><type/><definition>sample::Arguments::Arguments</definition><qualifiedname>sample::Arguments::Arguments</qualifiedname><name>Arguments</name><argsstring>(FlatArguments values)</argsstring><param><type>FlatArguments</type><declname>values</declname></param></memberdef>
      <memberdef kind="function" prot="public"><type>const Value &amp;</type><definition>const Value &amp; sample::Arguments::get</definition><qualifiedname>sample::Arguments::get</qualifiedname><name>get</name><argsstring>() const &amp; noexcept</argsstring></memberdef>
    </sectiondef><location file="arguments.hpp" line="1"/></compounddef>`)
    expect(symbols.find((symbol) => symbol.name === 'Arguments' && symbol.kind === 'method')?.signatures.map((signature) => signature.raw)).toEqual([
      'Arguments()=default;', 'explicit Arguments(FlatArguments values);',
    ])
    expect(symbols.find((symbol) => symbol.name === 'get')?.signatures[0].raw).toBe('const Value & get() const & noexcept;')
  })

  it('preserves template constraints and nodiscard in C++ declarations', () => {
    const symbols = extractCompound(`<compounddef kind="struct"><compoundname>sample::Value</compoundname><sectiondef>
      <memberdef kind="function" prot="public">
        <templateparamlist><param><type>std::integral</type><declname>Integer</declname></param></templateparamlist>
        <type></type><definition>sample::Value::Value</definition><qualifiedname>sample::Value::Value</qualifiedname><name>Value</name><argsstring>(Integer item)</argsstring>
        <param><type>Integer</type><declname>item</declname></param>
        <requiresclause>(!std::same_as&lt;std::remove_cv_t&lt;Integer&gt;, bool&gt;)</requiresclause>
      </memberdef>
      <memberdef kind="function" prot="public" nodiscard="yes"><type>bool</type><definition>bool sample::Value::cancelled</definition><qualifiedname>sample::Value::cancelled</qualifiedname><name>cancelled</name><argsstring>() const noexcept</argsstring></memberdef>
      <memberdef kind="function" prot="public"><type>bool</type><definition>bool sample::Value::valid</definition><qualifiedname>sample::Value::valid</qualifiedname><name>valid</name><argsstring>() const</argsstring><requiresclause>Enabled&lt;T&gt;</requiresclause></memberdef>
    </sectiondef><location file="value.hpp" line="1"/></compounddef>`)
    expect(symbols.find((symbol) => symbol.kind === 'method' && symbol.name === 'Value')?.signatures[0].raw).toBe('template <std::integral Integer>\nrequires (!std::same_as<std::remove_cv_t<Integer>, bool>)\nValue(Integer item);')
    expect(symbols.find((symbol) => symbol.kind === 'method' && symbol.name === 'Value')?.signatures[0]).toMatchObject({ typeParams: ['std::integral Integer'], params: [{ name: 'item', type: 'Integer' }], returns: undefined })
    expect(symbols.find((symbol) => symbol.kind === 'method' && symbol.name === 'Value')?.signatures[0].params).toHaveLength(1)
    expect(symbols.find((symbol) => symbol.name === 'cancelled')?.signatures[0].raw).toBe('[[nodiscard]] bool cancelled() const noexcept;')
    expect(symbols.find((symbol) => symbol.name === 'valid')?.signatures[0].raw).toBe('bool valid() const requires Enabled<T>;')
  })

  it('keeps public bases without exposing private or protected implementation bases', () => {
    const symbols = extractCompound(`
      <compounddef kind="class">
        <compoundname>libtmux::Pane</compoundname>
        <basecompoundref prot="private" virt="non-virtual">libtmux::Row</basecompoundref>
        <basecompoundref prot="public" virt="virtual">libtmux::Readable</basecompoundref>
        <basecompoundref prot="protected" virt="non-virtual">libtmux::State</basecompoundref>
        <basecompoundref prot="public" virt="non-virtual">std::formatter&lt;std::string&gt;</basecompoundref>
        <location file="include/libtmux/pane.hpp" line="12"/>
      </compounddef>`)

    expect(symbols).toHaveLength(1)
    expect(symbols[0]).toMatchObject({
      id: 'libtmux::Pane',
      publicId: 'libtmux::Pane',
      extends: ['libtmux::Readable', 'std::formatter<std::string>'],
      source: { file: 'include/libtmux/pane.hpp', line: 12 },
    })
  })

  it('retains a public member even when its implementation base is private', () => {
    const symbols = extractCompound(`
      <compounddef kind="class">
        <compoundname>libtmux::Pane</compoundname>
        <basecompoundref prot="private" virt="non-virtual">libtmux::Row</basecompoundref>
        <sectiondef kind="public-func">
          <memberdef kind="function" prot="public">
            <type>const Server &amp;</type>
            <name>server</name>
            <location file="include/libtmux/row.hpp" line="42"/>
          </memberdef>
        </sectiondef>
        <location file="include/libtmux/pane.hpp" line="12"/>
      </compounddef>`)

    expect(symbols[0].extends).toBeUndefined()
    expect(symbols[1]).toMatchObject({
      id: 'libtmux::Pane::server',
      parent: 'libtmux::Pane',
      kind: 'method',
      signatures: [{ params: [], returns: 'const Server &' }],
    })
  })
})

describe('Doxygen C declarations', () => {
  function extractC(...compounds: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-api-doxygen-c-'))
    try {
      compounds.forEach((xml, i) => writeFileSync(join(dir, `${i}.xml`), `<doxygen>${xml}</doxygen>`))
      return extractDoxygen(dir, '', { language: 'c' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('deduplicates external prototypes and definitions without inventing overloads', () => {
    const symbols = extractC(`
      <compounddef id="tmux_8h" kind="file"><compoundname>tmux.h</compoundname>
        <sectiondef><memberdef kind="function" id="decl" prot="public" static="no">
          <type>int</type><definition>int server_start</definition><argsstring>(int)</argsstring>
          <name>server_start</name><param><type>int</type><defname>flags</defname></param>
          <location file="tmux.h" line="10" bodyfile="server.c" bodystart="30" declline="10"/>
        </memberdef></sectiondef></compounddef>`, `
      <compounddef id="server_8c" kind="file"><compoundname>server.c</compoundname>
        <sectiondef><memberdef kind="function" id="def" prot="public" static="no">
          <type>int</type><definition>int server_start</definition><argsstring>(int flags)</argsstring>
          <name>server_start</name><param><type>int</type><declname>flags</declname></param>
          <location file="server.c" line="30" bodyfile="server.c" bodystart="30" declline="10"/>
        </memberdef></sectiondef></compounddef>`)
    expect(symbols).toHaveLength(1)
    expect(symbols[0]).toMatchObject({ id: 'c:function:server_start', qualifiedName: 'server_start', namespace: '',
      kind: 'function', modifiers: [], source: { file: 'server.c', line: 30 },
      signatures: [{ raw: 'int server_start(int flags)', params: [{ name: 'flags', type: 'int' }], returns: 'int' }] })
  })

  it('uses a same-file callback definition line without promoting extern declarations', () => {
    const symbols = extractC(`
      <compounddef id="header" kind="file"><compoundname>tmux.h</compoundname><sectiondef>
        <memberdef kind="typedef" id="callback" prot="public"><type>enum cmd_retval(*)</type>
          <name>cmdq_cb</name><argsstring>(struct cmdq_item *, void *)</argsstring>
          <location file="tmux.h" line="1736" bodyfile="tmux.h" bodystart="1928" bodyend="-1"/>
        </memberdef>
        <memberdef kind="variable" id="external" prot="public" extern="yes"><type>int</type><name>count</name>
          <location file="tmux.h" line="20" bodyfile="tmux.h" bodystart="22" declline="20"/>
        </memberdef>
        <memberdef kind="function" id="prototype" prot="public"><type>int</type><name>read</name>
          <location declline="99" file="tmux.h" line="30" bodyfile="read.c" bodystart="50"/>
        </memberdef>
        <memberdef kind="typedef" id="invalid" prot="public"><type>int</type><name>number</name>
          <location file="tmux.h" line="40" bodyfile="tmux.h" bodystart="-1"/>
        </memberdef>
      </sectiondef></compounddef>`)
    expect(symbols.map((symbol) => symbol.source)).toEqual([
      { file: 'tmux.h', line: 1928 }, { file: 'tmux.h', line: 20 },
      { file: 'tmux.h', line: 30 }, { file: 'tmux.h', line: 40 },
    ])
    const definitions = extractC(`
      <compounddef id="header" kind="file"><compoundname>a.h</compoundname><sectiondef>
        <memberdef kind="variable" id="external" prot="public" extern="yes"><type>int</type><name>count</name>
          <location file="a.h" line="20" bodyfile="a.h" bodystart="20"/>
        </memberdef>
      </sectiondef></compounddef>`, `
      <compounddef id="source" kind="file"><compoundname>a.c</compoundname><sectiondef>
        <memberdef kind="variable" id="definition" prot="public"><type>int</type><name>count</name><initializer>= 1</initializer>
          <location file="a.c" line="3" bodyfile="a.c" bodystart="3"/>
        </memberdef>
      </sectiondef></compounddef>`)
    expect(definitions).toHaveLength(1)
    expect(definitions[0]).toMatchObject({ source: { file: 'a.c', line: 3 }, value: '1' })
  })

  it('uses the compound location and each function-pointer field location independently', () => {
    const symbols = extractC(`
      <compounddef id="entry" kind="struct"><compoundname>cmd_entry</compoundname><sectiondef>
        <memberdef kind="variable" id="exec" prot="public"><type>enum cmd_retval(*)</type><name>exec</name>
          <argsstring>(struct cmd *, struct cmdq_item *)</argsstring>
          <location file="tmux.h" line="1954" bodyfile="tmux.h" bodystart="1956" bodyend="-1"/>
        </memberdef>
      </sectiondef><location file="tmux.h" line="1940" bodyfile="tmux.h" bodystart="1940" bodyend="1957"/></compounddef>`)
    expect(symbols.map((symbol) => symbol.source)).toEqual([
      { file: 'tmux.h', line: 1940 }, { file: 'tmux.h', line: 1956 },
    ])
  })

  it('projects only evidenced direct calls, preserving callbacks and file-local identities', () => {
    const ref = (id: string, name: string) => `<ref refid="${id}" kindref="member">${name}</ref>`
    const row = (line: number, code: string) => `<codeline lineno="${line}"><highlight class="normal">${code}</highlight></codeline>`
    const symbols = extractC(`
      <compounddef id="a" kind="file"><compoundname>a.c</compoundname><sectiondef>
        <memberdef kind="function" id="tick-a" prot="public" static="yes"><type>int</type><name>tick</name>
          <location file="a.c" line="2" bodyfile="a.c" bodystart="2" bodyend="5"/></memberdef>
        <memberdef kind="function" id="worker" prot="public"><type>int</type><name>worker</name>
          <references refid="tick-a">tick</references><references refid="worker">worker</references>
          <location file="a.c" line="10" bodyfile="a.c" bodystart="10" bodyend="35"/></memberdef>
        <memberdef kind="variable" id="entry" prot="public"><type>const struct cmd_entry</type><name>entry</name>
          <initializer>= { .exec = ${ref('worker', 'worker')} }</initializer><location file="a.c" line="40"/></memberdef>
        <memberdef kind="define" id="macro" prot="public"><name>WRAP</name><location file="a.c" line="1"/></memberdef>
      </sectiondef><programlisting>
        ${row(2, `${ref('tick-a', 'tick')}(void)`)}${row(3, '{')}${row(4, 'return 1;')}${row(5, '}')}
        ${row(10, `${ref('worker', 'worker')}(void)`)}${row(11, '{')}
        ${row(12, `int ${ref('tick-a', 'tick')}(void);`)}
        ${row(13, `callback = &amp;${ref('tick-a', 'tick')};`)}
        ${row(14, `register_callback(${ref('tick-a', 'tick')});`)}
        ${row(15, `${ref('tick-a', 'tick')}();`)}
        ${row(16, `${ref('worker', 'worker')}();`)}
        ${row(17, `value = ${ref('tick-a', 'tick')}();`)}
        ${row(18, `return (${ref('tick-a', 'tick')}());`)}
        ${row(19, `if (${ref('tick-a', 'tick')}()) {}`)}
        ${row(20, `${ref('macro', 'WRAP')}(${ref('tick-a', 'tick')}());`)}
        ${row(21, 'WRAP(')}${row(22, `${ref('tick-a', 'tick')}());`)}
        ${row(23, `sizeof(${ref('tick-a', 'tick')}());`)}
        ${row(24, `(*${ref('tick-a', 'tick')})();`)}
        ${row(25, 'callback();')}
        <codeline lineno="26"><highlight class="comment">/* ${ref('tick-a', 'tick')}() */</highlight></codeline>
        <codeline lineno="27"><highlight class="stringliteral">"${ref('tick-a', 'tick')}()"</highlight></codeline>
        ${row(28, `${ref('tick-a', 'EXPANDED_NAME')}();`)}
        ${row(29, `${ref('external', 'external')}();`)}${row(30, `${ref('tick-a', 'tick')};`)}${row(35, '}')}
      </programlisting></compounddef>`, `
      <compounddef id="b" kind="file"><compoundname>b.c</compoundname><sectiondef>
        <memberdef kind="function" id="tick-b" prot="public" static="yes"><name>tick</name><references refid="tick-a">tick</references>
          <location file="b.c" line="2" bodyfile="b.c" bodystart="2" bodyend="5"/></memberdef>
      </sectiondef><programlisting>${row(2, `${ref('tick-b', 'tick')}(void)`)}
        ${row(3, `{ ${ref('tick-b', 'tick')}();`)}${row(4, `${ref('tick-a', 'tick')}();`)}${row(5, '}')}
      </programlisting></compounddef>`)
    const worker = symbols.find((symbol) => symbol.id === 'c:function:worker')!
    expect(worker.references?.filter((edge) => edge.kind === 'call')).toEqual([
      { target: 'c:function:a.c:tick', kind: 'call', sites: [15, 17, 18, 19].map((line) => ({ file: 'a.c', line })) },
      { target: 'c:function:worker', kind: 'call', sites: [{ file: 'a.c', line: 16 }] },
    ])
    expect(worker.references).toContainEqual({ target: 'c:function:a.c:tick', kind: 'reference' })
    expect(symbols.find((symbol) => symbol.id === 'c:variable:entry')?.references).toEqual([
      { target: 'c:function:worker', kind: 'reference' },
    ])
    expect(symbols.find((symbol) => symbol.id === 'c:function:b.c:tick')?.references).toEqual([
      { target: 'c:function:b.c:tick', kind: 'call', sites: [{ file: 'b.c', line: 3 }] },
    ])
    expect(symbols.find((symbol) => symbol.id === 'c:function:a.c:tick')?.references).toBeUndefined()
  })

  it('omits overlapping native body lines instead of borrowing an adjacent function body', () => {
    // Doxygen 1.18 gives both definitions the same line-only body span for:
    // int a(void) { return first(); } int b(void) { return second(); }
    const symbols = extractC(`<compounddef id="a_8c" kind="file"><compoundname>a.c</compoundname><sectiondef>
      ${[['first', 1], ['second', 2], ['a', 3], ['b', 3], ['alone', 4]].map(([name, line]) => `
        <memberdef kind="function" id="${name}" prot="public"><type>int</type><name>${name}</name>
          ${name === 'a' ? '<references refid="first">first</references>' : name === 'b' ? '<references refid="second">second</references>' : ''}
          <location file="a.c" line="${line}" bodyfile="a.c" bodystart="${line}" bodyend="${line}"/>
        </memberdef>`).join('')}
      </sectiondef><programlisting>
        <codeline lineno="1"><highlight class="normal">int first(void) { return 1; }</highlight></codeline>
        <codeline lineno="2"><highlight class="normal">int second(void) { return 2; }</highlight></codeline>
        <codeline lineno="3"><highlight class="normal">int <ref refid="a">a</ref>(void) { return <ref refid="first">first</ref>(); } int <ref refid="b">b</ref>(void) { return <ref refid="second">second</ref>(); }</highlight></codeline>
        <codeline lineno="4"><highlight class="normal">int alone(void) { return <ref refid="second">second</ref>(); }</highlight></codeline>
      </programlisting></compounddef>`)
    expect(symbols.find((symbol) => symbol.name === 'a')?.references).toEqual([{ kind: 'reference', target: 'c:function:first' }])
    expect(symbols.find((symbol) => symbol.name === 'b')?.references).toEqual([{ kind: 'reference', target: 'c:function:second' }])
    expect(symbols.find((symbol) => symbol.name === 'alone')?.references).toEqual([
      { kind: 'call', target: 'c:function:second', sites: [{ file: 'a.c', line: 4 }] },
    ])
  })

  it('keeps same-named static functions in different files distinct and treats void as no parameters', () => {
    const symbols = extractC(...['a.c', 'b.c'].map((file) => `
      <compounddef id="${file}" kind="file"><compoundname>${file}</compoundname><sectiondef>
        <memberdef kind="function" id="${file}_f" prot="public" static="yes">
          <type>void</type><name>tick</name><definition>static void tick</definition><argsstring>(void)</argsstring>
          <param><type>void</type></param><location file="${file}" line="3"/>
        </memberdef></sectiondef></compounddef>`))
    expect(symbols.map((symbol) => symbol.id)).toEqual(['c:function:a.c:tick', 'c:function:b.c:tick'])
    expect(symbols.every((symbol) => symbol.signatures[0].params.length === 0)).toBe(true)
  })

  it('preserves unnamed parameter types without turning their text into argument names', () => {
    const symbols = extractC(`<compounddef id="f" kind="file"><compoundname>a.h</compoundname><sectiondef>
      <memberdef kind="function" id="f1" prot="public"><name>read</name><type>int</type>
        <param><type>struct pane *</type></param><param><type>...</type></param>
        <location file="a.h" line="3"/>
      </memberdef></sectiondef></compounddef>`)
    expect(symbols[0].signatures[0].params).toEqual([{ name: '', type: 'struct pane *', default: undefined, doc: undefined },
      { name: '', type: '...', default: undefined, doc: undefined }])
  })

  it('retains tag namespaces, nested unions, fields and native type references', () => {
    const symbols = extractC(`
      <compounddef id="record" kind="struct"><compoundname>args_value</compoundname>
        <innerclass refid="data">args_value::data</innerclass><location file="tmux.h" line="8"/>
      </compounddef>`, `
      <compounddef id="data" kind="union"><compoundname>args_value::data</compoundname><sectiondef>
        <memberdef kind="variable" id="field" prot="public"><type>char *</type><name>string</name>
          <location file="tmux.h" line="10"/></memberdef>
      </sectiondef><location file="tmux.h" line="9"/></compounddef>`, `
      <compounddef id="header" kind="file"><compoundname>tmux.h</compoundname><sectiondef>
        <memberdef kind="function" id="function" prot="public"><type>struct <ref refid="record">args_value</ref> *</type>
          <name>args_value</name><location file="tmux.h" line="20"/></memberdef>
      </sectiondef></compounddef>`)
    expect(symbols.find((symbol) => symbol.id === 'c:union:args_value::data')).toMatchObject({ kind: 'union', parent: 'c:struct:args_value' })
    expect(symbols.find((symbol) => symbol.name === 'string')).toMatchObject({ parent: 'c:union:args_value::data', kind: 'attribute' })
    expect(symbols.find((symbol) => symbol.kind === 'function')).toMatchObject({ id: 'c:function:args_value',
      imports: { args_value: 'c:struct:args_value' }, references: [{ target: 'c:struct:args_value', kind: 'type' }] })
    expect(symbols.every((symbol) => !symbol.parent || symbols.some((owner) => owner.id === symbol.parent))).toBe(true)
  })

  it('preserves initializer references without guessing a callback from the command name', () => {
    const symbols = extractC(`<compounddef id="file" kind="file"><compoundname>cmd.c</compoundname><sectiondef>
      <memberdef kind="variable" id="entry" prot="public"><type>const struct cmd_entry</type><name>cmd_clear_history_entry</name>
        <initializer>= { .name = &quot;clear-history&quot;, .exec = <ref refid="callback">cmd_capture_pane_exec</ref> }</initializer>
        <location file="cmd.c" line="10"/></memberdef>
      <memberdef kind="function" id="callback" prot="public" static="yes"><name>cmd_capture_pane_exec</name>
        <location file="cmd.c" line="20"/></memberdef>
    </sectiondef></compounddef>`)
    expect(symbols[0].value).toBe('{ .name = "clear-history", .exec = cmd_capture_pane_exec }')
    expect(symbols[0].references).toEqual([{ target: 'c:function:cmd.c:cmd_capture_pane_exec', kind: 'reference' }])
  })

  it('preserves enum values and exact references while ignoring external unresolved targets', () => {
    const symbols = extractC(`<compounddef id="file" kind="file"><compoundname>a.h</compoundname><sectiondef>
      <memberdef kind="enum" id="enum" prot="public"><name>status</name>
        <enumvalue id="ok" prot="public"><name>OK</name><initializer>= 2</initializer></enumvalue>
        <location file="a.h" line="3"/></memberdef>
      <memberdef kind="function" id="function" prot="public"><name>read</name>
        <references refid="ok">OK</references><references refid="external">malloc</references>
        <location file="a.h" line="5"/></memberdef>
    </sectiondef></compounddef>`)
    expect(symbols.find((symbol) => symbol.name === 'OK')).toMatchObject({ parent: 'c:enum:status', value: '2' })
    expect(symbols.find((symbol) => symbol.name === 'read')?.references).toEqual([{ target: 'c:enum:status::OK', kind: 'reference' }])
  })
})

describe('Doxygen C declaration spelling', () => {
  it('keeps function pointers, array extents, tag links and initializer literal bytes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-doxygen-c-spelling-'))
    try {
      writeFileSync(join(dir, 'native.xml'), `<doxygen><compounddef id="structitem" kind="struct"><compoundname>item</compoundname><sectiondef>
        <memberdef id="field" kind="variable" prot="public"><type>void(*)</type><name>callback</name><argsstring>(struct item *)</argsstring><location file="a.h" line="4"/></memberdef>
        <memberdef id="bits" kind="variable" prot="public"><type>unsigned int</type><name>flag</name><bitfield>1</bitfield><location file="a.h" line="4"/></memberdef>
        <memberdef id="array" kind="variable" prot="public"><type>char</type><name>label</name><argsstring>[32]</argsstring><initializer>= &quot;two  spaces &amp;quot;&quot;</initializer><location file="a.h" line="5"/></memberdef>
      </sectiondef><location file="a.h" line="3"/></compounddef></doxygen>`)
      writeFileSync(join(dir, 'function.xml'), `<doxygen><compounddef id="f" kind="file"><compoundname>a.c</compoundname><sectiondef>
        <memberdef id="function" kind="function" prot="public"><type>struct item *</type><name>item</name><location file="a.c" line="10"/></memberdef>
      </sectiondef></compounddef></doxygen>`)
      const symbols = extractDoxygen(dir, '', { language: 'c' })
      expect(symbols.find((symbol) => symbol.name === 'callback')).toMatchObject({ qualifiedName: 'item.callback', signatures: [{ raw: 'void(*callback)(struct item *);', params: [] }] })
      expect(symbols.find((symbol) => symbol.name === 'flag')?.signatures[0].raw).toBe('unsigned int flag : 1;')
      expect(symbols.find((symbol) => symbol.name === 'label')).toMatchObject({ signatures: [{ raw: 'char label[32] = "two  spaces &quot;";', params: [] }], value: '"two  spaces &quot;"' })
      expect(symbols.find((symbol) => symbol.kind === 'function')).toMatchObject({ imports: { item: 'c:struct:item' }, references: [{ kind: 'type', target: 'c:struct:item' }] })
      expect(symbols.find((symbol) => symbol.kind === 'struct')?.signatures[0].raw).toBe('struct item;')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Doxygen C macro identity', () => {
  it('keeps macros distinct from enum values and native callable symbols', () => {
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-doxygen-macro-'))
    try {
      writeFileSync(join(dir, 'a.xml'), `<doxygen><compounddef id="a" kind="file"><compoundname>a.h</compoundname><sectiondef>
        <memberdef id="macro" kind="define" prot="public"><name>CHECK</name><param><defname>x</defname></param><initializer>((x) != 0)</initializer><location file="a.h" line="3"/></memberdef>
      </sectiondef></compounddef></doxygen>`)
      expect(extractDoxygen(dir, '', { language: 'c' })).toMatchObject([{ id: 'c:define:a.h:CHECK', kind: 'constant', modifiers: ['macro'], signatures: [{ raw: '#define CHECK(x) ((x) != 0)', params: [] }] }])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Doxygen anonymous C display', () => {
  it('keeps native identities while excluding synthetic names from source syntax', () => {
    const dir = mkdtempSync(join(tmpdir(), 'libtmux-doxygen-anonymous-'))
    try {
      writeFileSync(join(dir, 'a.xml'), `<doxygen><compounddef id="anon" kind="struct"><compoundname>client::[struct].entry</compoundname><location file="a.h" line="3"/></compounddef></doxygen>`)
      writeFileSync(join(dir, 'b.xml'), `<doxygen><compounddef id="global" kind="struct"><compoundname>[struct].table</compoundname><location file="a.h" line="4"/></compounddef></doxygen>`)
      writeFileSync(join(dir, 'c.xml'), `<doxygen><compounddef id="owner" kind="struct"><compoundname>client</compoundname><innerclass refid="anon">client::[struct].entry</innerclass><sectiondef>
        <memberdef id="field" kind="variable" prot="public"><type>struct client::@123456</type><name>entry</name><location file="a.h" line="3"/></memberdef>
      </sectiondef><location file="a.h" line="2"/></compounddef></doxygen>`)
      const symbols = extractDoxygen(dir, '', { language: 'c' })
      expect(symbols[0]).toMatchObject({ id: 'c:struct:client::[struct].entry', name: 'entry (anonymous struct)', qualifiedName: 'client.entry (anonymous struct)', signatures: [] })
      expect(symbols[1]).toMatchObject({ id: 'c:struct:[struct].table', name: 'table (anonymous struct)', signatures: [] })
      expect(symbols.find((symbol) => symbol.id === 'c:struct:client::entry')).toMatchObject({ type: 'anonymous struct', signatures: [{ raw: undefined, params: [] }] })
      expect(symbols.every((symbol) => !symbol.signatures.some((signature) => /@123456|\[struct\]/.test(signature.raw ?? '')))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('Doxygen description markup', () => {
  // The XML below is what Doxygen writes for Markdown headings, `**bold**`,
  // `*emphasis*` and `@par`: a heading's `<title>` sits directly against the
  // next `<para>`, and a skipped level leaves an empty wrapper section.
  const described = (detail: string) => extractCompound(`
    <compounddef kind="class">
      <compoundname>libtmux::Server</compoundname>
      <briefdescription><para>One tmux server.</para></briefdescription>
      <detaileddescription>${detail}</detaileddescription>
      <location file="include/libtmux/server.hpp" line="76"/>
    </compounddef>`)[0].doc!.body

  it('keeps a heading as a Markdown heading line and bold and emphasis as marks', () => {
    expect(described(`
<para>The entry point.</para>
<sect1 id="classlibtmux_1_1Server_1autotoc_md0">
<title>What is on here</title><para>A tmux server does a great many things:</para>
<para><bold>Connecting.</bold> <computeroutput>at_socket_path</computeroutput> picks a socket, and <emphasis>only</emphasis> a startable handle may create a daemon.</para>
</sect1>`)).toBe([
      'The entry point.',
      '',
      '# What is on here',
      '',
      'A tmux server does a great many things:',
      '',
      '**Connecting.** `at_socket_path` picks a socket, and *only* a startable handle may create a daemon.',
    ].join('\n'))
  })

  it('reaches the page as a bold lead-in', () => {
    const body = described('<para><bold>Connecting.</bold> <computeroutput>at_socket_path</computeroutput> picks a socket.</para>')!
    expect(tokenizeDoc(body, 'cxx')).toEqual([
      { kind: 'strong', text: 'Connecting.' },
      { kind: 'text', text: ' ' },
      { kind: 'ref', role: 'any', target: 'at_socket_path', label: 'at_socket_path' },
      { kind: 'text', text: ' picks a socket.' },
    ])
  })

  it('keeps the depth of a heading, including one that skips a level', () => {
    expect(described(`
<sect1 id="a">
<title>Setext heading</title><para>Text under it.</para>
<sect2 id="b_1s2"><sect3 id="b">
<title>Third level</title><para>Under third.</para>
</sect3></sect2>
</sect1>`)).toBe('# Setext heading\n\nText under it.\n\n### Third level\n\nUnder third.')
  })

  it('sets the title of a named paragraph apart from its text', () => {
    expect(described(`<para><simplesect kind="par"><title>Remember</title><para>Paragraph.</para>
</simplesect></para>`)).toBe('**Remember**\n\nParagraph.')
  })

  it('moves the space inside a mark outside it, where Markdown needs it', () => {
    expect(described('<para>Read <bold>this </bold>now, <emphasis> not</emphasis> later.</para>'))
      .toBe('Read **this** now, *not* later.')
  })

  it('leaves stars and hashes that are text alone', () => {
    expect(described('<para>Match <computeroutput>*.hpp</computeroutput>, 2 * 3, and issue #4.</para>'))
      .toBe('Match `*.hpp`, 2 * 3, and issue #4.')
  })

  it('applies to a member description as it does to a type', () => {
    const symbols = extractCompound(`
      <compounddef kind="class"><compoundname>libtmux::Server</compoundname><sectiondef kind="public-func">
        <memberdef kind="function" prot="public"><type>int</type><name>session</name>
          <briefdescription><para>Find a session.</para></briefdescription>
          <detaileddescription><para><bold>Note.</bold> Resolved as tmux resolves it.</para></detaileddescription>
          <location file="include/libtmux/server.hpp" line="9"/></memberdef>
      </sectiondef><location file="include/libtmux/server.hpp" line="5"/></compounddef>`)
    expect(symbols.find((symbol) => symbol.name === 'session')?.doc).toEqual({
      summary: 'Find a session.', body: '**Note.** Resolved as tmux resolves it.',
    })
  })
})
