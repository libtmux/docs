#!/usr/bin/env python3
"""Audit assembled inventory destinations and build strict Sphinx/MyST consumers."""

from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter
from functools import cache
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import NotRequired, TypedDict
from urllib.parse import unquote, urlsplit

from sphinx.util.inventory import InventoryFile

RAW_TEXT = re.compile(r"<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?</\1\s*>", re.IGNORECASE)
TAG = re.compile(r"""<[A-Za-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>""")
ID_ATTRIBUTE = re.compile(r"(?:\s)id\s*=", re.IGNORECASE)

type AuditValue = int | list[dict[str, str | int]]


class NativeAlias(TypedDict):
    """Registered object type and its native reference name."""

    type: str
    name: str


class Target(TypedDict):
    """Rendered destination and its public inventory identities."""

    key: str
    href: str
    scope: str
    product: str
    category: str
    version: str
    aliases: NotRequired[list[str]]
    native: NotRequired[list[NativeAlias]]


class Catalog(TypedDict):
    """Inventory targets owned by one deployment prefix."""

    base: str
    scope: NotRequired[str]
    version: NotRequired[str]
    defaults: NotRequired[dict[str, str]]
    targets: list[Target]


class DocumentOwner(TypedDict):
    """Ownership metadata emitted by the documentation shell."""

    scope: str
    version: NotRequired[str]
    exclude: NotRequired[bool]


