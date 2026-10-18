#!/usr/bin/env python3
"""Audit assembled inventory destinations and build strict Sphinx/MyST consumers."""
from __future__ import annotations

import argparse
from collections import Counter
from functools import lru_cache
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from threading import Thread
from urllib.parse import unquote, urljoin, urlsplit

from sphinx.util.inventory import InventoryFile

RAW_TEXT = re.compile(r'<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?</\1\s*>', re.IGNORECASE)
TAG = re.compile(r'''<[A-Za-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>''')
ID_ATTRIBUTE = re.compile(r'(?:\s)id\s*=', re.IGNORECASE)


class Page(HTMLParser):
    def __init__(self, html: str, links: bool = True):
        super().__init__(convert_charrefs=True)
        self.ids: Counter[str] = Counter()
        self.links: set[str] = set()
        self.collect_links = links
        if links:
            self.feed(html)
        else:
            # Parse attributes with HTMLParser, avoiding millions of highlight spans.
            for match in TAG.finditer(RAW_TEXT.sub('', html)):
                tag = match.group()
                if ID_ATTRIBUTE.search(tag):
                    self.feed(tag)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.ids[attrs["id"]] += 1
        if self.collect_links and tag == "a" and attrs.get("href"):
            self.links.add(attrs["href"])


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.value = None
        self.done = False
        self.shell_export = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "html" and "data-native-shell-export" in attrs:
            self.shell_export = True
        if tag == "meta" and attrs.get("name") == "libtmux-inventory":
            self.value = json.loads(attrs["content"])

    def handle_endtag(self, tag):
        if tag == "head":
            self.done = True


def metadata(path: Path):
    parser = Metadata()
    with path.open() as source:
        while chunk := source.read(4096):
            parser.feed(chunk)
            if parser.value is not None or parser.done:
                break
    return None if parser.shell_export else parser.value


@lru_cache(maxsize=None)
def page(path: Path) -> Page:
    return Page(path.read_text(), links=False)


def destination(root: Path, prefix: str, url: str):
    parsed = urlsplit(url)
    assert parsed.path.startswith(prefix), f"Inventory URL escapes {prefix}: {url}"
    path = root / unquote(parsed.path[len(prefix):])
    if parsed.path.endswith("/"):
        path /= "index.html"
    path = path.resolve()
    assert path.is_relative_to(root), f"Inventory URL escapes output: {url}"
    assert path.is_file(), f"Missing inventory page: {url}"
    if parsed.fragment:
        fragment = unquote(parsed.fragment)
        assert page(path).ids[fragment] == 1, f"Missing or duplicate inventory fragment: {url}"


def records(path: Path, base: str):
    with path.open("rb") as source:
        inventory = InventoryFile.load(source, base, urljoin)
    return {(kind, name): item for kind, items in inventory.items() for name, item in items.items()}


ROLE = {"std:label": "ref", "std:doc": "doc", "std:term": "term", "std:confval": "confval",
        "std:cmdoption": "option", "std:envvar": "envvar", "std:token": "token"}
for domain in ("py", "js"):
    for kind, spelling in {"function": "func", "method": "meth", "attribute": "attr", "module": "mod"}.items():
        ROLE[f"{domain}:{kind}"] = f"{domain}:{spelling}"
ROLE["py:exception"] = "py:exc"


def role(kind: str) -> str:
    return ROLE.get(kind, kind.replace(":function", ":func").replace(":attribute", ":attr").replace("cpp:member", "cpp:var"))


def consumer(root: Path, prefix: str, catalogs: list[tuple[Path, dict]], origin: str, myst: bool):
    with tempfile.TemporaryDirectory(prefix="libtmux-intersphinx-") as scratch:
        work = Path(scratch)
        mappings = {}
        references = []
        expected = set()
        for index, (path, catalog) in enumerate(catalogs):
            name = f"libtmux{index}"
            base = origin + catalog["base"]
            mappings[name] = (base, origin + prefix + "objects-full.inv") if path.parent == root else (base, None)
            inventory = records(path.parent / ("objects-full.inv" if path.parent == root else "objects.inv"), base)
            # One target in every product/category/scope, plus every native object type.
            selected = {}
            for target in catalog["targets"]:
                selected.setdefault((target["scope"], target["product"], target["category"]), ("std:label", target["key"]))
            for kind, key in inventory:
                if kind != "std:label":
                    selected.setdefault((kind,), (kind, key))
                if kind == "cpp:class":
                    selected.setdefault(("cpp:struct-role",), (kind, key, "cpp:struct"))
            for number, reference in enumerate(selected.values()):
                kind, key = reference[:2]
                label = f"Reference {index}-{number}"
                spec = f"external+{name}:{reference[2] if len(reference) > 2 else role(kind)}"
                references.append(f"{{{spec}}}`{label} <{key}>`" if myst else f":{spec}:`{label} <{key}>`")
                expected.add(inventory[(kind, key)].uri)
        config = {
            "extensions": ["sphinx.ext.intersphinx"] + (["myst_parser"] if myst else []),
            "intersphinx_mapping": mappings,
            "master_doc": "index",
            "project": "Inventory consumer",
            "html_theme": "basic",
            "source_suffix": {".md": "markdown"} if myst else {".rst": "restructuredtext"},
            "intersphinx_cache_limit": 0,
        }
        (work / "conf.py").write_text("\n".join(f"{key} = {value!r}" for key, value in config.items()))
        header = "# Inventory consumer\n\n" if myst else "Inventory consumer\n==================\n\n"
        (work / ("index.md" if myst else "index.rst")).write_text(header + "\n\n".join(references))
        result = subprocess.run([sys.executable, "-m", "sphinx", "-E", "-a", "-n", "-W", "--keep-going", "-b", "html", str(work), str(work / "html")], text=True, capture_output=True)
        assert result.returncode == 0, result.stdout + result.stderr
        actual = Page((work / "html/index.html").read_text()).links
        assert expected <= actual, f"Consumer resolved incorrect URLs: {sorted(expected - actual)[:10]}"
        return len(references)


