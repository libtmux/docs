#!/usr/bin/env python3
"""Run bound transcripts or module docstrings with Python's native doctest."""

from __future__ import annotations

import argparse
import doctest
import importlib
import importlib.util
import inspect
from pathlib import Path

from example_sources import Binding, BoundImports, Receipt, digest, require


class BoundDocTestFinder(doctest.DocTestFinder):
    """Keep native collection while checking each example's defining source."""

    def __init__(self, imports):
        super().__init__()
        self.imports = imports
        self.sources = {}
        self.docstring_sources = {}
        self._containing_module = None

    def _find(self, tests, obj, name, module, source_lines, globs, seen):
        previous = self._containing_module
        if inspect.ismodule(obj):
            self._containing_module = obj
        try:
            return super()._find(tests, obj, name, module, source_lines, globs, seen)
        finally:
            self._containing_module = previous

    def _get_test(self, obj, name, module, globs, source_lines):
        test = super()._get_test(obj, name, module, globs, source_lines)
        if test is None or not test.examples:
            return test
        # Native __test__ recursion keeps the facade's filename even for imports.
        source_object = self._containing_module if isinstance(obj, str) else obj
        sources = self.imports.require_docstring(source_object, f"Collected doctest {name}")
        self.sources[id(test)] = dict(sources[0], kind="test-string-container" if isinstance(obj, str) else "object")
        self.docstring_sources[id(test)] = sources
        return test


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binding", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--transcript", type=Path, action="append", default=[])
    parser.add_argument("--module", action="append", default=[])
    parser.add_argument("--expected-tests", type=int)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    require(bool(args.transcript or args.module), "Select at least one transcript or module")
    require(args.expected_tests is None or args.expected_tests > 0, "Expected test count must be positive")
    binding = Binding(args.binding)
    receipt = Receipt(args.receipt, binding, "stdlib-doctest")
    receipt.record["tests"] = []
    try:
        with BoundImports(binding) as imports:
            tests = []
            finder = BoundDocTestFinder(imports)
            for path in args.transcript:
                path = path.resolve()
                raw = binding.read(path)
                text = raw.decode("utf-8-sig").replace("\r\n", "\n").replace("\r", "\n")
                tests.append(doctest.DocTestParser().get_doctest(text, {"__name__": "__main__", "__file__": str(path)},
                                                              path.name, str(path), 0))
            for name in args.module:
                spec = importlib.util.find_spec(name)
                require(spec is not None and spec.origin is not None, f"No source module found: {name}")
                path = Path(spec.origin).resolve()
                binding.read(path)
                module = importlib.import_module(name)
                require(Path(module.__file__).resolve() == path, f"Imported module source differs: {name}")
                imports.require_source(path)
                binding.verify()
                tests.extend(finder.find(module, name=name))
            for test in tests:
                receipt.record["tests"].append(dict(name=test.name, filename=test.filename, line=test.lineno,
                    definingSource=finder.sources.get(id(test)),
                    docstringSources=finder.docstring_sources.get(id(test)),
                    examples=[dict(source=item.source, want=item.want, exception=item.exc_msg,
                                   options=item.options, line=item.lineno,
                                   sourceSha256=digest(item.source.encode("utf-8"))) for item in test.examples]))
            receipt.save()
            runner = doctest.DocTestRunner(verbose=args.verbose)
            for test in tests:
                runner.run(test)
            result = runner.summarize(verbose=args.verbose)
            # Newer Python versions include skipped examples in their attempted count.
            skipped = getattr(result, "skipped", None)
            attempted = result.attempted - (skipped or 0)
            receipt.record.update(attempted=attempted, failed=result.failed,
                                  nativeAttempted=result.attempted, nativeSkipped=skipped)
            count_matches = args.expected_tests is None or args.expected_tests == attempted
            passed = result.failed == 0 and attempted > 0 and count_matches
            if not count_matches:
                receipt.record["errors"].append(dict(type="TestCountMismatch", message=f"Expected {args.expected_tests}, executed {attempted}"))
            if attempted == 0:
                receipt.record["errors"].append(dict(type="NoTests", message="No native doctest examples executed"))
            receipt.record["sourceImports"] = imports.inventory()
            receipt.finish(passed)
            return 0 if passed else 1
    except BaseException as error:
        receipt.fail(error)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
