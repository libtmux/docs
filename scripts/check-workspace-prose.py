#!/usr/bin/env python3
"""Run native workspace CLI examples and failure checks on a private tmux socket.

Build the CLI from the source revision cited by the pages first. This runner
checks the supplied executable; it does not establish its build provenance.
Usage: python3 scripts/check-workspace-prose.py --port go --binary /path/to/tmux-workspace
Node, tmux and the CLI runtime must be on PATH. --report saves the run results.
"""

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--port",
    choices=["ts", "rs", "go", "java", "csharp", "cxx", "swift"],
    required=True,
)
parser.add_argument("--binary", required=True, type=pathlib.Path)
parser.add_argument("--report", type=pathlib.Path)
args = parser.parse_args()
BINARY = args.binary.resolve()
NODE = shutil.which("node") or parser.error("node is required")
TMUX = shutil.which("tmux") or parser.error("tmux is required")
PAGES = [
    "cli/" + name
    for name in [
        "index",
        "convert",
        "edit",
        "freeze",
        "ls",
        "debug-info",
        "search",
        "load",
        "import",
        "import-teamocil",
        "import-tmuxinator",
        "completion",
    ]
]
if os.environ.get("TMUX_WORKSPACE_PYTHON"):
    PAGES.append("cli/shell")
