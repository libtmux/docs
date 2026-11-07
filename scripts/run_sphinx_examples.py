#!/usr/bin/env python3
"""Run the native Sphinx command and complete its bound example receipt."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from example_sources import Binding, BoundImports, Receipt, digest, require


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binding", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--expected-tests", type=int)
    parser.add_argument("sphinx", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    require(args.expected_tests is None or args.expected_tests > 0, "Expected test count must be positive")
    command = args.sphinx[1:] if args.sphinx[:1] == ["--"] else args.sphinx
    require(bool(command), "Supply the native Sphinx arguments after --")
    require(not args.receipt.exists(), "Refusing to reuse a native receipt path")
    binding = Binding(args.binding)
    selected = {"LIBTMUX_EXAMPLE_BINDING": str(binding.path), "LIBTMUX_EXAMPLE_RECEIPT": str(args.receipt.resolve())}
    previous = {name: os.environ.get(name) for name in selected}
    status = 1
    failure = None
    source_imports = {}
    try:
        os.environ.update(selected)
        with BoundImports(binding) as imports:
            from sphinx.cmd.build import build_main

            status = build_main(command)
            source_imports = imports.inventory()
    except BaseException as error:
        failure = error
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
    if not args.receipt.exists():
        receipt = Receipt(args.receipt, binding, "sphinx")
        receipt.record["nativeExitCode"] = status
        receipt.fail(failure or RuntimeError("Sphinx produced no source receipt; enable sphinx_example_binding in extensions"))
        return 1
    record = json.loads(args.receipt.read_text(encoding="utf-8"))
    require(record.get("runId") == binding.value["runId"] and record.get("bindingSha256") == binding.sha256
            and record.get("inputs") == binding.inputs and record.get("producer") == "sphinx", "Sphinx receipt belongs to different inputs")
    # The extension reserved this path before native parsing began.
    receipt = object.__new__(Receipt)
    receipt.path, receipt.binding, receipt.record = args.receipt.resolve(), binding, record
    try:
        record.update(nativeExitCode=status, nativeCommand=command, sourceImports=source_imports)
        if failure is not None:
            raise failure
        for output in record.get("rendered", {}).values():
            require(digest(Path(output["path"]).read_bytes()) == output["sha256"], "Rendered source changed before Sphinx returned")
        if args.expected_tests is not None:
            require(record.get("attempted") == args.expected_tests, "Native test count differs from the expected inventory")
        if record.get("nativeBuildFinished") is not True:
            binding.verify()
            receipt.save()
            return 1
        passed = status == 0 and record.get("nativeBuildFinished") is True and record.get("nativeSucceeded") is True and not record["errors"]
        receipt.finish(passed)
        return 0 if passed else 1
    except BaseException as error:
        receipt.fail(error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