class Page(HTMLParser):
    """Read fragments, links, and copyable code from rendered HTML."""

    def __init__(self, html: str, links: bool = True) -> None:
        super().__init__(convert_charrefs=True)
        self.ids: Counter[str] = Counter()
        self.links: set[str] = set()
        self.ordered_links: list[str] = []
        self.code_blocks: list[tuple[str, str]] = []
        self.code_language: str | None = None
        self.references: dict[str, set[str]] = {}
        self.current_link: str | None = None
        self.link_text: list[str] = []
        self.collect_links = links
        if links:
            self.feed(html)
        else:
            # Parse attributes with HTMLParser, avoiding millions of highlight spans.
            for match in TAG.finditer(RAW_TEXT.sub("", html)):
                tag = match.group()
                if ID_ATTRIBUTE.search(tag):
                    self.feed(tag)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Collect real attributes without counting comments or raw text."""
        attributes = dict(attrs)
        if self.collect_links and tag == "pre":
            self.code_language = attributes.get("data-language")
        if (
            self.collect_links
            and tag == "button"
            and self.code_language
            and (code := attributes.get("data-code"))
        ):
            # Expressive Code encodes line breaks as DEL in copy payloads.
            self.code_blocks.append((self.code_language, code.replace("\x7f", "\n")))
            self.code_language = None
        if identifier := attributes.get("id"):
            self.ids[identifier] += 1
        if self.collect_links and tag == "a" and (href := attributes.get("href")):
            self.links.add(href)
            self.ordered_links.append(href)
            self.current_link = href
            self.link_text = []

    def handle_data(self, data: str) -> None:
        """Retain the visible caption of consumer references."""
        if self.current_link is not None:
            self.link_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        """Associate each reference caption with its resolved destination."""
        if tag == "a" and self.current_link is not None:
            label = " ".join("".join(self.link_text).split())
            self.references.setdefault(label, set()).add(self.current_link)
            self.current_link = None
            self.link_text = []


def authored_examples(root: Path, prefix: str, origin: str) -> int:
    """Resolve the published examples and compare their displayed destinations."""
    source = (
        Path(__file__).resolve().parents[1] / "site/src/content/docs/meta/intersphinx/examples.mdx"
    )
    article = source.read_text()
    rendered = (root / "meta/intersphinx/examples/index.html").read_text()
    snippets = re.findall(r"^```(rst|markdown)\n(.*?)^```\s*$", article, re.MULTILINE | re.DOTALL)
    copied = [
        (language, code)
        for language, code in Page(rendered).code_blocks
        if language in ("rst", "markdown")
    ]
    assert [(language, code.rstrip("\n")) for language, code in snippets] == copied, (
        "Published copy buttons must preserve every authored reference snippet"
    )
    destinations = re.findall(r"<p>Destinations?:.*?</p>", rendered, re.DOTALL)
    assert snippets and len(snippets) == len(destinations), (
        "Every reference example needs a destination paragraph"
    )
    configuration = re.search(r"^```python\n(.*?)^```\s*$", article, re.MULTILINE | re.DOTALL)
    assert configuration is not None, "The examples need a complete Intersphinx configuration"
    settings = ast.parse(configuration.group(1))
    mapping = next(
        ast.literal_eval(statement.value)
        for statement in settings.body
        if isinstance(statement, ast.Assign)
        and any(
            isinstance(target, ast.Name) and target.id == "intersphinx_mapping"
            for target in statement.targets
        )
    )
    mappings = {
        name: (
            base.replace("https://libtmux.org/en/", origin + prefix),
            inventory.replace("https://libtmux.org/en/", origin + prefix) if inventory else None,
        )
        for name, (base, inventory) in mapping.items()
    }
    bodies: dict[str, list[str]] = {"rst": [], "markdown": []}
    expected: dict[str, list[str]] = {"rst": [], "markdown": []}
    for (language, snippet), paragraph in zip(snippets, destinations, strict=True):
        links = Page(paragraph).ordered_links
        assert links, "An example destination must be a real link"
        bodies[language].append(snippet)
        expected[language].extend(origin + href if href.startswith("/") else href for href in links)
    with tempfile.TemporaryDirectory(prefix="libtmux-authored-intersphinx-") as scratch:
        work = Path(scratch)
        config = {
            "extensions": ["sphinx.ext.intersphinx", "myst_parser"],
            "intersphinx_mapping": mappings,
            "master_doc": "index",
            "project": "Published Intersphinx examples",
            "source_suffix": {".rst": "restructuredtext", ".md": "markdown"},
            "html_theme": "basic",
            "intersphinx_cache_limit": 0,
        }
        (work / "conf.py").write_text(
            "\n".join(f"{key} = {value!r}" for key, value in config.items())
        )
        (work / "index.rst").write_text(
            "Examples\n========\n\n.. toctree::\n\n   rst\n   markdown\n"
        )
        (work / "rst.rst").write_text("RST\n===\n\n" + "\n\n".join(bodies["rst"]))
        (work / "markdown.md").write_text("# MyST\n\n" + "\n\n".join(bodies["markdown"]))
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "sphinx",
                "-E",
                "-a",
                "-n",
                "-W",
                "--keep-going",
                "-b",
                "html",
                str(work),
                str(work / "html"),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        for language, wanted in expected.items():
            page = Page((work / "html" / f"{language}.html").read_text())
            actual = [href for href in page.ordered_links if href.startswith(origin + prefix)]
            assert actual == wanted, {"language": language, "expected": wanted, "actual": actual}
    return sum(map(len, expected.values()))


class Metadata(HTMLParser):
    """Read ownership from the head without parsing a whole article."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.value: DocumentOwner | None = None
        self.done = False
        self.shell_export = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        """Identify owned documents and excluded native helper exports."""
        attributes = dict(attrs)
        if tag == "html" and "data-native-shell-export" in attributes:
            self.shell_export = True
        if tag == "meta" and attributes.get("name") == "libtmux-inventory":
            content = attributes.get("content")
            assert content is not None, "Inventory metadata needs content"
            self.value = json.loads(content)

    def handle_endtag(self, tag: str) -> None:
        """Stop metadata reads once the document head ends."""
        if tag == "head":
            self.done = True


def metadata(path: Path) -> DocumentOwner | None:
    """Return shell ownership, excluding native helper exports."""
    parser = Metadata()
    with path.open() as source:
        while chunk := source.read(4096):
            parser.feed(chunk)
            if parser.value is not None or parser.done:
                break
    return None if parser.shell_export else parser.value


