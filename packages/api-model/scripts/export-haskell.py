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

SCALAR_MODULES = ["LibTmux.Id", "LibTmux.Value", "LibTmux.Version"]
OBSERVATION_MODULES = [
    "LibTmux",
    "LibTmux.Id",
    "LibTmux.Server",
    "LibTmux.Snapshot",
    "LibTmux.Snapshot.Fixture",
    "LibTmux.Value",
    "LibTmux.Version",
]
OBSERVATION_ORIGINS = OBSERVATION_MODULES + [
    "LibTmux.Internal." + name
    for name in ["Capture", "Graph", "Runtime", "Scheduler", "Scope", "TmuxText"]
]

QUERY_MODULES = sorted(
    OBSERVATION_MODULES
    + ["LibTmux.Query"]
    + [
        "LibTmux.Query." + name
        for name in [
            "Client",
            "ClientAttachment",
            "Link",
            "Occurrence",
            "Pane",
            "ServerInfo",
            "Session",
            "Window",
        ]
    ]
)
QUERY_ORIGINS = QUERY_MODULES + [
    "LibTmux.Internal." + name
    for name in ["Capture", "Field", "Graph", "Query", "Runtime", "Scheduler", "Scope", "TmuxText"]
]
MUTATION_ORIGINS = [*QUERY_ORIGINS, "LibTmux.Internal.Mutation"]
CREATION_MODULES = sorted([*QUERY_MODULES, "LibTmux.Creation"])
CREATION_ORIGINS = [
    *CREATION_MODULES,
    *(module for module in MUTATION_ORIGINS if module not in QUERY_MODULES),
    "LibTmux.Internal.Creation",
]


def _source_file(module):
    prefix = "internal/" if module.startswith("LibTmux.Internal.") else "src/"
    return prefix + module.replace(".", "/") + ".hs"


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


def _native_id(module, node, namespace=None):
    definition = _definition(node)
    anchor = definition.attrs.get("id", "")
    if not re.fullmatch(r"[tv]:.+", anchor) or (
        namespace is not None and anchor != f"{namespace}:{definition.text()}"
    ):
        msg = f"Unsupported Haddock public anchor: {anchor}"
        raise ValueError(msg)
    return f"{module}#{anchor}"


def _opaque_fields(block, owner, source_pages, source_documents, locations, qualified_definitions):
    """Bind authored field anchors to GHC's record-owner/type annotations."""
    docs = [node for node in block.elements() if node.has("doc")]
    terms = [node for doc in docs for node in doc.walk() if node.tag == "dt"]
    if not terms:
        return []
    href = _one(
        [node.attrs["href"] for node in block.elements()[0].walk() if node.has("link")],
        "opaque record source link",
    )
    match = re.fullmatch(r"src/([A-Z][\w.]*)\.html#[^#]+", href)
    if match is None or match[1] not in source_pages:
        msg = "Missing opaque field source page"
        raise ValueError(msg)
    origin = match[1]
    if origin not in source_documents:
        source_documents[origin] = _Document(source_pages[origin]).root

    def clone(node, parent):
        if isinstance(node, str):
            return node
        result = _Node(node.tag, node.attrs.items(), parent)
        result.children = [clone(child, result) for child in node.children]
        return result

    fields = []
    for term in terms:
        elements = term.elements()
        if (
            len(elements) != 3
            or elements[0].tag != "a"
            or elements[1].tag != "code"
            or not re.fullmatch(r"v:[A-Za-z_][\w']*", elements[0].attrs.get("id", ""))
        ):
            msg = "Unqualified opaque field documentation"
            raise ValueError(msg)
        name = elements[0].attrs["id"][2:]
        if elements[0].text() or elements[1].text() != name:
            msg = "Opaque field anchor and label disagree"
            raise ValueError(msg)
        anchors = [node for node in source_documents[origin].walk() if node.attrs.get("id") == name]
        lines = locations[origin].get(name, [])
        if len(anchors) != len(lines):
            msg = "Opaque field source anchors disagree"
            raise ValueError(msg)
        annotations = [
            (_compact(annotation.text()), line)
            for anchor, line in zip(anchors, lines, strict=True)
            for annotation in anchor.walk()
            if annotation.has("annottext")
            and _compact(annotation.text()).startswith(owner + " -> ")
        ]
        annotation, line = _one(annotations, "opaque field annotation")
        value = annotation.removeprefix(owner + " -> ")
        if _compact(term.text()) != f"{name} :: {value}":
            msg = "Opaque field documentation differs from its native type annotation"
            raise ValueError(msg)
        index = term.parent.elements().index(term)
        siblings = term.parent.elements()
        if index + 1 >= len(siblings) or siblings[index + 1].tag != "dd":
            msg = "Opaque field has no native documentation body"
            raise ValueError(msg)
        row = _Node("div")
        header = _Node("dfn", [("class", "src")], row)
        binder = _Node("a", [("class", "def"), ("id", "v:" + name)], header)
        binder.children = [name]
        header.children = [binder] + [
            clone(child, header) for child in term.children[term.children.index(elements[1]) + 1 :]
        ]
        source = _Node("a", [("class", "link"), ("href", f"src/{origin}.html#line-{line}")], header)
        header.children.append(source)
        doc = _Node("div", [("class", "doc")], row)
        doc.children = [clone(child, doc) for child in siblings[index + 1].children]
        row.children = [header, doc]
        fields.append((name, header, row))
        qualified_definitions.update(map(id, [term.parent, term, siblings[index + 1]]))
    return fields


