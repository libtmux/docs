#!/usr/bin/env python3
"""Check source drift, native doctest semantics and incomplete-result refusal."""

from __future__ import annotations

import json
import os
from pathlib import Path
import py_compile
import subprocess
import sys
import tempfile
import unittest

from example_sources import Binding, Receipt, checked_receipt, digest, verify_rendered_blocks, verify_sphinx_pair

SCRIPTS = Path(__file__).resolve().parent


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="libtmux-source-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def source(self, name, content):
        path = self.root / name
        path.write_text(content, encoding="utf-8")
        return path

    def bind(self, *paths):
        manifest = self.source("binding.json", json.dumps(dict(schema=1, runId="unit-run", inputs={str(path.resolve()): digest(path.read_bytes()) for path in paths})))
        return Binding(manifest)

    def run_native(self, binding, *arguments, preload=None):
        receipt = self.root / "native.json"
        environment = dict(os.environ, PYTHONPATH=os.pathsep.join((str(self.root), str(SCRIPTS))), PYTHONDONTWRITEBYTECODE="1")
        optimization = ["-" + "O" * sys.flags.optimize] if sys.flags.optimize else []
        prefix = []
        if preload:
            bootstrap = self.source("preload.py", f"import importlib, runpy, sys\nimportlib.import_module({preload!r})\nsys.argv = sys.argv[1:]\nrunpy.run_path(sys.argv[0], run_name='__main__')\n")
            prefix.append(str(bootstrap))
        result = subprocess.run([sys.executable, *optimization, "-B", *prefix, str(SCRIPTS / "run_doctest_examples.py"), "--binding", str(binding.path), "--receipt", str(receipt), *map(str, arguments)],
                                env=environment, capture_output=True, text=True, timeout=10)
        return result, json.loads(receipt.read_text())

    def test_input_and_manifest_drift_fail(self):
        source = self.source("example.txt", ">>> 1 + 1\n2\n")
        binding = self.bind(source)
        source.write_text(">>> 1 + 1\n3\n")
        with self.assertRaisesRegex(ValueError, "changed after binding"):
            binding.verify()
        source.write_text(">>> 1 + 1\n2\n")
        binding.path.write_text(binding.path.read_text() + " ")
        with self.assertRaisesRegex(ValueError, "binding changed"):
            binding.verify()

    def test_partial_stale_and_reused_receipts_fail(self):
        binding = self.bind(self.source("example.txt", ">>> 1\n1\n"))
        path = self.root / "result.json"
        receipt = Receipt(path, binding, "stdlib-doctest")
        with self.assertRaisesRegex(ValueError, "incomplete"):
            checked_receipt(path, binding)
        with self.assertRaises(FileExistsError):
            Receipt(path, binding, "stdlib-doctest")
        receipt.finish(True)
        self.assertTrue(checked_receipt(path, binding)["passed"])
        value = json.loads(path.read_text())
        value["runId"] = "previous-run"
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, "previous run"):
            checked_receipt(path, binding)

    def test_native_state_flags_blankline_and_exception(self):
        source = self.source("example.txt", ">>> values = []\n>>> values.append(3)\n>>> values\n[3]\n>>> print('value 3')  # doctest: +ELLIPSIS\nvalue ...\n>>> print('first\\n\\nlast')\nfirst\n<BLANKLINE>\nlast\n>>> raise ValueError('expected')\nTraceback (most recent call last):\n...\nValueError: expected\n")
        result, receipt = self.run_native(self.bind(source), "--transcript", source, "--expected-tests", "6")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((receipt["attempted"], receipt["failed"]), (6, 0))
        self.assertIn("# doctest: +ELLIPSIS", receipt["tests"][0]["examples"][3]["source"])
        self.assertIn("<BLANKLINE>", receipt["tests"][0]["examples"][4]["want"])

    def test_module_docstrings_use_native_finder(self):
        source = self.source("native_examples.py", '\"\"\">>> values = [2]\n>>> values.append(4)\n>>> values\n[2, 4]\n\"\"\"\n\ndef add(a, b):\n    \"\"\"\n    >>> add(2, 3)\n    5\n    \"\"\"\n    return a + b\n')
        result, receipt = self.run_native(self.bind(source), "--module", "native_examples", "--expected-tests", "4")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual([test["name"] for test in receipt["tests"]], ["native_examples", "native_examples.add"])

    def test_module_docstrings_use_bound_bytes_with_cold_or_warm_cache(self):
        root = self.root
        old = '\"\"\">>> print("old")\nold\n\"\"\"\n'
        new = '\"\"\">>> print("new")\nbad\n\"\"\"\n'
        self.assertEqual(len(old), len(new))
        for mode in ("cold", "stale-cache", "current-cache"):
            with self.subTest(mode=mode):
                self.root = root / mode
                self.root.mkdir()
                source = self.source("cached_examples.py", old)
                os.utime(source, (1800000000, 1800000000))
                if mode != "cold":
                    py_compile.compile(str(source), doraise=True, optimize=sys.flags.optimize)
                if mode != "current-cache":
                    source.write_text(new)
                    os.utime(source, (1800000000, 1800000000))
                caches = {path: path.read_bytes() for path in self.root.rglob("*.pyc")}
                result, receipt = self.run_native(self.bind(source), "--module", "cached_examples", "--expected-tests", "1")
                self.assertEqual(result.returncode, 0 if mode == "current-cache" else 1, result.stderr)
                self.assertEqual(receipt["tests"][0]["examples"][0]["source"], 'print("old")\n' if mode == "current-cache" else 'print("new")\n')
                self.assertEqual(receipt["sourceImports"]["cached_examples"]["sha256"], digest(source.read_bytes()))
                self.assertEqual(caches, {path: path.read_bytes() for path in self.root.rglob("*.pyc")})

    def test_preloaded_module_cannot_certify_its_docstrings(self):
        source = self.source("loaded_examples.py", '\"\"\">>> print("old")\nold\n\"\"\"\n')
        result, receipt = self.run_native(self.bind(source), "--module", "loaded_examples", preload="loaded_examples")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(receipt["complete"])
        self.assertIn("imported before the adapter", receipt["errors"][0]["message"])

    def test_package_relative_imports_use_bound_bytes(self):
        package = self.root / "example_package"
        package.mkdir()
        initializer = self.source("example_package/__init__.py", "")
        dependency = self.source("example_package/value.py", "value = 'old'\n")
        os.utime(dependency, (1800000000, 1800000000))
        py_compile.compile(str(dependency), doraise=True, optimize=sys.flags.optimize)
        dependency.write_text("value = 'new'\n")
        os.utime(dependency, (1800000000, 1800000000))
        source = self.source("example_package/example.py", '\"\"\">>> value\n\'new\'\n\"\"\"\nfrom .value import value\n')
        result, receipt = self.run_native(self.bind(initializer, dependency, source), "--module", "example_package.example", "--expected-tests", "1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(set(receipt["sourceImports"]), {"example_package", "example_package.value", "example_package.example"})

    def test_imported_test_objects_require_their_defining_source(self):
        root = self.root
        definitions = {
            "class": ('class Example:\n    """\n    >>> print("old")\n    old\n    """\n', "objects.Example"),
            "function": ('def example():\n    """\n    >>> print("old")\n    old\n    """\n', "objects.example"),
            "wrapped-function": ('from functools import lru_cache\n@lru_cache(maxsize=None)\ndef example():\n    """\n    >>> print("old")\n    old\n    """\n', "objects.example"),
            "method": ('class Example:\n    def example(self):\n        """\n        >>> print("old")\n        old\n        """\n', "objects.Example().example"),
            "module": ('"""\n>>> print("old")\nold\n"""\n', "objects"),
            "nested-string": ('__test__ = {"text": \'>>> print("old")\\nold\\n\'}\n', "objects"),
        }
        for kind, (old, selected) in definitions.items():
            new = old.replace('print("old")', 'print("new")').replace('old\\n', 'bad\\n').replace('old\n', 'bad\n')
            self.assertEqual(len(old), len(new))
            for variant in ("unbound-cold", "unbound-stale", "bound-stale", "bound-current"):
                with self.subTest(kind=kind, variant=variant):
                    self.root = root / (kind + "-" + variant)
                    self.root.mkdir()
                    defining = self.source("objects.py", old)
                    os.utime(defining, (1800000000, 1800000000))
                    if variant != "unbound-cold":
                        py_compile.compile(str(defining), doraise=True, optimize=sys.flags.optimize)
                    if variant != "bound-current":
                        defining.write_text(new)
                        os.utime(defining, (1800000000, 1800000000))
                    facade = self.source("facade.py", f'import objects\n__test__ = {{"selected": {selected}}}\n')
                    bound = [facade, defining] if variant.startswith("bound-") else [facade]
                    result, receipt = self.run_native(self.bind(*bound), "--module", "facade", "--expected-tests", "1")
                    if variant.startswith("unbound-"):
                        self.assertNotEqual(result.returncode, 0)
                        self.assertFalse(receipt["complete"])
                        self.assertIn("Collected doctest facade.__test__.selected", receipt["errors"][0]["message"])
                        self.assertIn(str(defining), receipt["errors"][0]["message"])
                        self.assertIn("requires defining source in the binding", receipt["errors"][0]["message"])
                    else:
                        self.assertEqual(result.returncode, 0 if variant == "bound-current" else 1, result.stdout + result.stderr)
                        self.assertTrue(receipt["complete"])
                        test = next(t for t in receipt["tests"] if t["examples"])
                        self.assertEqual(test["filename"], str(facade))
                        self.assertEqual(test["definingSource"], dict(path=str(defining), sha256=digest(defining.read_bytes()), kind="test-string-container" if kind == "nested-string" else "object"))
                        self.assertEqual(receipt["sourceImports"]["objects"]["sha256"], digest(defining.read_bytes()))

    def test_native_test_dictionary_state_properties_and_aliases_remain(self):
        defining = self.source("objects.py", '''def getter(instance):
    """
    >>> print("property")
    property
    """
    return 1

def imported():
    """
    >>> print("function")
    function
    """
''')
        facade = self.source("facade.py", '''import objects

class Local:
    value = property(objects.getter)

__test__ = {
    "function": objects.imported,
    "alias": objects.imported,
    "state": ">>> values = []\\n>>> values.append(4)\\n>>> values\\n[4]\\n>>> print('two    words')  # doctest: +NORMALIZE_WHITESPACE\\ntwo words\\n",
}
''')
        native = subprocess.run([sys.executable, "-B", "-c", "import doctest, facade, json; print(json.dumps([(t.name, [(e.source, e.want, e.options) for e in t.examples]) for t in doctest.DocTestFinder().find(facade, name='facade')]))"],
                                cwd=self.root, capture_output=True, text=True, timeout=10)
        self.assertEqual(native.returncode, 0, native.stderr)
        result, receipt = self.run_native(self.bind(facade, defining), "--module", "facade", "--expected-tests", "6")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        collected = [[t["name"], [[e["source"], e["want"], e["options"]] for e in t["examples"]]] for t in receipt["tests"]]
        self.assertEqual(collected, json.loads(native.stdout))
        by_name = {t["name"]: t for t in receipt["tests"]}
        self.assertEqual(by_name["facade.Local.value"]["definingSource"]["path"], str(defining))
        self.assertEqual(by_name["facade.__test__.state"]["definingSource"]["path"], str(facade))
        self.assertEqual(by_name["facade.__test__.state"]["definingSource"]["kind"], "test-string-container")

    def test_wrappers_bind_the_docstring_object_and_copied_source(self):
        root = self.root
        own = '''from functools import wraps
def decorate(function):
    @wraps(function, assigned=("__module__", "__name__", "__qualname__"))
    def wrapper():
        """
        >>> print("old")
        old
        """
        return function()
    return wrapper
'''
        copied = 'from functools import wraps\ndef decorate(function):\n    @wraps(function)\n    def wrapper():\n        return function()\n    return wrapper\n'
        documented = 'def wrapped():\n    """\n    >>> print("old")\n    old\n    """\n    return 1\n'
        for kind in ("own", "copied"):
            for mode in ("unbound-cold", "unbound-stale", "bound-stale", "bound-current", "bound-preloaded"):
                with self.subTest(kind=kind, mode=mode):
                    self.root = root / (kind + "-" + mode)
                    self.root.mkdir()
                    base = self.source("base.py", 'def wrapped():\n    return 1\n' if kind == "own" else documented)
                    decorator = self.source("decorators.py", own if kind == "own" else copied)
                    source = decorator if kind == "own" else base
                    old = source.read_text()
                    new = old.replace('print("old")', 'print("new")').replace('old\n', 'bad\n')
                    self.assertEqual(len(old), len(new))
                    os.utime(source, (1800000000, 1800000000))
                    if mode != "unbound-cold":
                        py_compile.compile(str(source), doraise=True, optimize=sys.flags.optimize)
                    if mode != "bound-current":
                        source.write_text(new)
                        os.utime(source, (1800000000, 1800000000))
                    facade = self.source("facade.py", 'from base import wrapped\nfrom decorators import decorate\nselected = decorate(wrapped)\n__test__ = {"selected": selected, "alias": selected}\n')
                    inputs = [facade, base, decorator]
                    if mode.startswith("unbound-"):
                        inputs.remove(source)
                    caches = {p: p.read_bytes() for p in self.root.rglob("*.pyc")}
                    result, receipt = self.run_native(self.bind(*inputs), "--module", "facade", "--expected-tests", "1",
                                                      preload=source.stem if mode == "bound-preloaded" else None)
                    self.assertEqual(result.returncode, 0 if mode == "bound-current" else 1, result.stdout + result.stderr)
                    self.assertEqual(caches, {p: p.read_bytes() for p in self.root.rglob("*.pyc")})
                    if mode.startswith("unbound-") or mode == "bound-preloaded":
                        self.assertFalse(receipt["complete"])
                        self.assertIn(str(source), receipt["errors"][0]["message"])
                        self.assertIn("imported before the adapter" if mode == "bound-preloaded" else "requires defining source in the binding", receipt["errors"][0]["message"])
                    else:
                        self.assertTrue(receipt["complete"])
                        selected = [t for t in receipt["tests"] if t["examples"]]
                        self.assertEqual(len(selected), 1)
                        self.assertEqual(selected[0]["definingSource"]["path"], str(decorator))
                        self.assertEqual(selected[0]["docstringSources"], [dict(path=str(p), sha256=digest(p.read_bytes())) for p in ([decorator] if kind == "own" else [decorator, base])])
                        self.assertEqual(selected[0]["examples"][0]["source"], 'print("old")\n' if mode == "bound-current" else 'print("new")\n')
                        if mode == "bound-current":
                            native = subprocess.run([sys.executable, "-B", "-c", "import doctest, facade, json; print(json.dumps([(t.name, [(e.source, e.want, e.options) for e in t.examples]) for t in doctest.DocTestFinder().find(facade, name='facade')]))"], cwd=self.root, capture_output=True, text=True, timeout=10)
                            self.assertEqual(native.returncode, 0, native.stderr)
                            self.assertEqual([[t["name"], [[e["source"], e["want"], e["options"]] for e in t["examples"]]] for t in receipt["tests"]], json.loads(native.stdout))

    def test_c_wrapper_with_replaced_docstring_requires_identifiable_source(self):
        source = self.source("objects.py", 'from functools import lru_cache\n@lru_cache(maxsize=None)\ndef example():\n    """>>> 1\n    1\n    """\nexample.__doc__ = ">>> 2\\n2\\n"\n')
        result, receipt = self.run_native(self.bind(source), "--module", "objects")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(receipt["complete"])
        self.assertIn("Cannot identify the Python defining source", receipt["errors"][0]["message"])

    def test_unbound_module_is_not_imported(self):
        self.source("unbound.py", f"from pathlib import Path\nPath({str(self.root / 'imported')!r}).touch()\n")
        binding = self.bind(self.source("example.txt", ">>> 1\n1\n"))
        result, receipt = self.run_native(binding, "--module", "unbound")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "imported").exists())
        self.assertFalse(receipt["passed"])

    def test_wrong_expected_output_fails(self):
        source = self.source("wrong.txt", ">>> print('actual')\nwrong\n")
        result, receipt = self.run_native(self.bind(source), "--transcript", source)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(receipt["complete"])
        self.assertEqual(receipt["failed"], 1)

    def test_skipped_only_transcript_does_not_pass(self):
        source = self.source("skipped.txt", ">>> raise RuntimeError('not run')  # doctest: +SKIP\n")
        result, receipt = self.run_native(self.bind(source), "--transcript", source)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(receipt["attempted"], 0)

    def test_changed_count_fails(self):
        source = self.source("example.txt", ">>> 1\n1\n")
        result, receipt = self.run_native(self.bind(source), "--transcript", source, "--expected-tests", "2")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(receipt["errors"][0]["type"], "TestCountMismatch")

    def test_skipped_examples_do_not_count_as_execution(self):
        source = self.source("mixed.txt", ">>> print('executed')\nexecuted\n>>> raise RuntimeError('skipped')  # doctest: +SKIP\n")
        result, receipt = self.run_native(self.bind(source), "--transcript", source, "--expected-tests", "1")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(receipt["attempted"], 1)

    def test_input_mutation_during_execution_fails(self):
        source = self.source("changed.txt", ">>> from pathlib import Path\n>>> count = Path(__file__).write_text('changed')\n")
        result, receipt = self.run_native(self.bind(source), "--transcript", source)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(receipt["complete"])
        self.assertIn("changed after binding", receipt["errors"][0]["message"])

    def test_rendered_source_and_duplicate_counts(self):
        html = self.source("index.html", "<pre><span>print(&#x27;visible&#x27;)</span>\n</pre>")
        visible = dict(hidden=False, displayedText="print('visible')", line=1)
        hidden = dict(hidden=True, displayedText="hidden setup", line=2)
        verify_rendered_blocks(html, [visible, hidden])
        with self.assertRaisesRegex(ValueError, "Rendered example differs"):
            verify_rendered_blocks(html, [visible, visible])
        with self.assertRaisesRegex(ValueError, "Rendered example differs"):
            verify_rendered_blocks(html, [dict(visible, displayedText="print('changed')")])

    def test_sphinx_pair_rejects_changed_group_state(self):
        common = dict(producer="sphinx", documents={"index": {}}, testNodes={"index": []}, doctestConfiguration={"doctest_global_setup": "values = []"})
        html = dict(common, format="html", rendered={})
        executed = dict(common, builder="doctest", attempted=1, doctestConfiguration={"doctest_global_setup": "values = [1]"})
        with self.assertRaisesRegex(ValueError, "doctestConfiguration"):
            verify_sphinx_pair(html, executed)


if __name__ == "__main__":
    if sys.argv[1:] == ["--list-tests"]:
        pending = [unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])]
        names = []
        while pending:
            test = pending.pop(0)
            if isinstance(test, unittest.TestSuite):
                pending[:0] = list(test)
            else:
                names.append(test.id().removeprefix("__main__."))
        print(json.dumps(names))
    else:
        unittest.main()