@cache
def page(path: Path) -> Page:
    """Cache fragment counts for repeatedly referenced documents."""
    return Page(path.read_text(), links=False)


def destination(root: Path, prefix: str, url: str) -> None:
    """Require a destination inside the assembly and a unique fragment."""
    parsed = urlsplit(url)
    assert parsed.path.startswith(prefix), f"Inventory URL escapes {prefix}: {url}"
    path = root / unquote(parsed.path[len(prefix) :])
    if parsed.path.endswith("/"):
        path /= "index.html"
    path = path.resolve()
    assert path.is_relative_to(root), f"Inventory URL escapes output: {url}"
    assert path.is_file(), f"Missing inventory page: {url}"
    if parsed.fragment:
        fragment = unquote(parsed.fragment)
        assert page(path).ids[fragment] == 1, f"Missing or duplicate inventory fragment: {url}"


def records(path: Path, base: str) -> dict[tuple[str, str], str]:
    """Decode inventory URLs with Sphinx's own parser."""
    inventory = InventoryFile.loads(path.read_bytes(), uri=base).data
    return {
        (kind, name): item.uri for kind, items in inventory.items() for name, item in items.items()
    }


ROLE = {
    "std:label": "ref",
    "std:doc": "doc",
    "std:term": "term",
    "std:confval": "confval",
    "std:cmdoption": "option",
    "std:envvar": "envvar",
    "std:token": "token",
}
for domain in ("py", "js"):
    for kind, spelling in {
        "function": "func",
        "method": "meth",
        "attribute": "attr",
        "module": "mod",
    }.items():
        ROLE[f"{domain}:{kind}"] = f"{domain}:{spelling}"
ROLE["py:exception"] = "py:exc"


def role(kind: str) -> str:
    """Map inventory object types to built-in Sphinx role spellings."""
    return ROLE.get(
        kind,
        kind.replace(":function", ":func")
        .replace(":attribute", ":attr")
        .replace("cpp:member", "cpp:var"),
    )


def option_contexts(catalog: Catalog) -> list[tuple[str, str, str]]:
    """Select unambiguous option names for Sphinx program directives."""
    destinations: dict[tuple[str, str], set[str]] = {}
    programs = {}
    for target in catalog["targets"]:
        for native in target.get("native", []):
            if native["type"] != "std:cmdoption":
                continue
            words = native["name"].split()
            if len(words) < 2:
                continue
            option = words.pop()
            program = f"{target['scope']}:{target['product']}:{' '.join(words)}"
            key = ("-".join(program.split()), option)
            destinations.setdefault(key, set()).add(target["href"])
            programs.setdefault(key, program)
    return [
        (programs[key], key[1], next(iter(urls)))
        for key, urls in destinations.items()
        if len(urls) == 1
    ]