def extract_modules(pages, installed, exposed, locations, revision, source_pages=None):
    """Read public declarations; never infer an interface from implementation text."""
    interfaces = {item["module"].rsplit("$", 1)[-1]: item for item in installed["inst_ifaces"]}
    if len(set(exposed)) != len(exposed) or set(pages) != set(exposed):
        msg = "Public module inputs disagree with the configured component"
        raise ValueError(msg)
    for module in exposed:
        if module not in interfaces or "OptHide" in interfaces[module]["options"]:
            msg = f"Configured public module is absent or hidden: {module}"
            raise ValueError(msg)
    observations = "LibTmux" in exposed
    creations = exposed == CREATION_MODULES
    rich = exposed in [QUERY_MODULES, CREATION_MODULES]
    if observations and exposed not in [OBSERVATION_MODULES, QUERY_MODULES, CREATION_MODULES]:
        msg = "Unqualified observation module profile"
        raise ValueError(msg)
    mutations = "LibTmux.Internal.Mutation" in interfaces
    if creations and not mutations:
        msg = "Unqualified creation recovery interface"
        raise ValueError(msg)
    if mutations and not rich:
        msg = "Unqualified mutation module profile"
        raise ValueError(msg)
    source_modules = (
        CREATION_ORIGINS
        if creations
        else MUTATION_ORIGINS
        if mutations
        else QUERY_ORIGINS
        if exposed == QUERY_MODULES
        else OBSERVATION_ORIGINS
        if observations
        else exposed
    )
    if set(locations) != set(source_modules):
        msg = "Native source inputs differ from the qualified source profile"
        raise ValueError(msg)
    if creations and (source_pages is None or set(source_pages) != set(source_modules)):
        msg = "Native field source pages differ from the qualified source profile"
        raise ValueError(msg)

    documents = {module: _Document(pages[module]).root for module in exposed}
    page_modules = {module.replace(".", "-") + ".html": module for module in exposed}
    entries = []
    groups = {module: [] for module in exposed}
    reexports = {module: [] for module in exposed}
    source_documents = {}
    qualified_definitions = set()
    for module, document in documents.items():
        interface = _one(
            [node for node in document.walk() if node.attrs.get("id") == "interface"],
            "module interface",
        )
        group = None
        for block in interface.elements():
            if (
                observations
                and (module == "LibTmux" or rich)
                and block is interface.elements()[0]
                and block.tag == "h1"
                and block.text() == "Documentation"
                and not block.elements()
            ):
                if module != "LibTmux":
                    group = {"title": block.text(), "members": []}
                    groups[module].append(group)
                continue
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
            if observations and _compact(header.text()).startswith("module "):
                links = [node for node in header.walk() if node.tag == "a"]
                target = page_modules.get(links[0].attrs.get("href")) if len(links) == 1 else None
                if (
                    module != "LibTmux"
                    or target is None
                    or target == module
                    or _compact(header.text()) != f"module {target}"
                    or len(block.elements()) != 1
                    or target in [item["module"] for item in reexports[module]]
                ):
                    msg = f"Unsupported or repeated native module reexport: {module}"
                    raise ValueError(msg)
                reexports[module].append({"module": target, "href": links[0].attrs["href"]})
                continue
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
                        (module, _native_id(module, cell, "v"), "function", identity, cell, row)
                        for cell in row.elements()
                        if cell.tag == "td" and cell.has("src")
                    )
            for fields in [node for node in block.walk() if node.has("fields")]:
                for field in fields.walk():
                    if field.tag != "dfn" or not field.has("src"):
                        continue
                    native_id = _native_id(module, field, "v" if observations else None)
                    field_id = (
                        f"{module}#v:{identity.split('#t:', 1)[1]}.{_definition(field).text()}"
                        if observations
                        else native_id
                    )
                    entries.append((module, field_id, "property", identity, field, field.parent))
            # Haddock indexes exported labels but omits their declarations when
            # the record constructor is hidden. Check the source annotations.
            if (
                creations
                and kind == "typealias"
                and not any(node.has("constructors") for node in block.elements())
            ):
                for name, field, row in _opaque_fields(
                    block,
                    _definition(header).text(),
                    source_pages,
                    source_documents,
                    locations,
                    qualified_definitions,
                ):
                    field_id = f"{module}#v:{_definition(header).text()}.{name}"
                    entries.append((module, field_id, "property", identity, field, row))

    identities = [identity for _, identity, *_ in entries]
    if len(identities) != len(set(identities)):
        msg = "Duplicate namespace-aware public identity"
        raise ValueError(msg)
    native_targets = {module: [module] for module in exposed}
    entry_origins = {}
    for module, identity, _, parent, header, _ in entries:
        anchor = _definition(header).attrs["id"]
        native_targets.setdefault(f"{module}#{anchor}", []).append(identity)
        href = next((node.attrs["href"] for node in header.walk() if node.has("link")), None)
        origin = entry_origins.get(parent, module)
        if href:
            parsed = urlsplit(href)
            matches = [name for name in source_modules if parsed.path == f"src/{name}.html"]
            if len(matches) != 1 or parsed.scheme or parsed.netloc or parsed.query:
                msg = f"Unsupported cross-module native source: {module}: {href}"
                raise ValueError(msg)
            origin = matches[0]
        entry_origins[identity] = origin
    for module in exposed:
        observed = Counter(
            (
                (
                    f"${installed['package_info']}-inplace${entry_origins[identity]}$"
                    + _definition(header).text()
                )
                if observations
                else _definition(header).text()
            )
            for owner, identity, _, _, header, _ in entries
            if owner == module
        )
        expected = Counter(
            (name if observations else name.rsplit("$", 1)[-1])
            for name in interfaces[module]["visible_exports"]
        )
        if observed != expected:
            msg = f"Native declaration and visible-export sets disagree: {module}"
            raise ValueError(msg)
        if observations:
            for name in interfaces[module]["visible_exports"]:
                if installed["link_env"].get(name) != module:
                    owners = {
                        owner
                        for owner, identity, kind, _, header, _ in entries
                        if kind == "property"
                        and name
                        == (
                            f"${installed['package_info']}-inplace${entry_origins[identity]}$"
                            + _definition(header).text()
                        )
                    }
                    # The interface names omit the record owner for shared labels.
                    if (
                        not creations
                        or module not in owners
                        or installed["link_env"].get(name) not in owners
                    ):
                        msg = f"Compiled public owner differs: {module}: {name}"
                        raise ValueError(msg)
            expanded = Counter(interfaces[module]["visible_exports"])
            for item in reexports[module]:
                expanded.update(interfaces[item["module"]]["exports"])
            if expanded != Counter(interfaces[module]["exports"]):
                msg = f"Native module reexports disagree with compiled exports: {module}"
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
        choices = native_targets.get(target, [])
        if owner is None or not choices:
            msg = f"Documentation link has no public target: {module}: {href}"
            raise ValueError(msg)
        if len(choices) != 1:
            msg = f"Documentation link has ambiguous public targets: {module}: {href}"
            raise ValueError(msg)
        return choices[0]

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
        if node.tag == "dl" and id(node) in qualified_definitions:
            return "\n" + content + "\n"
        if node.tag == "dt" and id(node) in qualified_definitions:
            return "- " + content.strip()
        if node.tag == "dd" and id(node) in qualified_definitions:
            return ": " + content.strip() + "\n"
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
        result = {"file": _source_file(module), "revision": revision}
        if href and urlsplit(href).path != f"src/{module}.html":
            msg = f"Unsupported cross-module native source: {module}: {href}"
            raise ValueError(msg)
        anchor = unquote(urlsplit(href).fragment) if href else name
        if observations:
            matches = locations[module].get(anchor, [])
            if href and (not matches or (len(set(matches)) != 1 and not rich)):
                msg = f"Missing or ambiguous explicit native source anchor: {module}: {anchor}"
                raise ValueError(msg)
        elif anchor.startswith("line-"):
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
                **(
                    {"nativeLocation": {"module": module}, "definingModule": module}
                    if observations
                    else {}
                ),
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
                entry_origins[identity],
                name,
                next((node.attrs["href"] for node in header.walk() if node.has("link")), None),
            ),
            **(
                {
                    "nativeLocation": {"module": module, "anchor": _definition(header).attrs["id"]},
                    "definingModule": entry_origins[identity],
                }
                if observations
                else {}
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
                                entry_origins[identity],
                                name,
                                _one(sources, "instance source") if sources else None,
                            ),
                            "doc": documentation(row, module),
                        }
                    )
            symbol["instances"] = instances
        symbols.append(symbol)
    return {
        "modules": [
            {
                "name": module,
                "groups": groups[module],
                **({"reexports": reexports[module]} if observations else {}),
            }
            for module in exposed
        ],
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


def _checked_source_page(page, committed):
    """Qualify native line anchors against the same archived source bytes."""
    pre = _one(
        [node for node in _Document(page).root.walk() if node.tag == "pre"], "native source body"
    )

    parts = []
    locations = {}
    line = 1

    def walk(node):
        nonlocal line
        if isinstance(node, str):
            parts.append(node)
            line += node.count("\n")
            return
        if node.has("annottext"):
            return
        anchor = node.attrs.get("id", "")
        if anchor.startswith("line-") and (anchor != f"line-{line}" or anchor in locations):
            msg = f"Invalid native source line marker: {anchor} at line {line}"
            raise ValueError(msg)
        if anchor:
            locations.setdefault(anchor, []).append(line)
        for child in node.children:
            walk(child)

    walk(pre)
    if "".join(parts).encode() != committed:
        msg = "Native source text differs from the committed source input"
        raise ValueError(msg)
    return locations


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


def build_native(checkout, revision, native_output=None):
    """Build committed source in isolation and extract its configured public API."""
    checkout = Path(checkout).resolve()
    if native_output is not None and Path(native_output).exists():
        msg = "Native output must name a new directory"
        raise ValueError(msg)
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
        if modules not in [SCALAR_MODULES, OBSERVATION_MODULES, QUERY_MODULES, CREATION_MODULES]:
            msg = "Unqualified configured public module profile"
            raise ValueError(msg)
        mutations = "LibTmux.Internal.Mutation" in field("hidden-modules").split()
        creations = modules == CREATION_MODULES
        if creations and not mutations:
            msg = "Unqualified configured creation recovery interface"
            raise ValueError(msg)
        if mutations and modules not in [QUERY_MODULES, CREATION_MODULES]:
            msg = "Unqualified configured mutation module profile"
            raise ValueError(msg)
        queries = modules in [QUERY_MODULES, CREATION_MODULES]
        observations = queries or modules == OBSERVATION_MODULES
        source_modules = (
            CREATION_ORIGINS
            if creations
            else MUTATION_ORIGINS
            if mutations
            else QUERY_ORIGINS
            if queries
            else OBSERVATION_ORIGINS
            if observations
            else modules
        )
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
            for module in source_modules
        }
        for module in source_modules:
            matches = [
                source_root / prefix / (module.replace(".", "/") + ".hs")
                for prefix in ["src", "internal"]
            ]
            if [path for path in matches if path.is_file()] != [source_root / _source_file(module)]:
                msg = f"Missing or ambiguous committed module source: {module}"
                raise ValueError(msg)
        locations = {
            module: _checked_source_page(text, (source_root / _source_file(module)).read_bytes())
            for module, text in source_pages.items()
        }
        result = extract_modules(
            rendered, installed, modules, locations, revision, source_pages if creations else None
        )
        files = [".tool-versions", "cabal.project", "libtmux-haskell.cabal"]
        files.extend(_source_file(module) for module in source_modules)
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
        if native_output is not None:
            destination = Path(native_output)
            destination.mkdir(parents=True, exist_ok=False)
            for name, data in native_files.items():
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        return {
            "schema": "libtmux.haskell-api/5"
            if creations
            else "libtmux.haskell-api/4"
            if mutations
            else "libtmux.haskell-api/3"
            if queries
            else "libtmux.haskell-api/2"
            if observations
            else "libtmux.haskell-api/1",
            **(
                {
                    "profile": "creations/1"
                    if creations
                    else "mutations/1"
                    if mutations
                    else "queries/1"
                    if queries
                    else "observations/1"
                }
                if observations
                else {}
            ),
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
                    "version": 5
                    if creations
                    else 4
                    if mutations
                    else 3
                    if queries
                    else 2
                    if observations
                    else 1,
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
    parser.add_argument(
        "--native-output", type=Path, help="Retain hashed native inputs in a new directory"
    )
    arguments = parser.parse_args()
    exporter = _exporter_identity()
    artifact = build_native(arguments.checkout, arguments.source_revision, arguments.native_output)
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
