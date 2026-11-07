#!/usr/bin/env python3
"""Exercise native Sphinx examples inside the external tmux supervisor."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import py_compile
import re
import subprocess
import sys
import tempfile
import unittest

from example_sources import Binding, PreText, checked_receipt, digest, verify_sphinx_pair

SCRIPTS = Path(__file__).resolve().parent
OUTPUT: Path
TMUX: str
CONFIG = '''extensions = ["sphinx.ext.doctest", "myst_parser", "sphinx_example_binding"]
source_suffix = {".rst": "restructuredtext", ".md": "markdown"}
root_doc = "index"
project = "Native example checks"
doctest_global_setup = "global_value = 10"
doctest_global_cleanup = "assert global_value == 10"
'''
PROGRAM = '''import uuid
import libtmux

server = libtmux.Server()
with server.new_session(session_name=f"example-{uuid.uuid4().hex}") as session:
    print(len(session.windows))
'''


class SphinxTests(unittest.TestCase):
    def setUp(self):
        self.root = OUTPUT / self.id().rsplit(".", 1)[-1]
        self.root.mkdir()
        self.serial = 0
        self.commands = []

    def project(self, documents, label="project", config=CONFIG):
        root = self.root / label
        root.mkdir()
        (root / "conf.py").write_text(config)
        for name, text in documents.items():
            (root / name).write_text(text)
        import libtmux

        inputs = list(root.glob("*")) + list(Path(libtmux.__file__).parent.rglob("*.py"))
        inputs.append(SCRIPTS.parent / "notes/example-testing.md")
        inputs += [SCRIPTS / name for name in ("example_sources.py", "run_sphinx_examples.py", "sphinx_example_binding.py")]
        binding = root / "binding.json"
        binding.write_text(json.dumps(dict(schema=1, runId=f"{self.root.name}-{label}", inputs={str(p.resolve()): digest(p.read_bytes()) for p in inputs}), indent=2) + "\n")
        return root, Binding(binding)

    def run_builder(self, project, binding, builder="doctest", timeout=20, preload=None):
        self.serial += 1
        name = f"{self.serial:02}-{builder}"
        result_root = self.root / name
        receipt = self.root / (name + ".source.json")
        prefix = []
        if preload:
            bootstrap = self.root / (name + "-preload.py")
            bootstrap.write_text(f"import importlib, runpy, sys\nsys.path[:0] = [{str(project)!r}, {str(SCRIPTS)!r}]\nimportlib.import_module({preload!r})\nsys.argv = sys.argv[1:]\nrunpy.run_path(sys.argv[0], run_name='__main__')\n")
            prefix.append(str(bootstrap))
        command = [sys.executable, "-B", str(SCRIPTS / "example_environment.py"), "--output-dir", str(result_root),
                   "--tmux", TMUX, "--timeout", str(timeout), "--", sys.executable, "-B", *prefix, str(SCRIPTS / "run_sphinx_examples.py"),
                   "--binding", str(binding.path), "--receipt", str(receipt), "--", "-b", builder, "-E", "-a", "-W",
                   str(project), str(self.root / (name + "-build"))]
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout + 15)
        (self.root / (name + ".command.log")).write_text(result.stdout + result.stderr)
        self.commands.append(dict(command=command, exitCode=result.returncode, sourceReceipt=str(receipt), supervisorResult=str(result_root / "result.json")))
        (self.root / "commands.json").write_text(json.dumps(self.commands, indent=2) + "\n")
        self.assertTrue((result_root / "result.json").exists(), result.stdout + result.stderr)
        lifecycle = json.loads((result_root / "result.json").read_text())
        self.assertTrue(lifecycle["allChildExitsObserved"], lifecycle)
        self.assertTrue(lifecycle["rootRemoved"], lifecycle)
        self.assertTrue(all(child["exitObserved"] and child["exitObservedAt"] <= lifecycle["rootRemovedAt"] for child in lifecycle["processes"]))
        return result, json.loads(receipt.read_text()) if receipt.exists() else None, receipt, lifecycle

    def simple(self, code=PROGRAM, output="1", suffix=""):
        return "Example\n=======\n\n.. testcode:: ordinary\n\n" + "".join("   " + line + "\n" for line in code.rstrip("\n").split("\n")) + "\n.. testoutput:: ordinary\n\n   " + output + "\n\n" + suffix

    def test_rst_myst_includes_native_state_and_rendered_pair(self):
        rst = self.simple(suffix=""".. toctree::

   myst