def consumer(
    root: Path, prefix: str, catalogs: list[tuple[Path, Catalog]], origin: str, myst: bool
) -> int:
    """Build a strict consumer and check every selected resolved link."""
    with tempfile.TemporaryDirectory(prefix="libtmux-intersphinx-") as scratch:
        work = Path(scratch)
        mappings = {}
        references = []
        expected = {}
        for index, (path, catalog) in enumerate(catalogs):
            name = f"libtmux{index}"
            base = origin + catalog["base"]
            mappings[name] = (
                (base, origin + prefix + "objects-full.inv")
                if path.parent == root
                else (base, None)
            )
            inventory = records(
                path.parent / ("objects-full.inv" if path.parent == root else "objects.inv"), base
            )
            # One target in every product/category/scope, plus every native object type.
            selected: dict[tuple[str, ...], tuple[str, ...]] = {}
            for target in catalog["targets"]:
                selected.setdefault(
                    (target["scope"], target["product"], target["category"]),
                    ("std:label", target["key"]),
                )
            for kind, key in inventory:
                if kind != "std:label":
                    selected.setdefault((kind,), (kind, key))
                if kind == "cpp:class":
                    selected.setdefault(("cpp:struct-role",), (kind, key, "cpp:struct"))
            for number, reference in enumerate(selected.values()):
                kind, key = reference[:2]
                label = f"Reference {index}-{number}"
                spec = f"external+{name}:{reference[2] if len(reference) > 2 else role(kind)}"
                references.append(
                    f"{{{spec}}}`{label} <{key}>`" if myst else f":{spec}:`{label} <{key}>`"
                )
                expected[label] = inventory[(kind, key)]
            for number, (program, option, href) in enumerate(option_contexts(catalog)):
                label = f"Option {index}-{number}"
                reference = f"{label} <{option}>"
                references.append(
                    f"```{{program}} {program}\n```\n\n"
                    f"{{external+{name}:option}}`{reference}`\n\n```{{program}} None\n```"
                    if myst
                    else f".. program:: {program}\n\n"
                    f":external+{name}:option:`{reference}`\n\n.. program:: None"
                )
                expected[label] = origin + href
        config = {
            "extensions": ["sphinx.ext.intersphinx"] + (["myst_parser"] if myst else []),
            "intersphinx_mapping": mappings,
            "master_doc": "index",
            "project": "Inventory consumer",
            "html_theme": "basic",
            "source_suffix": {".md": "markdown"} if myst else {".rst": "restructuredtext"},
            "intersphinx_cache_limit": 0,
        }
        (work / "conf.py").write_text(
            "\n".join(f"{key} = {value!r}" for key, value in config.items())
        )
        header = (
            "# Inventory consumer\n\n" if myst else "Inventory consumer\n==================\n\n"
        )
        (work / ("index.md" if myst else "index.rst")).write_text(header + "\n\n".join(references))
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "sphinx",
                "-E",
                "-a",
                "-n",
                "-W",
                "--keep-going",
                "-b",
                "html",
                str(work),
                str(work / "html"),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        actual = Page((work / "html/index.html").read_text()).references
        incorrect = {
            label: (href, sorted(actual.get(label, set())))
            for label, href in expected.items()
            if actual.get(label) != {href}
        }
        assert not incorrect, f"Consumer resolved incorrect references: {incorrect}"
        return len(references)


