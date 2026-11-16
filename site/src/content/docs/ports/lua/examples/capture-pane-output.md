---
port: lua
route: examples/capture-pane-output
title: Capture pane output
description: Run a complete Lua program that captures output on an isolated tmux server.
sidebar:
  label: Capture pane output
  group: Examples
  order: 3
tableOfContents: true
---

This complete Lua program starts a private tmux server, sends a command,
and captures the line it prints. It includes imports, setup, and cleanup.
You need tmux 3.3a or newer and a Unix environment; no existing session is
required.

Save the program as `capture.lua` and run it after the [setup](#setup-and-run).
The library connects to a running server and does not start one, so the program
starts its own with the `tmux` command and stops it at the end.

## Read what's on screen

The leading newline puts the output on a fresh row. Matching the whole line
avoids mistaking the echoed command for its output.

```lua title="capture.lua"
local adapter = require("libtmux.runtime.luv")
local uv = require("luv")

local function must(value, err)
    if err ~= nil then error(tostring(err), 0) end
    return value
end

local function quote(text)
    return "'" .. text:gsub("'", "'\\''") .. "'"
end

local binary
for directory in (os.getenv("PATH") or ""):gmatch("[^:]+") do
    local candidate = uv.fs_realpath(directory .. "/tmux")
    if candidate and uv.fs_access(candidate, "X") then
        binary = candidate
        break
    end
end
assert(binary, "tmux must be installed on PATH")

-- A private server: a socket and an empty config of its own, so this
-- neither touches nor is changed by a tmux you already use.
local directory = assert(uv.fs_mkdtemp("/tmp/libtmux-capture-XXXXXX"))
local socket = directory .. "/tmux.sock"

local function tmux(arguments)
    local args = { "-S", socket }
    for _, argument in ipairs(arguments) do
        args[#args + 1] = argument
    end

    local timer = assert(uv.new_timer())
    local process, status
    process = assert(uv.spawn(binary, {
        args = args,
        stdio = { nil, 1, 2 },
    }, function(code)
        status = code
        process:close()
        timer:stop()
        timer:close()
    end))
    timer:start(10000, 0, function()
        process:kill("sigkill")
    end)
    uv.run()
    assert(status == 0, "tmux command failed or timed out")
end

local ok, failure = xpcall(function()
    -- This Lua API connects to an existing daemon. Start our own first,
    -- and keep it alive with no session so the program creates them all.
    tmux({
        "-f", "/dev/null", "start-server", ";",
        "set-option", "-s", "exit-empty", "off",
    })

    must(adapter.run(function(runtime)
        local server = must(runtime:connect({
            binary = binary,
            socket_path = socket,
        }):await())
        local created = must(server:new_session({
            name = "capture", argv = { "/bin/sh" },
            environment = { ENV = "/dev/null" },
        }):await())
        local pane = created.pane
        local command = "printf '\\nlibtmux capture ready\\n'; "
            .. quote(binary) .. " -S " .. quote(socket)
            .. " wait-for -S capture-ready"
        must(pane:send_text(command):await())
        must(pane:send_keys({ "Enter" }):await())
        must(server:command({ "wait-for", "capture-ready" }, {
            timeout = 5000,
        }):await())

        local capture = must(pane:capture({ history_lines = 20 }):await())
        local found = false
        for line in must(capture:text()):gmatch("[^\r\n]+") do
            if line == "libtmux capture ready" then found = true end
        end
        assert(found, "The command did not print the expected line")
        print("libtmux capture ready")
        must(server:close():await())
        return true
    end))
end, debug.traceback)

local cleaned, cleanup_error = pcall(function()
    if uv.fs_stat(socket) then tmux({ "kill-server" }) end
    local removed, _, code = uv.fs_unlink(socket)
    assert(removed or code == "ENOENT", "could not remove owned socket")
    assert(uv.fs_rmdir(directory))
end)

if not cleaned then io.stderr:write(tostring(cleanup_error), "\n") end
if not ok then error(failure, 0) end
assert(cleaned, "cleanup failed; retained " .. directory)
```

<a id="wait-for-text-instead-of-guessing-a-delay"></a>

## Wait for output or completion

The pane prints its line, then signals a tmux `wait-for` channel on the same private socket. The awaited command has a five-second deadline. Capture runs after that signal and checks the complete line. The program stops its server on success or failure; if stopping fails, it reports the error and keeps the socket directory.

Capture reads screen state and scrollback, so output that has scrolled away
may be absent. The program prints `libtmux capture ready` when its check passes
and exits unsuccessfully if an operation fails.

## Setup and run

Use an empty directory and save the program as `capture.lua`. You need
Lua 5.5, LuaRocks, a C compiler, and CMake. The commands install `libtmux`
0.1.1-1 and its luv runtime adapter from LuaRocks into a local rocks tree.

```console
$ luarocks --tree .rocks install luv 1.52.1-0 &&
  luarocks --tree .rocks install libtmux 0.1.1-1
```

Put the rocks on the module path and run the program:

```console
$ eval "$(luarocks --tree .rocks path)" &&
  lua capture.lua
```

<a id="source-inclusion"></a>

## Where this comes from

This program uses `libtmux` 0.1.1-1 from LuaRocks. Its [source](https://github.com/libtmux/libtmux-lua/tree/d68f829fe097e38dcbbf7147e276666fe615f0cf)
is on GitHub.
