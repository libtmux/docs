#!/usr/bin/env python3
"""Bind documentation inputs and verify completed native example receipts."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
from html.parser import HTMLParser
import importlib.abc
import importlib.machinery
import inspect
import json
from pathlib import Path
import sys
import uuid


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def save_json(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


class Binding:
    """An explicit input snapshot shared by rendering and native execution."""

    def __init__(self, path: Path) -> None:
        self.path = path.resolve()
        raw = self.path.read_bytes()
        self.sha256 = digest(raw)
        self.value = json.loads(raw)
        require(self.value.get("schema") == 1, "Unsupported source-binding schema")
        require(isinstance(self.value.get("runId"), str) and bool(self.value["runId"]), "A source binding needs a run ID")
        self.inputs = self.value.get("inputs")
        require(isinstance(self.inputs, dict) and bool(self.inputs), "A source binding needs input files")
        for name, checksum in self.inputs.items():
            require(str(Path(name).resolve()) == name and isinstance(checksum, str) and len(checksum) == 64,
                    f"Invalid bound input: {name}")
        self.verify()

    def read(self, path: Path) -> bytes:
        filename = str(path.resolve())
        require(filename in self.inputs, f"Input is absent from the source binding: {filename}")
        data = Path(filename).read_bytes()
        require(digest(data) == self.inputs[filename], f"Input changed after binding: {filename}")
        return data

    def verify(self) -> None:
        require(digest(self.path.read_bytes()) == self.sha256, "The source binding changed during the run")
        for name in self.inputs:
            self.read(Path(name))


class BoundImports(importlib.abc.MetaPathFinder):
    """Compile bound Python imports from checked bytes, without bytecode caches."""

    _active = None

    def __init__(self, binding: Binding) -> None:
        self.binding = binding
        self.modules = {}

    def __enter__(self):
        require(BoundImports._active is None, "A bound import scope is already active")
        bootstrap = {str(Path(__file__).resolve())}
        for name in ("run_doctest_examples", "run_sphinx_examples", "__main__"):
            module = sys.modules.get(name)
            filename = getattr(module, "__file__", None)
            if filename and Path(filename).resolve().parent == Path(__file__).resolve().parent:
                bootstrap.add(str(Path(filename).resolve()))
        for name, module in list(sys.modules.items()):
            filename = getattr(module, "__file__", None)
            if filename:
                path = str(Path(filename).resolve())
                require(path not in self.binding.inputs or path in bootstrap,
                        f"Bound source was imported before the adapter: {name} ({path}); run the adapter in a fresh Python process")
        BoundImports._active = self
        sys.meta_path.insert(0, self)
        return self

    def __exit__(self, *exception):
        sys.meta_path.remove(self)
        BoundImports._active = None

    @classmethod
    def current(cls, binding: Binding):
        active = cls._active
        require(active is not None and active.binding.sha256 == binding.sha256,
                "Run Sphinx through run_sphinx_examples.py to bind Python imports")
        return active

    def find_spec(self, fullname, path=None, target=None):
        for finder in sys.meta_path:
            if finder is self:
                continue
            spec = finder.find_spec(fullname, path, target)
            if spec is None:
                continue
            if spec.origin and str(Path(spec.origin).resolve()) in self.binding.inputs:
                require(type(spec.loader) is importlib.machinery.SourceFileLoader,
                        f"Bound Python imports require the native source loader: {fullname}")
                spec.loader = _BoundSourceLoader(fullname, spec.origin, self)
            return spec
        return None

    def require_source(self, path: Path) -> str:
        filename = str(path.resolve())
        self.binding.read(path)
        matches = [(name, module) for name, (module, source) in self.modules.items() if source == filename]
        require(bool(matches) and all(sys.modules.get(name) is module for name, module in matches),
                f"No import from bound source bytes: {filename}; run the adapter in a fresh Python process")
        return self.binding.inputs[filename]

    def inventory(self) -> dict:
        return {name: dict(path=path, sha256=self.require_source(Path(path)))
                for name, (_, path) in self.modules.items()}

    def require_docstring(self, obj, name: str) -> list[dict]:
        """Check the selected object and any wrapper that copies its docstring."""
        sources = {}
        seen = set()
        if isinstance(obj, property):
            obj = obj.fget
        while True:
            require(id(obj) not in seen, f"Docstring wrapper cycle for {name}")
            seen.add(id(obj))
            try:
                filename = inspect.getsourcefile(obj)
            except TypeError:
                filename = None
            if filename is not None:
                path = Path(filename).resolve()
                require(str(path) in self.binding.inputs,
                        f"{name} requires defining source in the binding: {path}")
                sources[str(path)] = self.require_source(path)
            # Native doctest reads this object's __doc__, not inspect.unwrap(obj).
            # update_wrapper copies the same string; check both Python sources.
            # A C wrapper such as lru_cache has only its copied docstring source.
            wrapped = getattr(obj, "__wrapped__", None)
            copied = wrapped is not None and getattr(obj, "__doc__", None) is getattr(wrapped, "__doc__", None)
            require(filename is not None or copied,
                    f"Cannot identify the Python defining source for {name}; the selected object's docstring has no source or verified wrapper copy")
            if not copied:
                break
            obj = wrapped
        return [dict(path=path, sha256=checksum) for path, checksum in sources.items()]


class _BoundSourceLoader(importlib.machinery.SourceFileLoader):
    def __init__(self, name, path, imports):
        super().__init__(name, path)
        self.imports = imports

    def get_code(self, fullname):
        # -B disables cache writes but still reads matching timestamp caches.
        return self.source_to_code(self.imports.binding.read(Path(self.path)), self.path)

    def exec_module(self, module):
        super().exec_module(module)
        self.imports.modules[self.name] = (module, str(Path(self.path).resolve()))


class Receipt:
    """Reserve a new result path before a native runner starts executing tests."""

    def __init__(self, path: Path, binding: Binding, producer: str) -> None:
        self.path = path.resolve()
        self.binding = binding
        self.record = dict(schema=1, producer=producer, runId=binding.value["runId"],
                           bindingSha256=binding.sha256, complete=False, passed=False,
                           inputs=binding.inputs, errors=[])
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(self.record, indent=2, sort_keys=True) + "\n")

    def save(self) -> None:
        save_json(self.path, self.record)

    def finish(self, passed: bool) -> None:
        self.binding.verify()
        self.record.update(complete=True, passed=passed)
        self.save()

    def fail(self, error: BaseException) -> None:
        self.record["passed"] = False
        self.record["errors"].append(dict(type=type(error).__name__, message=str(error)))
        self.save()


def checked_receipt(path: Path, binding: Binding) -> dict:
    binding.verify()
    value = json.loads(path.read_text(encoding="utf-8"))
    require(value.get("schema") == 1 and value.get("complete") is True and value.get("passed") is True,
            f"Native result is incomplete or failed: {path}")
    require(value.get("runId") == binding.value["runId"] and value.get("bindingSha256") == binding.sha256
            and value.get("inputs") == binding.inputs, f"Native result belongs to different inputs or a previous run: {path}")
    require(value.get("errors") == [], f"Native result retains errors: {path}")
    return value


class PreText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self.parts: list[str] | None = None

    def handle_starttag(self, tag, attrs) -> None:
        if tag == "pre":
            self.parts = []

    def handle_endtag(self, tag) -> None:
        if tag == "pre" and self.parts is not None:
            self.blocks.append("".join(self.parts))
            self.parts = None

    def handle_data(self, data) -> None:
        if self.parts is not None:
            self.parts.append(data)


def verify_rendered_blocks(path: Path, nodes: list[dict]) -> dict:
    raw = path.read_bytes()
    parser = PreText()
    parser.feed(raw.decode("utf-8"))
    # Sphinx's highlighter terminates a preformatted block with a newline.
    visible = Counter(text.removesuffix("\n") for text in parser.blocks)
    for node in nodes:
        if node["hidden"]:
            continue
        text = node["displayedText"].removesuffix("\n")
        require(visible[text] > 0, f"Rendered example differs from its native test node: {path}:{node['line']}")
        visible[text] -= 1
    return dict(path=str(path.resolve()), sha256=digest(raw))


def verify_sphinx_pair(html: dict, executed: dict) -> None:
    require(html.get("producer") == "sphinx" and html.get("format") == "html", "Expected a Sphinx HTML receipt")
    require(executed.get("producer") == "sphinx" and executed.get("builder") == "doctest", "Expected a Sphinx doctest receipt")
    for key in ("documents", "testNodes", "doctestConfiguration", "autodocSources", "autodocObjects"):
        require(html.get(key) == executed.get(key), f"Rendered and executed Sphinx inputs differ: {key}")
    require(executed.get("attempted", 0) > 0, "Sphinx executed no doctest examples")
    for document, output in html.get("rendered", {}).items():
        path = Path(output["path"])
        require(digest(path.read_bytes()) == output["sha256"], f"Rendered page changed after verification: {path}")
        verify_rendered_blocks(path, html["testNodes"][document])
    require(set(html.get("rendered", {})) == set(html["testNodes"]), "Rendered-page inventory is incomplete")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    bind = commands.add_parser("bind", help="Create a new source manifest before rendering or testing")
    bind.add_argument("--output", type=Path, required=True)
    bind.add_argument("--input", type=Path, nargs="+", required=True)
    check = commands.add_parser("verify", help="Reject stale, failed or incomplete native receipts")
    check.add_argument("--binding", type=Path, required=True)
    check.add_argument("--receipt", type=Path, required=True)
    check.add_argument("--sphinx-html", type=Path)
    check.add_argument("--expected-tests", type=int)
    args = parser.parse_args()
    if args.operation == "bind":
        inputs = {str(path.resolve()): digest(path.read_bytes()) for path in args.input}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(json.dumps(dict(schema=1, runId=uuid.uuid4().hex, inputs=inputs), indent=2, sort_keys=True) + "\n")
    else:
        binding = Binding(args.binding)
        receipt = checked_receipt(args.receipt, binding)
        require(isinstance(receipt.get("attempted"), int) and receipt["attempted"] > 0, "No native examples executed")
        if args.expected_tests is not None:
            require(args.expected_tests > 0 and receipt["attempted"] == args.expected_tests, "Native test count differs from the expected inventory")
        if args.sphinx_html:
            verify_sphinx_pair(checked_receipt(args.sphinx_html, binding), receipt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
