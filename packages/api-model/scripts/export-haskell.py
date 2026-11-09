#!/usr/bin/env python3
"""Export the configured public library through pinned Haddock artifacts."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


class _Node:
    """An inert native-document tree; parsing never loads scripts or assets."""

    def __init__(self, tag="", attrs=(), parent=None):
        self.tag = tag
        self.attrs = dict(attrs)
        self.parent = parent
        self.children = []

    def has(self, name):
        return name in self.attrs.get("class", "").split()

    def walk(self):
        yield self
        for child in self.children:
            if isinstance(child, _Node):
                yield from child.walk()

    def elements(self):
        return [child for child in self.children if isinstance(child, _Node)]

    def text(self):
        if self.has("link") or self.has("selflink"):
            return ""
        return "".join(
            child.text() if isinstance(child, _Node) else child for child in self.children
        )


class _Document(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.root = _Node()
        self.stack = [self.root]
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        node = _Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                self.stack = self.stack[:index]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def _one(nodes, description):
    if len(nodes) != 1:
        msg = f"Expected one {description}, found {len(nodes)}"
        raise ValueError(msg)
    return nodes[0]


def _compact(text):
    return " ".join(text.split())


def _definition(node):
    return _one([item for item in node.walk() if item.has("def")], "public declaration anchor")


def _native_id(module, node):
    anchor = _definition(node).attrs.get("id", "")
    if not re.fullmatch(r"[tv]:.+", anchor):
        msg = f"Unsupported Haddock public anchor: {anchor}"
        raise ValueError(msg)
    return f"{module}#{anchor}"


def extract_modules(pages, installed, exposed, locations, revision):
    """Read public declarations; never infer an interface from implementation text."""
    interfaces = {item["module"].rsplit("$", 1)[-1]: item for item in installed["inst_ifaces"]}
    if len(set(exposed)) != len(exposed) or set(pages) != set(exposed):
        msg = "Public module inputs disagree with the configured component"
        raise ValueError(msg)
    for module in exposed:
        if module not in interfaces or "OptHide" in interfaces[module]["options"]:
            msg = f"Configured public module is absent or hidden: {module}"
            raise ValueError(msg)

    documents = {module: _Document(pages[module]).root for module in exposed}
    page_modules = {module.replace(".", "-") + ".html": module for module in exposed}
    entries = []
    groups = {module: [] for module in exposed}
    for module, document in documents.items():
        interface = _one(
            [node for node in document.walk() if node.attrs.get("id") == "interface"],
            "module interface",
        )
        group = None
        for block in interface.elements():
            if block.attrs.get("id", "").startswith("g:"):
                group = {"title": _compact(block.text()), "members": []}
                groups[module].append(group)
                continue
            if not block.has("top"):
                msg = f"Unsupported direct Haddock interface block: {module}: {block.tag}"
                raise ValueError(msg)
            for subsection in block.walk():
                if not subsection.has("subs"):
                    continue
                parent = subsection.parent
                in_instances = False
                while parent is not None and parent is not block:
                    in_instances = in_instances or parent.has("instances")
                    parent = parent.parent
                if not in_instances and not any(
                    subsection.has(name) for name in ["constructors", "fields", "instances"]
                ):
                    classes = subsection.attrs.get("class")
                    msg = f"Unsupported native declaration subsection: {module}: {classes}"
                    raise ValueError(msg)
            header = _one(
                [node for node in block.elements() if node.tag == "p" and node.has("src")],
                "declaration header",
            )
            identity = _native_id(module, header)
            if identity.split("#", 1)[1].startswith("t:"):
                if not re.match(
                    r"^(?:data|newtype)\s+(?!(?:family|instance)\b)", _compact(header.text())
                ):
                    msg = f"Unsupported native type shape: {identity}"
                    raise ValueError(msg)
                kind = "typealias"
            else:
                if "::" not in header.text():
                    msg = f"Unsupported incomplete native function signature: {identity}"
                    raise ValueError(msg)
                kind = "function"
            entries.append((module, identity, kind, module, header, block))
            if group:
                group["members"].append(identity)
            for constructors in [node for node in block.elements() if node.has("constructors")]:
                for row in [node for node in constructors.walk() if node.tag == "tr"]:
                    entries.extend(
                        (module, _native_id(module, cell), "function", identity, cell, row)
                        for cell in row.elements()
                        if cell.tag == "td" and cell.has("src")
                    )
            for fields in [node for node in block.walk() if node.has("fields")]:
                entries.extend(
                    (module, _native_id(module, field), "property", identity, field, field.parent)
                    for field in fields.walk()
                    if field.tag == "dfn" and field.has("src")
                )

    identities = [identity for _, identity, *_ in entries]
    if len(identities) != len(set(identities)):
        msg = "Duplicate namespace-aware public identity"
        raise ValueError(msg)
    targets = set(identities) | set(exposed)
    for module in exposed:
        observed = Counter(
            _definition(header).text() for owner, _, _, _, header, _ in entries if owner == module
        )
        expected = Counter(
            name.rsplit("$", 1)[-1] for name in interfaces[module]["visible_exports"]
        )
        if observed != expected:
            msg = f"Native declaration and visible-export sets disagree: {module}"
            raise ValueError(msg)

    def link(href, module):
        parsed = urlsplit(href)
        if parsed.scheme or parsed.netloc:
            if parsed.scheme not in {"https", "http", "mailto"}:
                msg = f"Unsupported documentation link scheme: {parsed.scheme}"
                raise ValueError(msg)
            return None
        owner = page_modules.get(parsed.path) if parsed.path else module
        target = owner if not parsed.fragment else f"{owner}#{unquote(parsed.fragment)}"
        if owner is None or target not in targets:
            msg = f"Documentation link has no public target: {module}: {href}"
            raise ValueError(msg)
        return target

    def markdown(node, module):
        if isinstance(node, str):
            return node
        content = "".join(markdown(child, module) for child in node.children)
        if node.tag == "a" and "href" in node.attrs:
            target = link(node.attrs["href"], module)
            return (
                f":obj:`{_compact(node.text())} <{target}>`"
                if target
                else f"[{_compact(node.text())}]({node.attrs['href']})"
            )
        if node.tag == "code":
            return content if any(item.tag == "a" for item in node.walk()) else f"`{node.text()}`"
        if node.tag == "pre":
            return "\n\n```haskell\n" + node.text().strip("\n") + "\n```\n\n"
        if node.tag in {"p", "div", "td"}:
            return content.strip() + "\n\n"
        if node.tag in {"strong", "b"}:
            return f"**{content}**"
        if node.tag in {"em", "i"}:
            return f"*{content}*"
        if node.tag == "br":
            return "\n"
        if node.tag == "ul":
            return "\n" + content + "\n"
        if node.tag == "li":
            return "- " + content.strip() + "\n"
        if node.tag in {"h1", "h2", "h3", "h4"}:
            return "\n\n### " + content + "\n\n"
        if node.tag not in {"a", "span"}:
            msg = f"Unsupported authored Haddock markup: {node.tag}"
            raise ValueError(msg)
        return content

    def signature(header, module, constructor=False):
        spans = []
        pending_space = False

        def append(character, metadata):
            if (
                spans
                and {key: value for key, value in spans[-1].items() if key != "text"} == metadata
            ):
                spans[-1]["text"] += character
            else:
                spans.append({"text": character, **metadata})

        def text(value, metadata):
            nonlocal pending_space
            for character in value:
                if character.isspace():
                    pending_space = True
                    continue
                if pending_space and spans:
                    append(" ", {})
                pending_space = False
                append(character, metadata)

        def walk(node, inherited=None):
            metadata = inherited or {}
            if isinstance(node, str):
                text(node, metadata)
                return
            if node.has("link") or node.has("selflink"):
                return
            if node.has("def"):
                metadata = {**metadata, "declaration": True}
            if node.has("keyword"):
                metadata = {**metadata, "keyword": True}
            if node.tag == "a" and "href" in node.attrs:
                href = node.attrs["href"]
                target = link(href, module)
                metadata = {**metadata, "href": href, **({"target": target} if target else {})}
            for child in node.children:
                walk(child, metadata)

        walk(header)
        raw = _compact(header.text())
        if "".join(span["text"] for span in spans) != raw:
            msg = f"Native signature spans disagree with their declaration: {module}: {raw}"
            raise ValueError(msg)
        return {
            "raw": raw,
            "params": [],
            "nativeSpans": spans,
            **({"methodKind": "constructor"} if constructor else {}),
        }

    def documentation(container, module):
        docs = [node for node in container.elements() if node.has("doc")]
        if not docs:
            return None
        body = markdown(_one(docs, "authored documentation block"), module).strip()
        paragraphs = body.split("\n\n", 1)
        return (
            {"summary": paragraphs[0], **({"body": paragraphs[1]} if len(paragraphs) == 2 else {})}
            if body
            else None
        )

    def source(module, name, href=None):
        result = {"file": "src/" + module.replace(".", "/") + ".hs", "revision": revision}
        if href and urlsplit(href).path != f"src/{module}.html":
            msg = f"Unsupported cross-module native source: {module}: {href}"
            raise ValueError(msg)
        anchor = unquote(urlsplit(href).fragment) if href else name
        if anchor.startswith("line-"):
            matches = [int(anchor[5:])]
        else:
            matches = locations[module].get(anchor, [])
        if matches and len(set(matches)) == 1:
            result["line"] = matches[0]
        return result

    symbols = []
    for module, document in documents.items():
        description = _one(
            [node for node in document.walk() if node.attrs.get("id") == "description"],
            "module description",
        )
        symbols.append(
            {
                "id": module,
                "name": module,
                "kind": "module",
                "parent": None,
                "modifiers": [],
                "signatures": [],
                "doc": documentation(description, module),
                "source": source(module, ""),
                "package": "libtmux-haskell",
                "product": "core",
                "apiScope": "exported",
            }
        )
    for module, identity, kind, parent, header, block in entries:
        name = _definition(header).text()
        symbol = {
            "id": identity,
            "publicId": identity,
            "qualifiedName": f"{module}.{name}",
            "name": name,
            "namespace": module,
            "kind": kind,
            "parent": parent,
            "modifiers": [],
            "signatures": [signature(header, module, kind == "function" and parent != module)],
            "doc": documentation(block, module),
            "source": source(
                module,
                name,
                next((node.attrs["href"] for node in header.walk() if node.has("link")), None),
            ),
            "package": "libtmux-haskell",
            "product": "core",
            "apiScope": "exported",
        }
        if kind == "typealias":
            constructors = [node for node in block.elements() if node.has("constructors")]
            if not constructors and _compact(header.text()).startswith(("data ", "newtype ")):
                symbol["modifiers"].append("opaque")
            instances = []
            for section in [node for node in block.elements() if node.has("instances")]:
                for row in [node for node in section.walk() if node.tag == "tr"]:
                    cells = [
                        node for node in row.elements() if node.tag == "td" and node.has("src")
                    ]
                    if not cells:
                        continue
                    heads = [node for node in cells[0].walk() if node.has("inst-left")]
                    head = _one(heads, "instance declaration head")
                    if not _compact(head.text()):
                        msg = "Empty native instance declaration"
                        raise ValueError(msg)
                    references = []
                    for node in head.walk():
                        if node.tag == "a" and "href" in node.attrs:
                            target = link(node.attrs["href"], module)
                            references.append(
                                {
                                    "text": _compact(node.text()),
                                    "href": node.attrs["href"],
                                    **({"target": target} if target else {}),
                                }
                            )
                    sources = [node.attrs["href"] for node in cells[0].walk() if node.has("link")]
                    instances.append(
                        {
                            "raw": "instance " + _compact(head.text()),
                            "markdown": "instance " + markdown(head, module).strip(),
                            "references": references,
                            "source": source(
                                module, name, _one(sources, "instance source") if sources else None
                            ),
                            "doc": documentation(row, module),
                        }
                    )
            symbol["instances"] = instances
        symbols.append(symbol)
    return {
        "modules": [{"name": module, "groups": groups[module]} for module in exposed],
        "symbols": symbols,
    }


class _SourceLocations(HTMLParser):
    """Index native source anchors without interpreting Haskell source text."""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.line = 1
        self.locations = {}
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        anchor = dict(attrs).get("id", "")
        if anchor.startswith("line-"):
            self.line = int(anchor[5:])
        elif anchor:
            self.locations.setdefault(anchor, []).append(self.line)


def _command(arguments, cwd):
    result = subprocess.run(
        arguments, cwd=cwd, capture_output=True, text=True, timeout=60, check=False
    )
    if result.returncode:
        msg = f"Command failed: {arguments[0]}\n{result.stdout}\n{result.stderr}"
        raise RuntimeError(msg)
    return result


def _git(checkout, *arguments):
    return _command(["git", "-C", str(checkout), *arguments], checkout).stdout.strip()


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _checked_component(plan, source_root, registration):
    if (
        plan.get("compiler-id") != "ghc-9.14.1"
        or plan.get("os") != "linux"
        or plan.get("arch") != "x86_64"
        or plan.get("cabal-version") != "3.18.2.0"
        or plan.get("cabal-lib-version") != "3.18.2.0"
    ):
        msg = "Actual Cabal build identity differs from the qualified toolchain"
        raise ValueError(msg)
    component = _one(
        [
            item
            for item in plan.get("install-plan", [])
            if item.get("pkg-name") == "libtmux-haskell" and item.get("component-name") == "lib"
        ],
        "selected public library component",
    )
    if (
        component.get("type") != "configured"
        or component.get("style") != "local"
        or component.get("id") != registration["id"]
        or component.get("pkg-name") != registration["name"]
        or component.get("pkg-version") != registration["version"]
        or component.get("pkg-src", {}).get("type") != "local"
        or Path(component.get("pkg-src", {}).get("path", "")).resolve()
        != Path(source_root).resolve()
    ):
        msg = "Registered library component does not match the selected committed source"
        raise ValueError(msg)
    return component


def build_native(checkout, revision):
    """Build committed source in isolation and extract its configured public API."""
    checkout = Path(checkout).resolve()
    if (
        not re.fullmatch(r"[a-f0-9]{40}", revision)
        or _git(checkout, "rev-parse", f"{revision}^{{commit}}") != revision
    ):
        msg = "Library source must name an existing full commit"
        raise ValueError(msg)
    tools = {}
    for name in ["ghc", "ghc-pkg", "haddock", "cabal"]:
        path = shutil.which(name)
        if path is None:
            msg = f"The qualified native documentation tool is unavailable: {name}"
            raise ValueError(msg)
        tools[name] = str(Path(path).absolute())
    ghc = _command([tools["ghc"], "--numeric-version"], checkout).stdout.strip()
    haddock = _command([tools["haddock"], "--version"], checkout).stdout.strip()
    cabal = _command([tools["cabal"], "--numeric-version"], checkout).stdout.strip()
    if (
        ghc != "9.14.1"
        or not re.match(r"Haddock version 2\.33\.0(?:\s|,)", haddock)
        or cabal != "3.18.2.0"
    ):
        msg = (
            "Native export requires the qualified GHC 9.14.1/"
            "Haddock 2.33.0/Cabal 3.18.2.0 toolchain"
        )
        raise ValueError(msg)
    if (
        _command([tools["ghc-pkg"], "--version"], checkout).stdout.strip()
        != "GHC package manager version 9.14.1"
        or _command([tools["haddock"], "--ghc-version"], checkout).stdout.strip() != ghc
    ):
        msg = "Native package and documentation tools use a different compiler"
        raise ValueError(msg)
    archive = subprocess.check_output(["git", "-C", str(checkout), "archive", revision])
    with tempfile.TemporaryDirectory(prefix="libtmux-haskell-export-") as directory:
        source_root = Path(directory, "source")
        source_root.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as source_archive:
            source_archive.extractall(source_root, filter="data")
        pins = dict(
            line.split()
            for line in (source_root / ".tool-versions").read_text().splitlines()
            if line.strip()
        )
        if pins.get("ghc") != ghc or pins.get("cabal") != cabal:
            msg = "Selected library toolchain pins disagree with the exporter"
            raise ValueError(msg)
        build = Path(directory, "build")
        _command(
            [
                tools["cabal"],
                "haddock",
                "lib:libtmux-haskell",
                "--offline",
                f"--builddir={build}",
                f"--with-compiler={tools['ghc']}",
                f"--with-hc-pkg={tools['ghc-pkg']}",
                f"--with-haddock={tools['haddock']}",
            ],
            source_root,
        )
        interfaces = list(build.rglob("libtmux-haskell.haddock"))
        interface = _one(interfaces, "configured library Haddock interface")
        package_configs = list(build.rglob("libtmux-haskell-*-inplace.conf"))
        package_config = _one(package_configs, "configured library package registration")

        def field(name):
            return _command(
                [
                    tools["ghc-pkg"],
                    "--package-db",
                    str(package_config.parent),
                    "field",
                    "libtmux-haskell",
                    name,
                    "--simple-output",
                ],
                source_root,
            ).stdout.strip()

        registration = {name: field(name) for name in ["name", "version", "id"]}
        plan = json.loads((build / "cache/plan.json").read_text())
        component = _checked_component(plan, source_root, registration)
        if not interface.is_relative_to(Path(component["dist-dir"])):
            msg = "Native interface is outside the selected library build"
            raise ValueError(msg)
        modules = field("exposed-modules").split()
        if not modules or any(
            not re.fullmatch(r"[A-Z][\w']*(?:\.[A-Z][\w']*)*", module) for module in modules
        ):
            msg = "Unsupported configured public module or re-export shape"
            raise ValueError(msg)
        shown = _command([tools["haddock"], f"--show-interface={interface}"], source_root)
        if bool(shown.stdout.strip()) == bool(shown.stderr.strip()):
            msg = "Expected one complete native JSON interface stream"
            raise ValueError(msg)
        native_json = shown.stdout if shown.stdout.strip() else shown.stderr
        installed = json.loads(native_json)
        if installed.get("package_info") != f"{registration['name']}-{registration['version']}":
            msg = "Native interface package differs from its registered library"
            raise ValueError(msg)
        for item in installed["inst_ifaces"]:
            if (
                item["module"].rsplit("$", 1)[-1] in modules
                and item["info"].get("language") != "GHC2024"
            ):
                msg = "Public native interface does not use the selected GHC2024 edition"
                raise ValueError(msg)
        rendered = {
            module: (interface.parent / (module.replace(".", "-") + ".html")).read_text()
            for module in modules
        }
        source_pages = {
            module: (interface.parent / "src" / (module + ".html")).read_text()
            for module in modules
        }
        locations = {
            module: _SourceLocations(text).locations for module, text in source_pages.items()
        }
        result = extract_modules(rendered, installed, modules, locations, revision)
        files = [".tool-versions", "cabal.project", "libtmux-haskell.cabal"]
        files.extend("src/" + module.replace(".", "/") + ".hs" for module in modules)
        native_files = {
            "interface.haddock": interface.read_bytes(),
            "interface.json": native_json.encode(),
        }
        native_files.update(
            {module.replace(".", "-") + ".html": text.encode() for module, text in rendered.items()}
        )
        native_files.update(
            {"src/" + module + ".html": text.encode() for module, text in source_pages.items()}
        )
        return {
            "schema": "libtmux.haskell-api/1",
            "port": "haskell",
            "repo": "libtmux/libtmux-haskell",
            "revision": revision,
            "compiler": ghc,
            "haddock": "2.33.0",
            "component": "lib:libtmux-haskell",
            "package": {
                "name": registration["name"],
                "version": registration["version"],
                "exposedModules": modules,
            },
            "nativeProvenance": {
                "files": [
                    {"path": name, "sha256": _sha256((source_root / name).read_bytes())}
                    for name in files
                ],
                "exporter": {
                    "name": "Haddock public interface export",
                    "version": 1,
                    "build": {
                        "compiler": plan["compiler-id"],
                        "cabal": plan["cabal-version"],
                        "unit": registration["id"],
                        "platform": f"{plan['arch']}-{plan['os']}",
                    },
                    "nativeArtifacts": [
                        {"path": name, "sha256": _sha256(data)}
                        for name, data in sorted(native_files.items())
                    ],
                    "interfaceStream": "stdout" if shown.stdout.strip() else "stderr",
                },
            },
            **result,
        }


def _exporter_identity():
    script = Path(__file__).resolve()
    root = Path(_git(script.parent, "rev-parse", "--show-toplevel"))
    relative = script.relative_to(root).as_posix()
    revision = _git(root, "log", "-1", "--format=%H", "--", relative)
    if not re.fullmatch(r"[a-f0-9]{40}", revision):
        msg = "Commit the reviewed exporter before producing a qualified artifact"
        raise ValueError(msg)
    committed = subprocess.check_output(["git", "-C", str(root), "show", f"{revision}:{relative}"])
    if committed != script.read_bytes():
        msg = "Exporter bytes differ from their committed revision"
        raise ValueError(msg)
    return {
        "repository": "libtmux/docs",
        "revision": revision,
        "path": relative,
        "sha256": _sha256(committed),
    }


def main():
    """Write a source-bound native artifact without changing either repository."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    exporter = _exporter_identity()
    artifact = build_native(arguments.checkout, arguments.source_revision)
    artifact["nativeProvenance"]["exporter"].update(exporter)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    )
    print(
        json.dumps(
            {
                "port": "haskell",
                "revision": artifact["revision"],
                "exporterRevision": exporter["revision"],
                "symbols": len(artifact["symbols"]),
            }
        )
    )


if __name__ == "__main__":
    main()
