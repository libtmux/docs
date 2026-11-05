import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { checkoutOf, instrumentLines, quickstartSource, withoutMarks } from './common.mjs'

export { withoutMarks }

/**
 * How Lua's quickstart is recorded: the calls to mark, what to run, and how
 * libtmux-lua's own tmux preamble is recognised.
 *
 * HAND-WRITTEN: `steps` is a person's map from the calls of the program to
 * their anchors and to a Lua expression for the value each returned. It is
 * checked against the program (every anchor must be found once and in the
 * order the marks arrive), not derived from it. A generated map would read the
 * calls from the program's syntax tree (a Lua parser: every `:await()` on a
 * method of the library) and take the value from the variable the statement
 * binds; the recorder would not change.
 */

/** The luv version the quickstart's own setup installs. */
const LUV = '1.52.1-0'

/**
 * The module the marked copy loads before the program (`LUA_INIT`). `mark`
 * runs `LIBTMUX_DOCS_MARK` with the step and the value as JSON, and stops the
 * program if that fails. `returned` is the value the last `await` gave back,
 * for a call whose result the program discards: the awaiting method of the
 * library's request is wrapped to remember it and changes nothing else.
 */
const LUA_HELPER = `local runtime = require("libtmux._internal.runtime")

local Docs = {}
local last
local patched = false

local function encode(value)
    local kind = type(value)
    if value == nil then return "null" end
    if kind == "boolean" or kind == "number" then return tostring(value) end
    if kind == "string" then
        return '"' .. value:gsub('[%c"\\\\]', function(char)
            local named = { ['"'] = '\\\\"', ["\\\\"] = "\\\\\\\\", ["\\n"] = "\\\\n", ["\\r"] = "\\\\r", ["\\t"] = "\\\\t" }
            return named[char] or string.format("\\\\u%04x", char:byte())
        end) .. '"'
    end
    assert(kind == "table", "docs mark: cannot encode a " .. kind)
    if #value > 0 or next(value) == nil then
        local items = {}
        for index, item in ipairs(value) do items[index] = encode(item) end
        return "[" .. table.concat(items, ",") .. "]"
    end
    local keys = {}
    for key in pairs(value) do keys[#keys + 1] = key end
    table.sort(keys)
    local fields = {}
    for _, key in ipairs(keys) do fields[#fields + 1] = encode(key) .. ":" .. encode(value[key]) end
    return "{" .. table.concat(fields, ",") .. "}"
end

local function quote(text)
    return "'" .. text:gsub("'", "'\\\\''") .. "'"
end

-- Tells the recorder that an API call has returned, and what it returned.
function Docs.mark(step, value)
    local command = quote(assert(os.getenv("LIBTMUX_DOCS_MARK"))) .. " " .. quote(step) .. " " .. quote(encode(value)) .. " >/dev/null"
    local ok, _, code = os.execute(command)
    if not ok then
        io.stderr:write("docs mark: ", step, " failed\\n")
        os.exit(type(code) == "number" and code or 70)
    end
end

-- The id of an entity handle the program holds.
function Docs.id(handle)
    return assert(handle:reference()).id
end

function Docs.returned() return last end

-- The first request of the run gives the class that await is looked up in.
local function watch(request)
    if patched then return end
    patched = true
    local Request = getmetatable(request).__index
    local await = Request.await
    function Request.await(self)
        local value, err = await(self)
        last = value
        return value, err
    end
end

local new = runtime.new
function runtime.new(...)
    local created, err = new(...)
    if created then
        local Runtime = getmetatable(created).__index
        local start = Runtime._start_request
        function Runtime._start_request(self, request)
            watch(request)
            return start(self, request)
        end
    end
    return created, err
end

_G.LibtmuxDocs = Docs
`

/** Insert a mark after each step's statement; the mark ends in the trailer the displayed copy is stripped by. */
export function instrumentLua(source, steps) {
  return instrumentLines(source, steps, (step) => `LibtmuxDocs.mark(${JSON.stringify(step.id)}, ${step.value}) -- docs:mark`, '--')
}

const luaBinary = () => join(execFileSync('mise', ['where', 'lua@5.5.1'], { encoding: 'utf8' }).trim(), 'bin/lua')

/** Where luv is built: beside the checkout, on disk, not in the tmpfs the sandbox lives in. */
const luvTree = (checkout) => join(dirname(checkout), 'lua-core-player-luv')

const SESSION_REFS = '{ session = LibtmuxDocs.id(created.session), window = LibtmuxDocs.id(created.window), pane = LibtmuxDocs.id(created.pane) }'

