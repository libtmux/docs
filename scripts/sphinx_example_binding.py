"""Record Sphinx's native doctest nodes and verify their rendered source."""

from __future__ import annotations

import os
from pathlib import Path
import functools
import inspect
import sys

from docutils import nodes
from sphinx.util import inspect as sphinx_inspect
from sphinx.util.docstrings import prepare_docstring

from example_sources import Binding, BoundImports, Receipt, digest, require, verify_rendered_blocks


def inspect_docstring_provider(obj):
    """Identify the object read by the stdlib's inherited-docstring fallback."""
    if getattr(obj, "__doc__", None) is not None:
        return obj
    if inspect.isclass(obj):
        return next((base for base in obj.__mro__ if base is not object and base.__doc__ is not None), None)
    if inspect.ismethod(obj):
        name = obj.__func__.__name__
        owner = obj.__self__
        cls = owner if inspect.isclass(owner) and getattr(getattr(owner, name, None), "__func__", None) is obj.__func__ else owner.__class__
    elif inspect.isfunction(obj) or isinstance(obj, property):
        function = obj.fget if isinstance(obj, property) else obj
        name = function.__name__
        cls = sys.modules.get(function.__module__)
        for part in function.__qualname__.split(".")[:-1]:
            cls = getattr(cls, part, None)
        if not inspect.isclass(cls) or getattr(cls, name, None) is not obj:
            return None
    elif inspect.isbuiltin(obj):
        name, owner = obj.__name__, obj.__self__
        cls = owner if inspect.isclass(owner) and owner.__qualname__ + "." + name == obj.__qualname__ else owner.__class__
    elif inspect.ismethoddescriptor(obj) or inspect.isdatadescriptor(obj):
        name, cls = obj.__name__, obj.__objclass__
        if getattr(cls, name, None) is not obj:
            return None
        if inspect.ismemberdescriptor(obj) and isinstance(getattr(cls, "__slots__", None), dict) and name in cls.__slots__:
            return cls
    else:
        return None
    return next((getattr(base, name) for base in cls.__mro__ if getattr(getattr(base, name, None), "__doc__", None) is not None), None)


def selected_docstring(obj, inherit=False, parent=None, name=None):
    """Resolve native Sphinx selection and check it against Sphinx's result."""
    def direct(value):
        doc = sphinx_inspect.safe_getattr(value, "__doc__", None)
        return (doc, value) if isinstance(doc, str) else (None, None)

    def fallback(value):
        doc = inspect.getdoc(value)
        provider = inspect_docstring_provider(value) if doc is not None else None
        if provider is not None:
            raw = provider.__slots__[value.__name__] if inspect.ismemberdescriptor(value) and provider is value.__objclass__ else getattr(provider, "__doc__", None)
            require(isinstance(raw, str) and inspect.cleandoc(raw) == doc, "Cannot establish the stdlib inherited-docstring provider")
        require(doc is None or provider is not None, "Cannot establish the stdlib inherited-docstring provider")
        return doc, provider

    if parent and name and sphinx_inspect.is_classmethod_like(obj, parent, name):
        for base in sphinx_inspect.getmro(parent):
            method = base.__dict__.get(name)
            if method and (hasattr(method, "__func__") or sphinx_inspect.is_classmethod_descriptor(method)):
                doc, provider = selected_docstring(getattr(method, "__func__", method))
                if doc is not None or not inherit:
                    break
        else:
            doc, provider = direct(obj)
    else:
        doc, provider = direct(obj)
        if sphinx_inspect.ispartial(obj) and doc == obj.__class__.__doc__:
            doc, provider = selected_docstring(obj.func)
        elif doc is None and inherit:
            if parent and name:
                for base in sphinx_inspect.getmro(parent):
                    method = sphinx_inspect.safe_getattr(base, name, None)
                    if method is not None:
                        doc, provider = direct(method)
                        if doc is not None:
                            break
                if doc is None:
                    for base in sphinx_inspect.getmro(parent):
                        method = sphinx_inspect.safe_getattr(base, name, None)
                        if method is not None:
                            doc, provider = fallback(method)
                            if doc is not None:
                                break
            if doc is None:
                doc, provider = fallback(obj)
    require(doc == sphinx_inspect.getdoc(obj, allow_inherited=inherit, cls=parent, name=name),
            "Sphinx docstring selection differs from its checked provider")
    return doc, provider


