// Check the LuaCATS layouts in layout.json with the real lua-language-server.
//
//   LUA_LANGUAGE_SERVER=/path/to/bin/lua-language-server \
//     STYLUA=/path/to/stylua node validate-luals.mjs layout.json
//
// Each case puts its one-line function type and its wrapped layout in
// `---@field` annotations, continuing the wrapped text on following `---`
// lines the way libtmux-lua writes its own long annotations. The server must
// print the same type for both and report only the luadoc diagnostics the
// case lists in `warns`. Each `rejected` text must draw a luadoc diagnostic or
// read as a different type, which is why the layout breaks only at the sites
// the parser continues across lines. With STYLUA set, the recorded StyLua
// output for parameter lists is checked too; its one-parameter-per-line shape
// is the Lua formatter's convention that the layout follows.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const server = process.env.LUA_LANGUAGE_SERVER
if (!server) throw new Error('Set LUA_LANGUAGE_SERVER to the lua-language-server binary')
const [fixturePath] = process.argv.slice(2)
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const version = execFileSync(server, ['--version'], { encoding: 'utf8' }).trim()
if (version !== fixture.tools['lua-language-server']) {
  throw new Error(`Fixture was written for lua-language-server ${fixture.tools['lua-language-server']}, found ${version}`)
}

/**
 * The layout shows `name: type`; the annotation spells it `---@field name type`.
 * LuaLS prints a generic parameter as `<T>`, which it does not read back.
 */
const source = (text) => text.replace(/(?<![\w.])<([A-Za-z_]\w*)>/g, '$1')
const wrapped = (field, text) => source(text).replace(/^[^:\n]+: /, '').split('\n')
  .map((row, index) => index ? `---${row}` : `---@field ${field} ${row}`)

/** Run the checker and the documentation exporter over one annotated class. */
function run(blocks) {
  const root = mkdtempSync(join(tmpdir(), 'luacats-layout-'))
  try {
    mkdirSync(join(root, 'src'))
    mkdirSync(join(root, 'out'))
    const lines = ['---@class libtmux.Probe']
    const ranges = blocks.map((block) => { const start = lines.length; lines.push(...block); return [start, lines.length] })
    writeFileSync(join(root, 'src/probe.lua'), `${lines.join('\n')}\nlocal Probe = {}\nreturn Probe\n`)
    const common = ['--logpath', join(root, 'log'), '--metapath', join(root, 'meta')]
    // The checker exits 1 whenever it reports anything; the report is the result.
    spawnSync(server, ['--check', join(root, 'src'), '--checklevel=Hint', '--check_out_path', join(root, 'out/check.json'), ...common], { stdio: 'ignore' })
    execFileSync(server, ['--doc', join(root, 'src'), '--doc_out_path', join(root, 'out'), ...common], { stdio: 'ignore' })
    const documents = JSON.parse(readFileSync(join(root, 'out/doc.json'), 'utf8'))
    const fields = new Map(documents.find((entry) => entry.name === 'libtmux.Probe').fields.map((field) => [field.name, field.extends.view]))
    const diagnostics = Object.values(JSON.parse(readFileSync(join(root, 'out/check.json'), 'utf8'))).flat()
      .filter((item) => item.code.startsWith('luadoc')).map((item) => ({ line: item.range.start.line, code: item.code }))
    const within = (index) => [...new Set(diagnostics.filter(({ line }) => line >= ranges[index][0] && line < ranges[index][1]).map(({ code }) => code))].sort()
    return { fields, within }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

const accepted = run(fixture.cases.flatMap((entry, index) => [[`---@field flat_${index} ${source(entry.flat)}`], wrapped(`wrapped_${index}`, entry.formatted)]))
const problems = []
fixture.cases.forEach((entry, index) => {
  if (accepted.within(index * 2).length) problems.push(`${entry.id}: the one-line type draws ${accepted.within(index * 2)}`)
  const found = accepted.within(index * 2 + 1)
  if (JSON.stringify(found) !== JSON.stringify([...(entry.warns ?? [])].sort())) problems.push(`${entry.id}: diagnostics ${JSON.stringify(found)}, expected ${JSON.stringify(entry.warns ?? [])}`)
  if (accepted.fields.get(`flat_${index}`) !== accepted.fields.get(`wrapped_${index}`)) problems.push(`${entry.id}: the wrapped layout reads as a different type`)
})
for (const entry of fixture.rejected) {
  const result = run([[`---@field flat ${entry.flat}`], [`---@field wrapped ${entry.wrapped.replaceAll('\n', '\n---')}`]])
  if (!result.within(1).length && result.fields.get('flat') === result.fields.get('wrapped')) problems.push(`${entry.id}: accepted, but the layout never uses it`)
}
if (process.env.STYLUA) {
  const { config, cases } = fixture.stylua
  const root = mkdtempSync(join(tmpdir(), 'stylua-layout-'))
  try {
    const path = join(root, 'stylua.toml')
    writeFileSync(path, Object.entries(config).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n'))
    for (const entry of cases) {
      const formatted = execFileSync(process.env.STYLUA, ['--config-path', path, '-'], { input: `${entry.declaration}\n`, encoding: 'utf8' }).trimEnd()
      if (formatted !== entry.formatted) problems.push(`StyLua formats ${entry.declaration} differently`)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}
if (problems.length) throw new Error(problems.join('\n'))
console.log(`${fixture.cases.length} layouts read as their one-line types; ${fixture.rejected.length} breaks are refused (lua-language-server ${version})`)