export const RECIPES = {
  'typed-graph': {
    capability: 'typed-graph',
    file: 'quickstart.lua',
    stepMap: 'hand-written',
    /** What a pane runs once it has settled: the sandbox pins SHELL to /bin/sh. */
    paneCommands: ['sh', 'cat'],
    source: (root) => quickstartSource(root, 'lua', 'quickstart.lua'),
    checkout: (port, env, expand) => checkoutOf(port, env, expand),
    /** The program makes its socket directory under `/tmp/ltx-lua-home-<six characters>`. */
    socket: { pattern: 'ltx-lua-home-[A-Za-z0-9]{6}', fixed: 'ltx-lua-home-AbC123' },
    helpers: [{ file: 'docs_mark.lua', source: LUA_HELPER }],
    // In the order the calls run. The program starts its own daemon first (its `tmux` helper), and removes it last.
    steps: [
      { id: 'daemon', label: 'tmux', anchor: 'tmux({', occurrence: 1, type: 'exit status', value: '{ status = 0 }' },
      { id: 'connect', label: 'Runtime:connect', anchor: 'runtime:connect(', type: 'Server', value: '{ binary = binary, socketPath = socket }' },
      { id: 'new-session', label: 'Server:new_session', anchor: 'server:new_session(', type: 'Creation', value: SESSION_REFS },
      { id: 'new-window', label: 'Session:new_window', anchor: 'created.session:new_window(', type: 'Creation', value: '{ window = LibtmuxDocs.id(logs.window), pane = LibtmuxDocs.id(logs.pane) }' },
      { id: 'split', label: 'Pane:split', anchor: 'logs.pane:split(', type: 'Creation', value: '{ pane = LibtmuxDocs.id(LibtmuxDocs.returned().pane) }' },
      { id: 'send-text', label: 'Pane:send_text', anchor: 'created.pane:send_text(', type: 'boolean', value: 'LibtmuxDocs.returned()' },
      { id: 'send-keys', label: 'Pane:send_keys', anchor: 'created.pane:send_keys(', type: 'boolean', value: 'LibtmuxDocs.returned()' },
      { id: 'wait-for', label: 'Server:command', anchor: 'server:command(', type: 'CommandResult', value: '{ exitCode = LibtmuxDocs.returned().exit_code, stdout = LibtmuxDocs.returned().stdout, stderr = LibtmuxDocs.returned().stderr }' },
      { id: 'capture', label: 'Pane:capture', anchor: 'created.pane:capture()', type: 'Capture', value: '{ text = (must(capture:text()):gsub("%s+$", "")) }' },
      { id: 'close', label: 'Server:close', anchor: 'server:close()', type: 'boolean', value: 'LibtmuxDocs.returned()' },
      { id: 'kill-server', label: 'tmux', anchor: 'tmux({ "kill-server" })', type: 'exit status', value: '{ status = 0 }' },
    ],
    // libtmux-lua's guard and version queries are learned from the trace.
    fence: () => false,
    /** Before each operation the library asks the daemon who it is (pid, start time, version, socket) with one `display-message`. */
    probe: ({ commands }) => commands.length > 0 && commands.every((command) => command[0] === 'display-message' && command.some((word) => /^LQ1\r\$a;#\{q:pid\}/.test(word))),
    instrument: instrumentLua,
    /**
     * The program keeps its socket under a fixed `/tmp/ltx-lua-home-XXXXXX`,
     * outside the sandbox the recorder reads tmux from, so each runs in a
     * mount namespace in which the sandbox's `tmp` is `/tmp`. The sandbox
     * itself is bound back at its own path first, so the shim, the marker and
     * the trace are where the environment says. Nothing of the host's `/tmp`
     * is touched.
     */
    command: (dir) => ['unshare', '--user', '--map-current-user', '--keep-caps', '--mount', 'sh', '-c', 'S=$1 && mkdir -p "$S/tmp/${S##*/}" && mount --bind "$S" "$S/tmp/${S##*/}" && mount --rbind "$S/tmp" /tmp && exec "$2"', 'sh', dirname(dir), join(dir, 'program')],
    toolchain: () => ({ lua: /Lua (\S+)/.exec(execFileSync(luaBinary(), ['-v'], { encoding: 'utf8' }))?.[1] ?? 'unknown', luv: LUV.replace(/-\d+$/, '') }),
    /** Write the displayed and the marked copy beside a launcher that runs them on the checkout's modules and a luv built offline. */
    build({ sandbox, checkout, code, marked, helpers }) {
      const tree = luvTree(checkout)
      const modules = join(tree, 'lib/lua/5.5/luv.so')
      if (!existsSync(modules)) {
        const luarocks = join(dirname(dirname(luaBinary())), 'luarocks/bin/luarocks')
        execFileSync(luarocks, ['--tree', tree, 'install', `luv`, LUV], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PATH: `${dirname(luaBinary())}:${process.env.PATH}` } })
      }
      for (const [dir, source] of [['exact', code], ['marked', marked]]) {
        mkdirSync(join(sandbox, dir), { recursive: true })
        writeFileSync(join(sandbox, dir, this.file), source)
        const init = dir === 'marked' ? `LUA_INIT=${JSON.stringify(`@${join(sandbox, dir, 'docs_mark.lua')}`)}\nexport LUA_INIT\n` : ''
        writeFileSync(join(sandbox, dir, 'program'), `#!/bin/sh\nLUA_PATH=${JSON.stringify(`${join(checkout, 'lua/?.lua')};${join(checkout, 'lua/?/init.lua')};;`)}\nLUA_CPATH=${JSON.stringify(`${join(tree, 'lib/lua/5.5/?.so')};;`)}\nexport LUA_PATH LUA_CPATH\n${init}exec ${JSON.stringify(luaBinary())} ${JSON.stringify(join(sandbox, dir, this.file))}\n`)
        chmodSync(join(sandbox, dir, 'program'), 0o755)
      }
      for (const helper of helpers) writeFileSync(join(sandbox, 'marked', helper.file), helper.source)
    },
  },
}