def audit(root: Path, prefix: str, consumers: bool) -> dict[str, AuditValue]:
    """Audit catalog coverage, all destinations and optional real consumers."""
    controls = Page(
        '<!-- <p id="fake"> --><script>let x=\'<b id="fake">\'</script>'
        '<h2 title="A > B" id="real&amp;id">Title</h2>'
        '<i id="duplicate"></i><b id="duplicate"></b>',
        links=False,
    )
    assert controls.ids == Counter({"real&id": 1, "duplicate": 2}), (
        "HTML fragment audit failed its negative controls"
    )
    paths = [root / "targets.json", *sorted(root.glob("*/*/targets.json"))]
    if (root / "tmux/targets.json").is_file():
        paths.append(root / "tmux/targets.json")
    catalogs: list[tuple[Path, Catalog]] = [(path, json.loads(path.read_text())) for path in paths]
    assert catalogs[0][1]["base"] == prefix, (
        "Full inventory catalog has the wrong deployment prefix"
    )
    manifest = json.loads((root / "versions.json").read_text())
    total = 0
    owned_documents = 0
    for path, catalog in catalogs:
        full = path.parent == root
        tmux_default = (
            catalog.get("defaults", {}).get("tmux") if path.parent == root / "tmux" else None
        )
        base = catalog["base"]
        inventory = records(
            path.parent / ("objects-full.inv" if full else "objects.inv"),
            "https://inventory.invalid" + base,
        )
        labels = {key for kind, key in inventory if kind == "std:label"}
        expected = {target["key"] for target in catalog["targets"]}
        for target in catalog["targets"]:
            expected.update(target.get("aliases", []))
            assert target["key"] == target["key"].lower(), (
                f"Label is changed by std:ref: {target['key']}"
            )
            if full and target["scope"] in manifest["ports"]:
                assert target["version"] == manifest["defaultVersion"][target["scope"]], (
                    f"Wrong full-inventory version: {target['key']}"
                )
            if not full:
                if tmux_default:
                    assert target["scope"] == "site" or (
                        target["scope"] == f"tmux@{tmux_default}"
                        and target["version"] == tmux_default
                    ), f"Wrong default tmux target: {target['key']}"
                else:
                    assert target["scope"] == catalog.get("scope") and target[
                        "version"
                    ] == catalog.get("version"), f"Wrong scoped target: {target['key']}"
            assert (
                inventory[("std:label", target["key"])]
                == "https://inventory.invalid" + target["href"]
            ), f"Wrong label URL: {target['key']}"
        assert labels == expected, f"Inventory/catalog label mismatch: {path}"
        for uri in sorted(set(inventory.values())):
            destination(root, prefix, uri)
        total += len(inventory)
        documents = {target["href"] for target in catalog["targets"] if target["category"] == "doc"}
        for file in path.parent.rglob("*.html"):
            relative = file.relative_to(path.parent)
            if full and relative.parts[0] in manifest["ports"]:
                continue  # Scoped catalogs cover all built versions, including nondefaults.
            owner = metadata(file)
            if not owner or owner.get("exclude"):
                continue
            if tmux_default and owner["scope"] not in ("site", f"tmux@{tmux_default}"):
                continue
            assert (
                full
                or tmux_default
                or (
                    owner["scope"] == catalog.get("scope")
                    and owner.get("version") == catalog.get("version")
                )
            ), f"Wrong document ownership: {file}"
            relative_url = relative.as_posix()
            href = base + (
                relative_url.removesuffix("index.html")
                if relative.name == "index.html"
                else relative_url
            )
            assert href in documents, f"Owned document is absent from its inventory: {href}"
            owned_documents += 1
    # Compatibility exports use their historical mapping directory as the base.
    legacy = []
    for path in root.rglob("objects.inv"):
        if (path.parent / "targets.json").is_file() and path.parent != root:
            continue
        if "/api/" in path.as_posix():
            continue
        base = (
            "https://inventory.invalid"
            + prefix
            + path.parent.relative_to(root).as_posix().removeprefix(".").lstrip("/")
        )
        if not base.endswith("/"):
            base += "/"
        items = records(path, base)
        for uri in sorted(set(items.values())):
            destination(root, prefix, uri)
        legacy.append({"path": str(path.relative_to(root)), "records": len(items)})
    result: dict[str, AuditValue] = {
        "catalogs": len(catalogs),
        "records": total,
        "owned_documents": owned_documents,
        "legacy": legacy,
    }
    if consumers:

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urlsplit(self.path)
                path = (root / unquote(parsed.path[len(prefix) :])).resolve()
                if (
                    not parsed.path.startswith(prefix)
                    or not path.is_relative_to(root)
                    or not path.is_file()
                ):
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.end_headers()
                self.wfile.write(path.read_bytes())

            def log_message(self, *args: object, **kwargs: object) -> None:
                """Keep fixture requests out of the audit result."""

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            worker = Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                origin = f"http://127.0.0.1:{server.server_port}"
                result["rst_references"] = consumer(root, prefix, catalogs, origin, False)
                result["myst_references"] = consumer(root, prefix, catalogs, origin, True)
                result["example_references"] = authored_examples(root, prefix, origin)
            finally:
                server.shutdown()
                worker.join()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path, help="Assembled locale directory")
    parser.add_argument(
        "base", help="URL prefix including locale and optional preview, ending in /"
    )
    parser.add_argument(
        "--no-consumers",
        action="store_true",
        help="Audit all files without building the RST/MyST fixtures",
    )
    args = parser.parse_args()
    assert args.base.startswith("/") and args.base.endswith("/")
    print(json.dumps(audit(args.site.resolve(), args.base, not args.no_consumers), indent=2))