.. testsetup:: state

   values = []

.. testcode:: state

   values.append(2)

.. doctest:: state

   >>> values
   [2]
   >>> print('global', global_value)
   global 10
   >>> raise ValueError('expected')
   Traceback (most recent call last):
   ...
   ValueError: expected

.. testcleanup:: state

   assert values == [2]

.. include:: fragment.inc
""")
        fragment = """.. doctest:: included

   >>> print('first\\n\\nlast')
   first
   <BLANKLINE>
   last
   >>> print('included value')  # doctest: +ELLIPSIS
   included ...
"""
        myst = """# MyST examples

```{testsetup} myst-state
values = []
```

```{testcode} myst-state
values.append(7)
```

```{doctest} myst-state
>>> values
[7]
>>> print('two    words')  # doctest: +NORMALIZE_WHITESPACE
two words
```

```{testcleanup} myst-state
assert values == [7]
```
"""
        project, binding = self.project({"index.rst": rst, "myst.md": myst, "fragment.inc": fragment})
        html_result, html, _, _ = self.run_builder(project, binding, "html")
        self.assertEqual(html_result.returncode, 0, html)
        executed_result, executed, path, _ = self.run_builder(project, binding)
        self.assertEqual(executed_result.returncode, 0, executed)
        self.assertEqual(executed["attempted"], 10)
        checked_receipt(path, binding)
        verify_sphinx_pair(html, executed)
        included = [n for n in executed["testNodes"]["index"] if n["groups"] == ["included"]][0]
        self.assertIn("# doctest: +ELLIPSIS", included["testText"])
        self.assertNotIn("# doctest: +ELLIPSIS", included["displayedText"])
        page = Path(html["rendered"]["index"]["path"])
        page.write_bytes(page.read_bytes() + b"\n<!-- source changed -->")
        with self.assertRaisesRegex(ValueError, "Rendered page changed"):
            verify_sphinx_pair(html, executed)

    def test_wrong_output_and_missing_import_fail(self):
        for label, code, output in (("wrong-output", PROGRAM, "2"), ("missing-import", PROGRAM.replace("import libtmux", "import missing_libtmux_example_import"), "1")):
            with self.subTest(label=label):
                project, binding = self.project({"index.rst": self.simple(code, output)}, label)
                result, receipt, _, _ = self.run_builder(project, binding)
                self.assertNotEqual(result.returncode, 0)
                self.assertGreater(receipt["failed"], 0)
                self.assertFalse(receipt["passed"])

    def test_guide_rst_and_myst_blocks_run_unchanged(self):
        guide = (SCRIPTS.parent / "notes/example-testing.md").read_text()
        rst = re.findall(r"^```rst\n(.*?)^```\s*$", guide, re.M | re.S)
        myst = re.findall(r"^````markdown\n(.*?)^````\s*$", guide, re.M | re.S)
        self.assertEqual((len(rst), len(myst)), (1, 1))
        project, binding = self.project({"index.rst": "Examples\n========\n\n.. toctree::\n\n   session\n   myst\n", "session.rst": rst[0], "myst.md": myst[0]})
        html_result, html, _, _ = self.run_builder(project, binding, "html")
        self.assertEqual(html_result.returncode, 0, html)
        result, executed, path, _ = self.run_builder(project, binding)
        self.assertEqual(result.returncode, 0, executed)
        self.assertEqual(executed["attempted"], 2)
        checked_receipt(path, binding)
        verify_sphinx_pair(html, executed)

    def test_autodoc_docstrings_keep_native_prompts(self):
        config = CONFIG + '''
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
extensions.append("sphinx.ext.autodoc")
'''
        module = '''def ordinary():
    """Inspect an ordinary session.

    >>> import uuid
    >>> import libtmux
    >>> server = libtmux.Server()
    >>> with server.new_session(session_name=f"example-{uuid.uuid4().hex}") as session:
    ...     print(len(session.windows))
    1
    """
'''
        project, binding = self.project({"index.rst": "Example\n=======\n\n.. automodule:: session_example\n   :members:\n", "session_example.py": module}, config=config)
        html_result, html, _, _ = self.run_builder(project, binding, "html")
        self.assertEqual(html_result.returncode, 0, html)
        executed_result, executed, path, _ = self.run_builder(project, binding)
        self.assertEqual(executed_result.returncode, 0, executed)
        self.assertEqual(executed["attempted"], 4)
        checked_receipt(path, binding)
        verify_sphinx_pair(html, executed)
        self.assertTrue(any(":docstring of " in node["source"] for node in executed["testNodes"]["index"]))

    def test_autodoc_uses_bound_bytes_with_cold_or_warm_cache(self):
        config = CONFIG + '\nimport sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path(__file__).parent))\nextensions.append("sphinx.ext.autodoc")\n'
        old = 'def example():\n    """\n    >>> print("old")\n    old\n    """\n'
        new = 'def example():\n    """\n    >>> print("new")\n    bad\n    """\n'
        self.assertEqual(len(old), len(new))
        for mode in ("cold", "stale-cache", "current-cache"):
            with self.subTest(mode=mode):
                project, binding = self.project({"index.rst": "Example\n=======\n\n.. automodule:: cached_example\n   :members:\n", "cached_example.py": old}, mode, config)
                source = project / "cached_example.py"
                os.utime(source, (1800000000, 1800000000))
                if mode != "cold":
                    py_compile.compile(str(source), doraise=True)
                if mode != "current-cache":
                    source.write_text(new)
                    os.utime(source, (1800000000, 1800000000))
                binding.value["inputs"][str(source.resolve())] = digest(source.read_bytes())
                binding.path.write_text(json.dumps(binding.value))
                binding = Binding(binding.path)
                caches = {path: path.read_bytes() for path in project.rglob("*.pyc")}
                html_result, html, html_path, _ = self.run_builder(project, binding, "html")
                self.assertEqual(html_result.returncode, 0, html)
                result, executed, path, _ = self.run_builder(project, binding)
                self.assertEqual(result.returncode, 0 if mode == "current-cache" else 1, executed)
                text = executed["testNodes"]["index"][0]["testText"]
                self.assertIn('print("old")' if mode == "current-cache" else 'print("new")', text)
                self.assertEqual(html["autodocSources"], {str(source.resolve()): digest(source.read_bytes())})
                self.assertEqual(html["autodocSources"], executed["autodocSources"])
                if mode == "current-cache":
                    verify_sphinx_pair(checked_receipt(html_path, binding), checked_receipt(path, binding))
                else:
                    with self.assertRaisesRegex(ValueError, "incomplete or failed"):
                        checked_receipt(path, binding)
                self.assertEqual(caches, {path: path.read_bytes() for path in project.rglob("*.pyc")})

    def test_preloaded_autodoc_module_fails_before_native_build(self):
        config = CONFIG + '\nextensions.append("sphinx.ext.autodoc")\n'
        module = 'def example():\n    """\n    >>> print("old")\n    old\n    """\n'
        project, binding = self.project({"index.rst": "Example\n=======\n\n.. automodule:: loaded_example\n   :members:\n", "loaded_example.py": module}, config=config)
        for builder in ("html", "doctest"):
            with self.subTest(builder=builder):
                result, receipt, _, _ = self.run_builder(project, binding, builder, preload="loaded_example")
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(receipt["complete"])
                self.assertIn("imported before the adapter", receipt["errors"][0]["message"])

    def test_autodoc_wrappers_bind_the_selected_docstring_source(self):
        config = CONFIG + '\nimport sys\nfrom pathlib import Path\nsys.path.insert(0, str(Path(__file__).parent))\nextensions.append("sphinx.ext.autodoc")\n'
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
        for kind in ("own", "copied", "lru"):
            for mode in ("unbound-cold", "unbound-stale", "bound-stale", "bound-current"):
                with self.subTest(kind=kind, mode=mode):
                    module = 'def wrapped():\n    return 1\n' if kind == "own" else documented
                    decorator = own if kind == "own" else copied if kind == "copied" else 'from functools import lru_cache\ndecorate = lru_cache(maxsize=None)\n'
                    project, binding = self.project({"index.rst": "Example\n=======\n\n.. autofunction:: facade.decorated\n", "base.py": module, "decorators.py": decorator,
                        "facade.py": 'from base import wrapped\nfrom decorators import decorate\ndecorated = decorate(wrapped)\n'}, kind + "-" + mode, config)
                    source = project / ("decorators.py" if kind == "own" else "base.py")
                    old = source.read_text()
                    new = old.replace('print("old")', 'print("new")').replace('old\n', 'bad\n')
                    self.assertEqual(len(old), len(new))
                    os.utime(source, (1800000000, 1800000000))
                    if mode != "unbound-cold":
                        py_compile.compile(str(source), doraise=True)
                    if mode != "bound-current":
                        source.write_text(new)
                        os.utime(source, (1800000000, 1800000000))
                    if mode.startswith("unbound-"):
                        del binding.value["inputs"][str(source.resolve())]
                    else:
                        binding.value["inputs"][str(source.resolve())] = digest(source.read_bytes())
                    binding.path.write_text(json.dumps(binding.value))
                    binding = Binding(binding.path)
                    caches = {p: p.read_bytes() for p in project.rglob("*.pyc")}
                    html_result, html, html_path, _ = self.run_builder(project, binding, "html")
                    result, executed, path, _ = self.run_builder(project, binding)
                    self.assertEqual(result.returncode, 0 if mode == "bound-current" else 1, executed)
                    if mode.startswith("unbound-"):
                        self.assertNotEqual(html_result.returncode, 0)
                        self.assertFalse(html["complete"])
                        self.assertFalse(executed["complete"])
                        self.assertIn(str(source), str(executed["errors"]))
                    else:
                        self.assertEqual(html_result.returncode, 0, html)
                        self.assertTrue(executed["complete"])
                        self.assertEqual(executed["attempted"], 1)
                        selected = executed["autodocObjects"]["base.wrapped"][0]
                        expected = [project / "decorators.py"] if kind == "own" else [project / "decorators.py", project / "base.py"] if kind == "copied" else [project / "base.py"]
                        self.assertEqual(selected["docstringSources"], [dict(path=str(p), sha256=digest(p.read_bytes())) for p in expected])
                        self.assertEqual(html["autodocObjects"], executed["autodocObjects"])
                        self.assertIn(str(project / "base.py") + ":docstring of base.wrapped", executed["testNodes"]["index"][0]["source"])
                    if mode == "bound-current":
                        verify_sphinx_pair(checked_receipt(html_path, binding), checked_receipt(path, binding))
                    else:
                        with self.assertRaisesRegex(ValueError, "incomplete or failed"):
                            checked_receipt(path, binding)
                    self.assertEqual(caches, {p: p.read_bytes() for p in project.rglob("*.pyc")})

    def test_body_and_native_cleanup_errors_remain_visible(self):
        code = PROGRAM + "raise RuntimeError('body failure')\n"
        suffix = ".. testcleanup:: ordinary\n\n   raise RuntimeError('cleanup failure')\n"
        project, binding = self.project({"index.rst": self.simple(code, suffix=suffix)})
        result, receipt, _, _ = self.run_builder(project, binding)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((receipt["failed"], receipt["cleanupFailed"]), (1, 1))

    def test_setup_failure_cannot_claim_execution(self):
        prefix = ".. testsetup:: ordinary\n\n   raise RuntimeError('setup failure')\n\n"
        project, binding = self.project({"index.rst": prefix + self.simple()})
        result, receipt, _, _ = self.run_builder(project, binding)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(receipt["setupFailed"], 1)
        self.assertEqual(receipt["attempted"], 0)
        self.assertFalse(receipt["complete"])

    def test_skipped_examples_do_not_claim_execution(self):
        project, binding = self.project({"index.rst": "Example\n=======\n\n.. doctest::\n\n   >>> raise RuntimeError('not executed')  # doctest: +SKIP\n"})
        result, receipt, _, _ = self.run_builder(project, binding)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(receipt["attempted"], 0)
        self.assertFalse(receipt["complete"])

    def test_warning_as_error_finishes_as_failure(self):
        project, binding = self.project({"index.rst": self.simple(suffix="Missing reference: :ref:`unresolved-example-target`.\n")})
        result, receipt, _, _ = self.run_builder(project, binding, "html")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(receipt["nativeExitCode"], 1)
        self.assertFalse(receipt["passed"])

    def test_unbound_include_fails_before_example_execution(self):
        project, binding = self.project({"index.rst": "Example\n=======\n\n.. include:: later.inc\n"})
        (project / "later.inc").write_text(self.simple())
        result, receipt, _, _ = self.run_builder(project, binding)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(receipt["complete"])
        self.assertIn("absent from the source binding", str(receipt["errors"]))

    def test_timeout_and_worker_crash_leave_incomplete_native_receipts(self):
        for label, ending, timeout in (("timeout", "import time\ntime.sleep(60)\n", 5), ("crash", "import os\nimport signal\nos.kill(os.getpid(), signal.SIGKILL)\n", 20)):
            with self.subTest(label=label):
                marker = self.root / (label + ".ready")
                code = "import uuid\nfrom pathlib import Path\nimport libtmux\nserver = libtmux.Server()\nsession = server.new_session(session_name=f'crash-{uuid.uuid4().hex}')\n"
                code += f"Path({str(marker)!r}).write_text(session.session_id)\n" + ending
                project, binding = self.project({"index.rst": self.simple(code, "")}, label)
                result, receipt, _, lifecycle = self.run_builder(project, binding, timeout=timeout)
                self.assertNotEqual(result.returncode, 0)
                self.assertTrue(marker.exists(), "The failure occurred before a tmux session existed")
                self.assertFalse(receipt["complete"])
                self.assertFalse(lifecycle["passed"])
                if label == "timeout":
                    self.assertTrue(any(error["phase"] == "body" and error["type"] == "TimeoutError" for error in lifecycle["errors"]))
                else:
                    self.assertEqual(lifecycle["exampleExitCode"], -9)


class AutodocProviderTests(unittest.TestCase):
    """Check native docstring providers with printing-only, daemon-free projects."""

    def setUp(self):
        self.root = OUTPUT / self.id().rsplit(".", 1)[-1]
        self.root.mkdir()
        self.commands = []

    def run_builder(self, project, binding, builder, native=False):
        label = ("native-" if native else "bound-") + builder
        receipt = project / (label + ".json")
        output = project / (label + "-build")
        command = [sys.executable, "-B"]
        if native:
            command += ["-m", "sphinx"]
        else:
            command += [str(SCRIPTS / "run_sphinx_examples.py"), "--binding", str(binding.path), "--receipt", str(receipt), "--"]
        command += ["-b", builder, "-E", "-a", "-W", str(project), str(output)]
        env = dict(os.environ, PYTHONPATH=os.pathsep.join([str(project), str(SCRIPTS), os.environ.get("PYTHONPATH", "")]), PYTHONDONTWRITEBYTECODE="1")
        env.pop("LIBTMUX_EXAMPLE_BINDING", None)
        env.pop("LIBTMUX_EXAMPLE_RECEIPT", None)
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=25)
        (project / (label + ".log")).write_text(result.stdout + result.stderr)
        self.commands.append(dict(command=command, exitCode=result.returncode, sourceReceipt=str(receipt) if not native else None))
        (self.root / "commands.json").write_text(json.dumps(self.commands, indent=2) + "\n")
        return result, json.loads(receipt.read_text()) if receipt.exists() else None, receipt, output

    def exercise(self, kind, mode, compare_native=False):
        project = self.root / (kind + "-" + mode)
        project.mkdir()
        body = '    """\n    >>> print("old")\n    old\n    """\n    return 1\n'
        method = "def example(self):\n" + body
        prefix, definition, child = "", method, "    def example(self):\n        return 2\n"
        target = ".. automethod:: facade.Child.example\n"
        config = ""
        expected = 1
        if kind in {"classmethod", "staticmethod", "property"}:
            decorator = "@" + kind + "\n"
            definition = decorator + method
            child = "    " + decorator + child
            if kind == "property":
                target = ".. autoproperty:: facade.Child.example\n"
        elif kind == "decorated":
            prefix = "from decorators import decorate\n"
            definition = "@decorate\n" + method
        elif kind == "signature":
            definition = method.replace('    """\n', '    """example(self)\n', 1)
        elif kind in {"class-init", "class-both", "class-option-init", "class-new"}:
            definition = method.replace("example(self)", "__new__(cls)" if kind == "class-new" else "__init__(self)")
            child = "    pass\n"
            target = ".. autoclass:: facade.Child\n"
            config = 'autoclass_content = "both"\n' if kind == "class-both" else 'autoclass_content = "init"\n'
            if kind in {"class-both", "class-option-init"}:
                child = '    """\n    >>> shared = 7\n    >>> shared\n    7\n    """\n'
            if kind == "class-both":
                expected += 2
            if kind == "class-option-init":
                config = 'autoclass_content = "class"\n'
                target += "   :class-doc-from: init\n"
        source = prefix + "class Base:\n" + "".join("    " + line + "\n" for line in definition.splitlines())
        facade = "from base import Base\nclass Child(Base):\n" + child
        if kind == "partial":
            source = "def example(value):\n" + body
            facade = "from functools import partial\nfrom base import example\nselected = partial(example, 1)\n"
            target = ".. autofunction:: facade.selected\n"
        (project / "base.py").write_text(source)
        (project / "facade.py").write_text(facade)
        (project / "decorators.py").write_text("from functools import wraps\ndef decorate(function):\n    @wraps(function)\n    def wrapper(*args):\n        return function(*args)\n    return wrapper\n")
        (project / "conf.py").write_text('import os\nextensions = ["sphinx.ext.doctest", "sphinx.ext.autodoc"]\nif os.environ.get("LIBTMUX_EXAMPLE_BINDING"):\n    extensions.append("sphinx_example_binding")\nproject = "Native docstrings"\nroot_doc = "index"\n' + config)
        (project / "index.rst").write_text("Example\n=======\n\n" + target)
        source_path = project / "base.py"
        os.utime(source_path, (1800000000, 1800000000))
        if mode != "unbound-cold":
            py_compile.compile(str(source_path), doraise=True)
        if mode != "bound-current":
            current = source.replace('print("old")', 'print("new")').replace('    old\n', '    bad\n')
            self.assertEqual(len(current), len(source))
            source_path.write_text(current)
            os.utime(source_path, (1800000000, 1800000000))
        inputs = [p for p in project.iterdir() if p.is_file() and (p != source_path or mode.startswith("bound-"))]
        inputs += [SCRIPTS / name for name in ("example_sources.py", "run_sphinx_examples.py", "sphinx_example_binding.py")]
        path = project / "binding.json"
        path.write_text(json.dumps(dict(schema=1, runId=project.name, inputs={str(p): digest(p.read_bytes()) for p in inputs}), indent=2) + "\n")
        binding = Binding(path)
        caches = {str(p): digest(p.read_bytes()) for p in project.rglob("*.pyc")}
        rendered, html, html_path, html_output = self.run_builder(project, binding, "html")
        result, executed, receipt, _ = self.run_builder(project, binding, "doctest")
        self.assertEqual(result.returncode, 0 if mode == "bound-current" else 1, executed)
        if mode.startswith("unbound-"):
            self.assertEqual(rendered.returncode, 1, html)
            for record in (html, executed):
                self.assertFalse(record["complete"])
                self.assertIn(str(source_path), str(record["errors"]))
        else:
            self.assertEqual(rendered.returncode, 0, html)
            self.assertEqual(executed["attempted"], expected)
            self.assertIn(str(source_path), executed["autodocSources"])
            self.assertEqual(html["autodocObjects"], executed["autodocObjects"])
        if mode == "bound-current":
            verify_sphinx_pair(checked_receipt(html_path, binding), checked_receipt(receipt, binding))
        else:
            with self.assertRaisesRegex(ValueError, "incomplete or failed"):
                checked_receipt(receipt, binding)
        if compare_native:
            native_html_result, _, _, native_html_output = self.run_builder(project, binding, "html", native=True)
            native_result, _, _, native_output = self.run_builder(project, binding, "doctest", native=True)
            self.assertEqual(native_html_result.returncode, 0, native_html_result.stdout + native_html_result.stderr)
            self.assertEqual(native_result.returncode, 0, native_result.stdout + native_result.stderr)
            self.assertRegex((native_output / "output.txt").read_text(), rf"{expected} tests?\n")
            blocks = []
            for output in (html_output, native_html_output):
                parser = PreText()
                parser.feed((output / "index.html").read_text())
                blocks.append(parser.blocks)
            self.assertEqual(*blocks)
        self.assertEqual(caches, {str(p): digest(p.read_bytes()) for p in project.rglob("*.pyc")})

    def test_inherited_method_and_constructor_sources(self):
        for kind in ("method", "class-init"):
            for mode in ("unbound-cold", "unbound-stale", "bound-stale", "bound-current"):
                with self.subTest(kind=kind, mode=mode):
                    self.exercise(kind, mode, compare_native=mode == "bound-current")

    def test_native_provider_variants(self):
        for kind in ("classmethod", "staticmethod", "property", "decorated", "signature", "class-both", "class-option-init", "class-new"):
            for mode in ("unbound-stale", "bound-current"):
                with self.subTest(kind=kind, mode=mode):
                    self.exercise(kind, mode, compare_native=mode == "bound-current")

    def test_partial_docstring_provider(self):
        for mode in ("unbound-cold", "unbound-stale", "bound-stale", "bound-current"):
            with self.subTest(mode=mode):
                self.exercise("partial", mode, compare_native=mode == "bound-current")

    def test_partial_attribution_does_not_exempt_an_explicit_include(self):
        import functools
        import inspect

        project = self.root / "project"
        project.mkdir()
        attributed = Path(inspect.getsourcefile(functools.partial)).resolve()
        (project / "base.py").write_text('def example(value):\n    """\n    >>> print("example")\n    example\n    """\n    return value\n')
        (project / "facade.py").write_text('from functools import partial\nfrom base import example\nselected = partial(example, 1)\n')
        (project / "conf.py").write_text('extensions = ["sphinx.ext.doctest", "sphinx.ext.autodoc", "sphinx_example_binding"]\nroot_doc = "index"\nproject = "Explicit include"\n')
        (project / "index.rst").write_text('Example\n=======\n\n.. autofunction:: facade.selected\n\n.. literalinclude:: ' + os.path.relpath(attributed, project) + '\n   :lines: 1\n')
        inputs = list(project.iterdir())
        path = project / "binding.json"
        path.write_text(json.dumps(dict(schema=1, runId="partial-explicit-include", inputs={str(p): digest(p.read_bytes()) for p in inputs}), indent=2) + "\n")
        binding = Binding(path)
        for builder in ("html", "doctest"):
            result, receipt, _, _ = self.run_builder(project, binding, builder)
            self.assertEqual(result.returncode, 1, receipt)
            self.assertFalse(receipt["complete"])
            self.assertIn("Input is absent from the source binding: " + str(attributed), str(receipt["errors"]))

    def test_unselected_parent_source_is_not_required(self):
        for kind in ("inherit-disabled", "class-only"):
            with self.subTest(kind=kind):
                project = self.root / kind
                project.mkdir()
                (project / "base.py").write_text('class Base:\n    def example(self):\n        """\n        >>> raise RuntimeError("unselected method")\n        """\n    def __init__(self):\n        """\n        >>> raise RuntimeError("unselected constructor")\n        """\n')
                facade = 'from base import Base\nclass Child(Base):\n'
                facade += '    def example(self):\n        pass\n' if kind == "inherit-disabled" else '    """\n    >>> print("child")\n    child\n    """\n'
                (project / "facade.py").write_text(facade)
                (project / "conf.py").write_text('extensions = ["sphinx.ext.doctest", "sphinx.ext.autodoc", "sphinx_example_binding"]\nproject = "Unselected source"\nroot_doc = "index"\nautodoc_inherit_docstrings = False\nautoclass_content = "class"\n')
                body = '.. automethod:: facade.Child.example\n\n>>> print("page")\npage\n' if kind == "inherit-disabled" else '.. autoclass:: facade.Child\n'
                (project / "index.rst").write_text("Example\n=======\n\n" + body)
                inputs = [p for p in project.iterdir() if p.name != "base.py"]
                path = project / "binding.json"
                path.write_text(json.dumps(dict(schema=1, runId=kind, inputs={str(p): digest(p.read_bytes()) for p in inputs}), indent=2) + "\n")
                binding = Binding(path)
                rendered, html, html_path, _ = self.run_builder(project, binding, "html")
                result, executed, receipt, _ = self.run_builder(project, binding, "doctest")
                self.assertEqual(rendered.returncode, 0, html)
                self.assertEqual(result.returncode, 0, executed)
                self.assertEqual(executed["attempted"], 1)
                self.assertNotIn(str(project / "base.py"), executed["autodocSources"])
                verify_sphinx_pair(checked_receipt(html_path, binding), checked_receipt(receipt, binding))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--tmux", default="tmux")
    args, remaining = parser.parse_known_args()
    OUTPUT = args.output_dir.resolve() if args.output_dir else Path(tempfile.mkdtemp(prefix="libtmux-native-example-tests-"))
    if args.output_dir:
        OUTPUT.mkdir(parents=True, exist_ok=False)
    TMUX = args.tmux
    print(f"Native example receipts: {OUTPUT}", flush=True)
    unittest.main(argv=[sys.argv[0], *remaining])