CONFIGURATIONS = [
    "index",
    "session",
    "windows",
    "panes",
    "commands",
    "directories",
    "environment",
    "layouts",
    "hooks",
]
PAGES.extend("configuration/" + name for name in CONFIGURATIONS)
PAGES.extend(
    [
        "guides/discovery",
        "guides/automation",
        "guides/export-session",
        "guides/troubleshooting",
        "reference/output",
        "examples/gallery",
    ]
)
extract = """import {readFileSync} from 'node:fs';
import {resolvePortBody} from './site/src/lib/workspace-shared-slots.ts';
const pages=JSON.parse(process.argv[1]);
console.log(JSON.stringify(Object.fromEntries(pages.map(name=>[name,resolvePortBody(readFileSync('site/src/content/_workspace-shared/workspace/'+name+'.md','utf8'),process.argv[2])]))));
"""
bodies = json.loads(
    subprocess.check_output(
        [NODE, "--input-type=module", "-e", extract, json.dumps(PAGES), args.port],
        cwd=ROOT,
        text=True,
    )
)
evidence = {
    "port": args.port,
    "binary": str(BINARY),
    "entrypoint_sha256": hashlib.sha256(BINARY.read_bytes()).hexdigest(),
    "pages": {
        name: hashlib.sha256(body.encode()).hexdigest() for name, body in bodies.items()
    },
    "positive": [],
    "negative": [],
    "skipped": []
    if "cli/shell" in PAGES
    else ["shell: set TMUX_WORKSPACE_PYTHON to a compatible runtime"],
}
# Unix sockets require the Linux filesystem when running under WSL.
fixture_root = (
    pathlib.Path(tempfile.gettempdir())
    if args.port == "ts"
    else pathlib.Path(f"/tmp/libtmux-{args.port}-test")
)
fixture_root.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(
    prefix="ltx-doc-" if args.port == "ts" else "docs-", dir=fixture_root
) as directory:
    here = pathlib.Path(directory)
    socket = here / "tmux.sock"
    bindir = here / "bin"
    bindir.mkdir()
    (bindir / "tmux-workspace").symlink_to(BINARY)
    editor = bindir / "vi"
    editor.write_text(
        '#!/bin/sh\n[ -f "$1" ] || exit 42\nprintf "%s" "$1" > "$WORKSPACE_TMP/editor-argument"\n'
    )
    editor.chmod(0o755)
    configs = here / "config"
    configs.mkdir()
    doc = "session_name: workspace-guide\nwindows:\n  - window_name: editor\n    layout: even-horizontal\n    panes:\n      - printf ready\n      - printf second\n"
    (here / "workspace.yaml").write_text(doc)
    (configs / "workspace.yaml").write_text(doc)
    for body in bodies.values():
        for match in re.finditer(
            r'```(?:yaml|json) title="([\w.-]+)"\n(.*?)\n```', body, re.S
        ):
            (here / match[1]).write_text(match[2] + "\n")
    env = dict(
        os.environ,
        PATH=f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}",
        WORKSPACE_TMP=str(here),
        TMUXP_CONFIGDIR=str(configs),
        XDG_CONFIG_HOME=str(configs),
        TMUX_TMPDIR=str(here),
        SHELL="/bin/sh",
        ENV="/dev/null",
        BASH_ENV="/dev/null",
        ZDOTDIR=str(here),
    )
    env.pop("TMUX", None)
    env.pop("TMUX_PANE", None)
    env.pop("VISUAL", None)
    for name in ["DOC_SESSION", "DOC_WINDOW", "DOC_PANE"]:
        env.pop(name, None)

    def run(command, success=True):
        result = subprocess.run(
            command,
            cwd=here,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
            shell=isinstance(command, str),
        )
        if success and result.returncode:
            raise AssertionError((command, result.returncode, result.stderr[-1500:]))
        if not success and not result.returncode:
            raise AssertionError(("expected failure", command))
        return result

    try:
        run(
            [
                str(BINARY),
                "load",
                "-S",
                str(socket),
                "-f",
                "/dev/null",
                "-d",
                "--json",
                "workspace.yaml",
            ]
        )
        for name, body in bodies.items():
            for match in re.finditer(r"```console\n(.*?)\n```", body, re.S):
                command = match[1].removeprefix("$ ")
                result = run(command)
                if "--json" in command:
                    json.loads(result.stdout)
                elif "--ndjson" in command:
                    for line in result.stdout.splitlines():
                        json.loads(line)
                evidence["positive"].append(
                    {"page": name, "command": command, "exit": result.returncode}
                )
        for name in CONFIGURATIONS:
            body = bodies["configuration/" + name]
            document = re.search(r'```yaml title="([\w.-]+)"\n(.*?)\n```', body, re.S)
            assert document, name
            result = run(
                [str(BINARY), "load", "-S", str(socket), "-d", "--json", document[1]]
            )
            json.loads(result.stdout)
            evidence["positive"].append(
                {
                    "page": "configuration/" + name,
                    "document": document[1],
                    "exit": result.returncode,
                }
            )

        for document in ["gallery-blank.yaml", "gallery-commands.yaml"]:
            result = run(
                [str(BINARY), "load", "-S", str(socket), "-d", "--json", document]
            )
            json.loads(result.stdout)
            evidence["positive"].append(
                {
                    "page": "examples/gallery",
                    "document": document,
                    "exit": result.returncode,
                }
            )

        def tmux(*command):
            return run([TMUX, "-S", str(socket), *command]).stdout.strip()

        expected_panes = {
            "configuration-example": 2,
            "session-example": 1,
            "windows-example": 2,
            "panes-example": 2,
            "commands-example": 1,
            "directories-example": 1,
            "environment-example": 2,
            "layouts-example": 3,
            "hooks-example": 1,
        }
        for session, count in expected_panes.items():
            panes = tmux(
                "list-panes", "-s", "-t", "=" + session, "-F", "#{pane_id}"
            ).splitlines()
            assert len(panes) == count, (session, panes)
        session_ids = dict(
            line.split("\t")
            for line in tmux(
                "list-sessions", "-F", "#{session_name}\t#{session_id}"
            ).splitlines()
        )
        assert (
            tmux("show-options", "-v", "-t", session_ids["session-example"], "status")
            == "off"
        )
        assert (
            tmux(
                "show-window-options",
                "-v",
                "-t",
                tmux(
                    "list-windows",
                    "-t",
                    session_ids["windows-example"],
                    "-F",
                    "#{window_id}",
                ),
                "synchronize-panes",
            )
            == "on"
        )
        assert (
            tmux("list-windows", "-t", "=windows-example", "-F", "#{window_index}")
            == "2"
        )
        assert tmux(
            "list-panes", "-t", "=panes-example:work", "-F", "#{pane_active}"
        ).splitlines() == ["0", "1"]
        assert tmux(
            "display-message",
            "-p",
            "-t",
            "=directories-example:shell",
            "#{pane_current_path}",
        ) == str(here)
        environment_panes = tmux(
            "list-panes", "-t", "=environment-example:shell", "-F", "#{pane_id}"
        ).splitlines()

        def await_text(pane, expected):
            deadline = time.monotonic() + 3
            while True:
                output = tmux("capture-pane", "-p", "-t", pane)
                if expected in output:
                    return output
                if time.monotonic() >= deadline:
                    raise AssertionError((args.port, pane, expected, output))
                time.sleep(0.02)

        for pane, expected in zip(
            environment_panes, ["ENV=session||pane", "ENV=session|window|"], strict=True
        ):
            await_text(pane, expected)
        synchronized = tmux(
            "list-panes", "-t", "=windows-example:tools", "-F", "#{pane_id}"
        ).splitlines()
        assert "right" not in await_text(synchronized[0], "left")
        assert "left" not in await_text(synchronized[1], "right")
        evidence["configuration_checks"] = [
            "pane counts",
            "session options",
            "option timing",
            "window index",
            "pane focus",
            "working directory",
            "launch environment",
        ]
        assert (here / "workspace.json").is_file()
        assert (here / "captured-workspace.yaml").is_file()
        assert (here / "editor-argument").read_text().endswith("workspace.yaml")
        before = (here / "workspace.json").read_bytes()
        failed = run(
            [
                str(BINARY),
                "convert",
                "--json",
                "--workspace-format",
                "json",
                "--save-to",
                "workspace.json",
                "workspace.yaml",
            ],
            False,
        )
        assert before == (here / "workspace.json").read_bytes()
        evidence["negative"].append(
            {"case": "existing destination preserved", "exit": failed.returncode}
        )
        editor.write_text("#!/bin/sh\nexit 17\n")
        failed = run("EDITOR=vi tmux-workspace edit workspace.yaml", False)
        assert failed.returncode == 17
        evidence["negative"].append(
            {"case": "editor status propagated", "exit": failed.returncode}
        )
        failed = run([str(BINARY), "search", "--json", "["], False)
        evidence["negative"].append(
            {"case": "invalid regex fails", "exit": failed.returncode}
        )
        (here / "invalid.yaml").write_text(
            "session_name: invalid\nbogus: true\nwindows: [{window_name: shell, panes: [null]}]\n"
        )
        failed = run(
            [str(BINARY), "load", "-S", str(socket), "-d", "--json", "invalid.yaml"],
            False,
        )
        evidence["negative"].append(
            {"case": "invalid workspace fails", "exit": failed.returncode}
        )
    finally:
        if socket.exists():
            subprocess.run(
                [TMUX, "-S", str(socket), "kill-server"],
                capture_output=True,
                check=True,
            )
if args.report:
    args.report.write_text(json.dumps(evidence, indent=2) + "\n")
print(
    f"PASS: {len(evidence['positive'])} documented commands, {len(evidence['negative'])} failure checks for {args.port}"
)
for skipped in evidence["skipped"]:
    print(f"SKIPPED: {skipped}")