def audit(root: Path, prefix: str, consumers: bool):
    controls = Page('<!-- <p id="fake"> --><script>let x=\'<b id="fake">\'</script><h2 title="A > B" id="real&amp;id">Title</h2><i id="duplicate"></i><b id="duplicate"></b>', links=False)
    assert controls.ids == Counter({'real&id': 1, 'duplicate': 2}), 'HTML fragment audit failed its negative controls'
    paths = [root / "targets.json", *sorted(root.glob("*/*/targets.json"))]
    catalogs = [(path, json.loads(path.read_text())) for path in paths]
    assert catalogs[0][1]["base"] == prefix, "Full inventory catalog has the wrong deployment prefix"
    manifest = json.loads((root / "versions.json").read_text())
    total = 0
    owned_documents = 0
    for path, catalog in catalogs:
        full = path.parent == root
        base = catalog["base"]
        inventory = records(path.parent / ("objects-full.inv" if full else "objects.inv"), "https://inventory.invalid" + base)
        labels = {key for kind, key in inventory if kind == "std:label"}
        expected = {target["key"] for target in catalog["targets"]}
        for target in catalog["targets"]:
            expected.update(target.get("aliases", []))
            assert target["key"] == target["key"].lower(), f"Label is changed by std:ref: {target['key']}"
            if full and target["scope"] in manifest["ports"]:
                assert target["version"] == manifest["defaultVersion"][target["scope"]], f"Wrong full-inventory version: {target['key']}"
            if not full:
                assert target["scope"] == catalog["scope"] and target["version"] == catalog["version"], f"Wrong scoped target: {target['key']}"
            assert inventory[("std:label", target["key"])].uri == "https://inventory.invalid" + target["href"], f"Wrong label URL: {target['key']}"
        assert labels == expected, f"Inventory/catalog label mismatch: {path}"
        for uri in sorted({item.uri for item in inventory.values()}):
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
            assert full or (owner["scope"] == catalog["scope"] and owner.get("version") == catalog["version"]), f"Wrong document ownership: {file}"
            relative_url = relative.as_posix()
            href = base + (relative_url.removesuffix("index.html") if relative.name == "index.html" else relative_url)
            assert href in documents, f"Owned document is absent from its inventory: {href}"
            owned_documents += 1
    # Compatibility exports use their historical mapping directory as the base.
    legacy = []
    for path in root.rglob("objects.inv"):
        if (path.parent / "targets.json").is_file() and path.parent != root:
            continue
        if "/api/" in path.as_posix():
            continue
        base = "https://inventory.invalid" + prefix + path.parent.relative_to(root).as_posix().removeprefix(".").lstrip("/")
        if not base.endswith("/"):
            base += "/"
        items = records(path, base)
        for uri in sorted({item.uri for item in items.values()}):
            destination(root, prefix, uri)
        legacy.append({"path": str(path.relative_to(root)), "records": len(items)})
    result = {"catalogs": len(catalogs), "records": total, "owned_documents": owned_documents, "legacy": legacy}
    if consumers:
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urlsplit(self.path)
                path = (root / unquote(parsed.path[len(prefix):])).resolve()
                if not parsed.path.startswith(prefix) or not path.is_relative_to(root) or not path.is_file():
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.end_headers()
                self.wfile.write(path.read_bytes())

            def log_message(self, *_args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            worker = Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                origin = f"http://127.0.0.1:{server.server_port}"
                result["rst_references"] = consumer(root, prefix, catalogs, origin, False)
                result["myst_references"] = consumer(root, prefix, catalogs, origin, True)
            finally:
                server.shutdown()
                worker.join()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path, help="Assembled locale directory")
    parser.add_argument("base", help="URL prefix including locale and optional preview, ending in /")
    parser.add_argument("--no-consumers", action="store_true", help="Audit all files without building the RST/MyST fixtures")
    args = parser.parse_args()
    assert args.base.startswith("/") and args.base.endswith("/")
    print(json.dumps(audit(args.site.resolve(), args.base, not args.no_consumers), indent=2))
