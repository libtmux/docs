#!/usr/bin/env python3
"""Run a complete example exactly as displayed, including its setup.

Use --port to choose a language and --output-dir for a new evidence directory.
Use --example guide --page guides/<name> for a shared tmux shell program.
Use --example home --port <slug> for the homepage's complete program.
Use --example program --port <slug> --page examples/<name> for an examples page.
The selected language's native tools, Git, and tmux must already be on PATH.
This downloads and builds dependencies; it belongs outside routine site tests.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
import re
import signal
import subprocess
import time
from pathlib import Path


def select_examples(manifest, kind, port, page=None, program=None):
    """Select one complete program without combining independent setup recipes."""
    examples = [item for item in manifest["examples"] if kind == "guide" or item["port"] == port]
    if page:
        page_path = page if kind in ("guide", "home") else f"ports/{port}/{page}"
        examples = [item for item in examples if item["page"] == page_path]
    if program:
        examples = [item for item in examples if item.get("sourceProgramId") == program]
    return examples


def api_command_blocks(blocks, example):
    """Select only the console blocks recorded for one API program."""
    if "consoleBlocks" not in example:
        return [block["code"] for block in blocks if block["lang"] == "console"]
    indices = example["consoleBlocks"]
    if (
        not indices
        or len(set(indices)) != len(indices)
        or any(
            not isinstance(index, int)
            or isinstance(index, bool)
            or not 0 <= index < len(blocks)
            or blocks[index]["lang"] != "console"
            for index in indices
        )
    ):
        msg = "Invalid API console block selection"
        raise ValueError(msg)
    return [blocks[index]["code"] for index in indices]


def stop_process_group(process):
    """Stop a timed-out command and descendants, even if its shell exits first."""
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGTERM)
    with contextlib.suppress(subprocess.TimeoutExpired):
        process.wait(timeout=5)
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGKILL)
    process.wait()


def main():
    """Verify and execute one displayed program with its recorded setup."""
    repo = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--example",
        choices=["capture", "attach", "query", "concept", "guide", "api", "home", "program"],
        default="capture",
    )
    parser.add_argument("--port")
    parser.add_argument("--page", help="Guide path, or page within the selected port")
    parser.add_argument(
        "--program", help="Source program ID when an API page has several complete examples"
    )
    parser.add_argument(
        "--view",
        choices=["concise", "errors", "cleanup", "full"],
        help="Homepage detail selection (default: full)",
    )
    parser.add_argument(
        "--api-model", type=Path, help="Review model for an unpublished source revision"
    )
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--timeout",
        type=float,
        default=600,
        help="Maximum seconds per setup/run command (default: 600)",
    )
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    manifest = json.loads((repo / f"site/test/fixtures/{args.example}-examples.json").read_text())
    if args.example != "guide" and not args.port:
        parser.error("--port is required for language examples")
    if args.program and args.example != "api":
        parser.error("--program is only valid for API examples")
    if args.view and args.example != "home":
        parser.error("--view is only valid for homepage examples")
    examples = select_examples(manifest, args.example, args.port, args.page, args.program)
    if len(examples) != 1:
        choices = ", ".join(item["page"] for item in examples)
        parser.error(
            "Choose one example with --port, --page and optionally --program; "
            f"matching pages: {choices or 'none'}"
        )
    example = examples[0]
    view = args.view or "full"
    if args.example == "home" and view != "full":
        example = dict(example, **example["variants"][view])
    if args.api_model and args.example != "api":
        parser.error("--api-model is only valid for API examples")
    if args.example == "home":
        page = repo / "site/src/data/home-examples.json"
    elif args.example == "api":
        page = args.api_model or repo / "site/src/data/api" / f"{args.port}.json"
    else:
        page = repo / "site/src/content/docs" / (example["page"] + ".md")
    content = page.read_text()
    if args.example == "home":
        home = json.loads(content)[args.port]
        if (home["sourceRevision"], home["sourceTree"]) != (
            example["sourceRevision"],
            example["sourceTree"],
        ):
            msg = "Homepage source revision differs from the verification record"
            raise ValueError(msg)
        blocks = []
    elif args.example == "api":
        model = json.loads(content)
        symbols = [symbol for symbol in model["symbols"] if symbol["id"] == example["symbol"]]
        if len(symbols) != 1:
            msg = f"Expected one API symbol: {example['symbol']}"
            raise ValueError(msg)
        if symbols[0]["source"]["revision"] != example["sourceRevision"]:
            msg = "API source revision differs from the verification record"
            raise ValueError(msg)
        api_blocks = symbols[0].get("doc", {}).get("examples", [])
        blocks = []
    else:
        blocks = list(
            re.finditer(r"^```(\S+)([^\n]*)\n(.*?)^```", content, re.MULTILINE | re.DOTALL)
        )
    files = {}
    for item in example["files"]:
        name = item["name"]
        path = Path(item.get("path", name))
        if path.is_absolute() or ".." in path.parts:
            msg = f"Invalid example filename: {name}"
            raise ValueError(msg)
        if args.example == "home":
            matches = [
                home["variants"][view]
                if view != "full" and name == home["program"]
                else file["code"]
                for file in home["files"]
                if file["name"] == name
            ]
        elif args.example == "api":
            block_index = item["block"]
            matches = (
                [api_blocks[block_index]["code"]] if 0 <= block_index < len(api_blocks) else []
            )
        else:
            matches = [block[3] for block in blocks if f'title="{name}"' in block[2]]
        if len(matches) != 1:
            msg = f"Expected one displayed file: {name}"
            raise ValueError(msg)
        code = matches[0]
        if hashlib.sha256(code.encode()).hexdigest() != item["sha256"]:
            msg = f"Changed example bytes: {name}; review its verification record"
            raise ValueError(msg)
        files[str(path)] = code
    if args.example == "home":
        command_blocks = home["commands"]
    elif args.example == "api":
        command_blocks = api_command_blocks(api_blocks, example)
    else:
        command_blocks = [block[3] for block in blocks if block[1] == "console"]
    commands = [re.sub(r"^\$ ", "", code, flags=re.MULTILINE).strip() for code in command_blocks]
    if not commands or commands != example["shellRecipe"]:
        msg = "Setup commands differ from the verification record"
        raise ValueError(msg)
    expected = example.get(
        "expectedOutputs",
        [[] for _ in commands[:-1]] + [[example.get("expectedOutput", "libtmux capture ready")]],
    )
    if len(expected) != len(commands):
        msg = "Expected output must be recorded for each setup or run command"
        raise ValueError(msg)

    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=False)
    for name, code in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(code)
    env = dict(os.environ)
    env.pop("TMUX", None)
    env.pop("TMUX_PANE", None)
    sandbox = None
    if args.example in ("home", "program"):
        from example_tmux_sandbox import ExampleTmuxSandbox

        sandbox = ExampleTmuxSandbox(output, env)
    if sandbox:
        env = sandbox.env
    results = []
    try:
        for index, command in enumerate(commands):
            start = time.monotonic()
            log = output / f"run-{index + 1}.log"
            print(f"Running {example['page']}; log: {log}", flush=True)
            timed_out = False
            with log.open("w") as stream:
                process = subprocess.Popen(
                    ["sh", "-eu", "-c", command],
                    cwd=output,
                    env=env,
                    stdout=stream,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
                try:
                    exit_code = process.wait(timeout=args.timeout)
                except subprocess.TimeoutExpired:
                    timed_out = True
                    stop_process_group(process)
                    exit_code = 124
            missing = [line for line in expected[index] if line not in log.read_text().splitlines()]
            results.append(
                {
                    "command": command,
                    "exit": exit_code,
                    "timedOut": timed_out,
                    "seconds": round(time.monotonic() - start, 3),
                    "missingOutput": missing,
                }
            )
            if exit_code or missing:
                break
    finally:
        cleanup = sandbox.finish(view in ("cleanup", "full")) if sandbox else None
    passed = len(results) == len(commands) and all(
        row["exit"] == 0 and not row["missingOutput"] for row in results
    )
    report = {
        "port": example["port"],
        "page": example["page"],
        "sourceRevision": example["sourceRevision"],
        "tmuxVersion": subprocess.check_output(["tmux", "-V"], text=True).strip(),
        "pageSha256": hashlib.sha256(page.read_bytes()).hexdigest(),
        "files": example["files"],
        "runs": results,
        "passed": passed,
        "scope": "Exact displayed program and setup; native execution on this host.",
    }
    if example.get("sourceProgramId"):
        report["sourceProgramId"] = example["sourceProgramId"]
    if sandbox is not None and cleanup is not None:
        report["view"] = view
        report["cleanup"] = cleanup
        report["passed"] = passed = passed and cleanup["passed"]
    (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