def documenter_docstrings(documenter):
    """Retain providers for the native documenter's selected docstring blocks."""
    from sphinx.ext.autodoc import ClassDocumenter

    obj = documenter.object
    inherit = documenter.config.autodoc_inherit_docstrings
    if isinstance(documenter, ClassDocumenter):
        if documenter.doc_as_attr:
            return []
        selected = [selected_docstring(obj)]
        content = documenter.options.get("class-doc-from", documenter.config.autoclass_content)
        if content in {"init", "both"}:
            constructor = (None, None)
            for name in ("__init__", "__new__"):
                candidate = selected_docstring(documenter.get_attr(obj, name, None), inherit, obj, name)
                if candidate[0] and candidate[0].strip() != getattr(object, name).__doc__:
                    constructor = candidate
                    break
            if constructor[0]:
                selected = [constructor] if content == "init" else [*selected, constructor]
    else:
        selected = [selected_docstring(obj, inherit, documenter.parent, documenter.object_name)]
        if documenter.objtype == "method" and documenter.object_name in {"__init__", "__new__"}:
            selected = [(doc, provider) for doc, provider in selected if doc and doc.strip() != getattr(object, documenter.object_name).__doc__]
    return [(doc, provider) for doc, provider in selected if doc]


def setup(app):
    manifest = os.environ.get("LIBTMUX_EXAMPLE_BINDING")
    output = os.environ.get("LIBTMUX_EXAMPLE_RECEIPT")
    if not manifest and not output:
        return {"version": "1", "parallel_read_safe": False, "parallel_write_safe": False}
    require(bool(manifest and output), "Set both LIBTMUX_EXAMPLE_BINDING and LIBTMUX_EXAMPLE_RECEIPT")
    binding = Binding(Path(manifest))
    receipt = Receipt(Path(output), binding, "sphinx")
    imports = BoundImports.current(binding)
    record = receipt.record
    record.update(documents={}, testNodes={}, rendered={}, autodocSources={}, autodocObjects={})
    autodoc_objects = {}

    class ProviderDocumenter:
        def generate(self, *args, **kwargs):
            # Keep autodoc's dependency additions separate from native includes.
            previous = self.directive.record_dependencies
            self.directive.record_dependencies = set()
            try:
                return super().generate(*args, **kwargs)
            finally:
                dependencies = self.directive.record_dependencies
                self.directive.record_dependencies = previous
                attributed = self.partial_attribution()
                if attributed:
                    dependencies = {path for path in dependencies if Path(path).resolve() != attributed}
                previous.update(dependencies)

        def partial_attribution(self):
            obj = getattr(self, "object", None)
            if type(obj) is functools.partial and obj.__doc__ == functools.partial.__doc__:
                # Native Sphinx labels partial.func's docstring as functools.py.
                filename = inspect.getsourcefile(functools.partial)
                if filename and self.analyzer and Path(self.analyzer.srcname).resolve() == Path(filename).resolve():
                    return Path(filename).resolve()
            return None

        def get_doc(self):
            cached = getattr(self, "_new_docstrings", None)
            docstrings = super().get_doc()
            if cached is None:
                try:
                    selected = documenter_docstrings(self)
                    tab_width = self.directive.state.document.settings.tab_width
                    expected = [prepare_docstring(doc, tab_width) for doc, _ in selected]
                    require(expected == docstrings, f"Native autodoc selection has no checked provider: {self.fullname}")
                    self._bound_docstring_providers = ([provider for _, provider in selected], None)
                except (AttributeError, TypeError, ValueError) as error:
                    # Only objects contributing native test nodes need certification.
                    self._bound_docstring_providers = ([], str(error))
            return docstrings

        def process_doc(self, docstrings):
            # Keep native formatting and signature stripping; save their providers.
            label = self.get_sourcename().split(":docstring of ", 1)[-1]
            providers, error = getattr(self, "_bound_docstring_providers", ([], f"No checked docstring selection: {self.fullname}"))
            selected = autodoc_objects.setdefault(label, [])
            entry = (self.object, self.objtype, self.fullname, providers, error, self.partial_attribution())
            if not any(previous[0] is self.object and previous[2:] == entry[2:] for previous in selected):
                selected.append(entry)
            yield from super().process_doc(docstrings)

    def collect_nodes(doctree):
        collected = []
        for node in doctree.findall():
            if not (isinstance(node, (nodes.literal_block, nodes.comment)) and "testnodetype" in node) and not isinstance(node, nodes.doctest_block):
                continue
            if node.source:
                # Autodoc appends the object name to its real source filename.
                path = Path(node.source.split(":docstring of ", 1)[0])
                if ":docstring of " in node.source:
                    label = node.source.split(":docstring of ", 1)[1]
                    selected = autodoc_objects.get(label)
                    require(bool(selected), f"No selected autodoc object for native docstring: {node.source}")
                    verified = []
                    for obj, what, name, providers, error, attributed in selected:
                        require(error is None, f"Autodoc {name}: {error}")
                        if attributed != path.resolve():
                            record["autodocSources"][str(path.resolve())] = imports.require_source(path)
                        checked = {}
                        objects = providers if sphinx_inspect.ispartial(obj) else [obj, *providers]
                        for provider in objects:
                            for source in imports.require_docstring(provider, f"Autodoc {name}"):
                                checked[source["path"]] = source
                        sources = list(checked.values())
                        for source in sources:
                            record["autodocSources"][source["path"]] = source["sha256"]
                        verified.append(dict(name=name, kind=what, docstringSources=sources))
                    record["autodocObjects"][label] = verified
                else:
                    binding.read(path)
            collected.append(dict(kind=node.get("testnodetype", "doctest"), groups=list(node.get("groups", ["default"])),
                                  options=dict(node.get("options", {})), skipif=node.get("skipif"),
                                  displayedText=node.astext(), testText=node.get("test", node.astext()),
                                  hidden=isinstance(node, nodes.comment), source=node.source, line=node.line))
        return collected

    app.setup_extension("sphinx.ext.doctest")
    from sphinx.ext.doctest import DocTestBuilder

    class BoundDocTestBuilder(DocTestBuilder):
        def test_doc(self, docname, doctree):
            require(collect_nodes(doctree) == record["testNodes"].get(docname),
                    f"Native doctest nodes changed before execution: {docname}")
            super().test_doc(docname, doctree)
            skipped = getattr(self.test_runner, "skips", None)
            if skipped is not None:
                record["nativeSkipped"] = record.get("nativeSkipped", 0) + skipped

    app.add_builder(BoundDocTestBuilder, override=True)

    def initialized(app):
        require(app.builder.name == "doctest" or app.builder.format == "html", "Binding supports Sphinx doctest and HTML builders")
        if "sphinx.ext.autodoc" in app.extensions:
            for name, documenter in list(app.registry.documenters.items()):
                bound = type(f"Bound{documenter.__name__}", (ProviderDocumenter, documenter), {})
                app.add_autodocumenter(bound, override=True)
        if app.confdir and (Path(app.confdir) / "conf.py").exists():
            binding.read(Path(app.confdir) / "conf.py")
        record.update(builder=app.builder.name, format=app.builder.format,
                      doctestConfiguration={name: getattr(app.config, name) for name in
                          ("doctest_global_setup", "doctest_global_cleanup", "doctest_default_flags", "doctest_test_doctest_blocks")})
        receipt.save()

    def source_read(app, docname, source):
        path = Path(app.env.doc2path(docname)).resolve()
        raw = binding.read(path)
        expected = raw.decode(app.config.source_encoding).replace("\r\n", "\n").replace("\r", "\n")
        require(source[0] == expected, f"Sphinx source differs from its bound document: {path}")
        record["documents"][docname] = dict(path=str(path), sha256=digest(raw), nativeTextSha256=digest(source[0].encode("utf-8")))
        receipt.save()

    def doctree_read(app, doctree):
        collected = collect_nodes(doctree)
        for dependency in app.env.dependencies.get(app.env.docname, ()):
            path = Path(dependency)
            if not path.is_absolute():
                path = Path(app.srcdir) / path
            if path.is_file():
                binding.read(path)
        record["testNodes"][app.env.docname] = collected
        receipt.save()

    def finished(app, exception):
        try:
            if exception is not None:
                receipt.fail(exception)
                return
            require(bool(record["documents"]) and set(record["documents"]) == set(record["testNodes"]),
                    "No complete native source inventory; run Sphinx with -E -a")
            if app.builder.format == "html":
                for docname, test_nodes in record["testNodes"].items():
                    record["rendered"][docname] = verify_rendered_blocks(Path(app.builder.get_outfilename(docname)), test_nodes)
            else:
                record.update(attempted=app.builder.total_tries - record.get("nativeSkipped", 0),
                              nativeAttempted=app.builder.total_tries, failed=app.builder.total_failures,
                              setupFailed=app.builder.setup_failures, cleanupFailed=app.builder.cleanup_failures)
                require(record["attempted"] > 0, "Sphinx executed no doctest examples")
            # Sphinx applies warning-as-error status and builder cleanup after this event.
            # The command adapter completes the receipt after the native command returns.
            binding.verify()
            record.update(nativeBuildFinished=True, nativeSucceeded=app.statuscode == 0)
            receipt.save()
        except BaseException as error:
            receipt.fail(error)
            raise

    app.connect("builder-inited", initialized)
    app.connect("source-read", source_read, priority=999)
    app.connect("doctree-read", doctree_read, priority=999)
    app.connect("build-finished", finished)
    return {"version": "1", "parallel_read_safe": False, "parallel_write_safe": False}
