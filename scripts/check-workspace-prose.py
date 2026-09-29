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

ROOT = pathlib.Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument(
    "--port",
    choices=["ts", "rs", "go", "java", "dotnet", "cxx", "swift"],
    required=True,
)
parser.add_argument("--binary", required=True, type=pathlib.Path)
parser.add_argument("--report", type=pathlib.Path)
args = parser.parse_args()
BINARY = args.binary.resolve()
NODE = shutil.which("node") or parser.error("node is required")
TMUX = shutil.which("tmux") or parser.error("tmux is required")
PAGES = ["index", "convert", "edit", "freeze", "ls", "debug-info", "search"]
extract = """import {readFileSync} from 'node:fs';
import {resolvePortBody} from './site/src/lib/workspace-shared-slots.ts';
const pages=JSON.parse(process.argv[1]);
console.log(JSON.stringify(Object.fromEntries(pages.map(name=>[name,resolvePortBody(readFileSync('site/src/content/_workspace-shared/workspace/cli/'+name+'.md','utf8'),process.argv[2])]))));
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
    env = dict(
        os.environ,
        PATH=f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}",
        WORKSPACE_TMP=str(here),
        TMUXP_CONFIGDIR=str(configs),
        XDG_CONFIG_HOME=str(configs),
        TMUX_TMPDIR=str(here),
    )
    env.pop("TMUX", None)
    env.pop("TMUX_PANE", None)
    env.pop("VISUAL", None)

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
                evidence["positive"].append(
                    {"page": name, "command": command, "exit": result.returncode}
                )
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
            "session_name: invalid\nbogus: true\nwindows: []\n"
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
