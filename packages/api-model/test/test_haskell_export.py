"""Native public declarations must survive the shared-site export boundary."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("haskell_export", ROOT / "scripts/export-haskell.py")
EXPORT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORT)
FIXTURE = ROOT / "test/fixtures/haskell-native"
REVISION = "9fb506c96772affa6ea23bee41218cd41a931d51"


def _native_inputs():
    meta = json.loads((FIXTURE / "provenance.json").read_text())
    pages = {
        name: (FIXTURE / (name.replace(".", "-") + ".html")).read_text() for name in meta["modules"]
    }
    return [
        pages,
        json.loads((FIXTURE / "installed.json").read_text()),
        meta["modules"],
        json.loads((FIXTURE / "source-anchors.json").read_text()),
        REVISION,
    ]


def _artifact():
    return EXPORT.extract_modules(*_native_inputs())


class _NativeExportTest(unittest.TestCase):
    def test_exporter_identity_requires_the_exact_committed_bytes(self):
        with tempfile.TemporaryDirectory(prefix="libtmux-haskell-exporter-test-") as directory:
            root = Path(directory)
            script = root / "export.py"
            script.write_text("# exporter fixture\n")
            subprocess.run(["git", "init", "--quiet", str(root)], check=True)
            commit = [
                "git",
                "-C",
                str(root),
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "commit.gpgsign=false",
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "--quiet",
                "--allow-empty",
            ]
            subprocess.run([*commit, "-m", "fixture base"], check=True)
            with patch.object(EXPORT, "__file__", str(script)):
                with self.assertRaisesRegex(ValueError, "Commit the reviewed exporter"):
                    EXPORT._exporter_identity()
                subprocess.run(["git", "-C", str(root), "add", "export.py"], check=True)
                subprocess.run([*commit, "-m", "fixture exporter"], check=True)
                identity = EXPORT._exporter_identity()
                self.assertEqual(identity["path"], "export.py")
                self.assertRegex(identity["revision"], r"^[a-f0-9]{40}$")
                self.assertRegex(identity["sha256"], r"^[a-f0-9]{64}$")
                script.write_text("# changed exporter fixture\n")
                with self.assertRaisesRegex(ValueError, "bytes differ"):
                    EXPORT._exporter_identity()

    def test_unqualified_compilers_and_partial_source_refs_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "existing full commit"):
            EXPORT.build_native(FIXTURE, "master")

        def old_toolchain(arguments, _cwd):
            values = {
                "ghc": "9.12.1",
                "haddock": "Haddock version 2.33.0, fixture",
                "cabal": "3.18.2.0",
            }
            return subprocess.CompletedProcess(arguments, 0, values[Path(arguments[0]).name], "")

        with (
            patch.object(EXPORT.shutil, "which", side_effect=lambda name: "/fixture/bin/" + name),
            patch.object(EXPORT, "_git", return_value=REVISION),
            patch.object(EXPORT, "_command", side_effect=old_toolchain),
            self.assertRaisesRegex(ValueError, "qualified GHC"),
        ):
            EXPORT.build_native(FIXTURE, REVISION)

    def test_unhandled_native_layouts_are_rejected_instead_of_dropped(self):
        cases = [
            (
                "argument docs",
                '<div class="top"><p class="src"><a id="v:parseSessionId"',
                (
                    '<div class="top"><div class="subs arguments"><p>argument contract</p></div>'
                    '<p class="src"><a id="v:parseSessionId"'
                ),
            ),
            (
                "section prose",
                '<div id="interface">',
                '<div id="interface"><div class="doc"><p>section contract</p></div>',
            ),
            (
                "orphan instances",
                '<div id="interface">',
                '<div id="interface"><div class="subs instances"><p>orphan contract</p></div>',
            ),
            (
                "ordered prose",
                '<div class="doc"><p>Distinct session',
                '<div class="doc"><ol><li>first</li><li>second</li></ol><p>Distinct session',
            ),
            (
                "definition prose",
                '<div class="doc"><p>Distinct session',
                '<div class="doc"><dl><dt>term</dt><dd>meaning</dd></dl><p>Distinct session',
            ),
            (
                "type equation",
                '<span class="keyword">data</span> <a id="t:SessionId"',
                '<span class="keyword">type</span> <a id="t:SessionId"',
            ),
        ]
        for description, before, after in cases:
            with self.subTest(description):
                inputs = _native_inputs()
                self.assertTrue(
                    before in inputs[0]["LibTmux.Id"],
                    "Native fixture marker changed: " + description,
                )
                inputs[0]["LibTmux.Id"] = inputs[0]["LibTmux.Id"].replace(before, after, 1)
                with self.assertRaisesRegex(ValueError, "Unsupported"):
                    EXPORT.extract_modules(*inputs)

    def test_build_identity_matches_the_registered_source_component(self):
        registration = {
            "id": "libtmux-haskell-0.1.0.0-inplace",
            "name": "libtmux-haskell",
            "version": "0.1.0.0",
        }
        component = {
            "type": "configured",
            "component-name": "lib",
            "pkg-name": "libtmux-haskell",
            "pkg-version": "0.1.0.0",
            "id": registration["id"],
            "style": "local",
            "pkg-src": {"type": "local", "path": str(FIXTURE)},
        }
        plan = {
            "compiler-id": "ghc-9.14.1",
            "cabal-version": "3.18.2.0",
            "cabal-lib-version": "3.18.2.0",
            "os": "linux",
            "arch": "x86_64",
            "install-plan": [component],
        }
        self.assertEqual(EXPORT._checked_component(plan, FIXTURE, registration), component)
        for changed in [
            {"compiler-id": "ghc-9.12.1"},
            {"cabal-lib-version": "3.16.0.0"},
            {"arch": "aarch64"},
            {"install-plan": []},
        ]:
            with self.subTest(changed), self.assertRaises(ValueError):
                EXPORT._checked_component({**plan, **changed}, FIXTURE, registration)
        for changed in [
            {"pkg-version": "9.0.0.0"},
            {"pkg-src": {"type": "local", "path": "/other-source"}},
        ]:
            with self.subTest(changed), self.assertRaises(ValueError):
                EXPORT._checked_component(
                    {**plan, "install-plan": [{**component, **changed}]}, FIXTURE, registration
                )

    def test_public_surface_excludes_hidden_modules_and_instance_methods(self):
        result = _artifact()
        symbols = result["symbols"]
        self.assertEqual(len(symbols), 38)
        self.assertEqual(sum(s["kind"] == "module" for s in symbols), 3)
        self.assertFalse(
            any("Internal" in s["id"] or s["name"] in {"show", "rnf", "compare"} for s in symbols)
        )
        self.assertEqual(sum(len(s.get("instances", [])) for s in symbols), 33)

    def test_hidden_and_inconsistent_public_inputs_are_rejected(self):
        inputs = _native_inputs()
        inputs[2] = ["LibTmux.Internal.Budget"]
        inputs[0] = {"LibTmux.Internal.Budget": inputs[0]["LibTmux.Id"]}
        with self.assertRaisesRegex(ValueError, "absent or hidden"):
            EXPORT.extract_modules(*inputs)
        inputs = _native_inputs()
        inputs[1]["inst_ifaces"][0]["visible_exports"].pop()
        with self.assertRaisesRegex(ValueError, "visible-export sets disagree"):
            EXPORT.extract_modules(*inputs)

    def test_authored_links_cannot_target_private_or_absent_declarations(self):
        inputs = _native_inputs()
        inputs[0]["LibTmux.Id"] = inputs[0]["LibTmux.Id"].replace(
            'href="LibTmux-Id.html#v:parsePaneId"',
            'href="LibTmux-Internal-Process.html#v:submit"',
            1,
        )
        with self.assertRaisesRegex(ValueError, "no public target"):
            EXPORT.extract_modules(*inputs)

    def test_duplicate_native_id_is_not_silently_merged(self):
        inputs = _native_inputs()
        inputs[0]["LibTmux.Id"] = inputs[0]["LibTmux.Id"].replace(
            'id="v:input"', 'id="v:expectedPrefix"'
        )
        with self.assertRaisesRegex(ValueError, "Duplicate namespace-aware"):
            EXPORT.extract_modules(*inputs)

    def test_native_source_locations_follow_markers_and_preserve_duplicates(self):
        source = '<span id="line-7"></span><a id="Value"></a><a id="Value"></a>'
        source += '<span id="line-11"></span><a id="Other"></a><a id="Value"></a>'
        self.assertEqual(
            EXPORT._SourceLocations(source).locations, {"Value": [7, 7, 11], "Other": [11]}
        )

    def test_ambiguous_native_source_anchors_keep_a_file_level_link(self):
        inputs = _native_inputs()
        inputs[3]["LibTmux.Id"]["parsePaneId"] = [79, 80]
        result = EXPORT.extract_modules(*inputs)
        parser = next(s for s in result["symbols"] if s["id"] == "LibTmux.Id#v:parsePaneId")
        self.assertNotIn("line", parser["source"])
        self.assertEqual(parser["source"]["file"], "src/LibTmux/Id.hs")

    def test_instance_heads_keep_native_class_links_and_source(self):
        symbols = {s["id"]: s for s in _artifact()["symbols"]}
        instances = symbols["LibTmux.Id#t:PaneId"]["instances"]
        self.assertEqual(
            {item["raw"] for item in instances},
            {
                "instance Eq PaneId",
                "instance Ord PaneId",
                "instance Show PaneId",
                "instance NFData PaneId",
            },
        )
        strict = next(item for item in instances if item["raw"] == "instance NFData PaneId")
        self.assertEqual([ref["text"] for ref in strict["references"]], ["NFData", "PaneId"])
        self.assertTrue(
            strict["references"][0]["href"].startswith(
                "https://hackage.haskell.org/package/deepseq-"
            )
        )
        self.assertEqual(strict["references"][1]["target"], "LibTmux.Id#t:PaneId")
        self.assertEqual(strict["source"]["revision"], REVISION)
        self.assertGreater(strict["source"]["line"], 0)

    def test_native_signature_links_and_constructor_roles_survive(self):
        symbols = {s["id"]: s for s in _artifact()["symbols"]}
        parser = symbols["LibTmux.Id#v:parsePaneId"]["signatures"][0]
        self.assertIn("nativeSpans", parser)
        spans = parser["nativeSpans"]
        self.assertEqual("".join(span["text"] for span in spans), parser["raw"])
        self.assertEqual(
            [(span["text"], span["target"]) for span in spans if "target" in span],
            [("IdError", "LibTmux.Id#t:IdError"), ("PaneId", "LibTmux.Id#t:PaneId")],
        )
        external = {
            span["text"]: span["href"] for span in spans if "href" in span and "target" not in span
        }
        self.assertRegex(external["Text"], r"^https://hackage[.]haskell[.]org/package/text-")
        self.assertRegex(external["Either"], r"^https://hackage[.]haskell[.]org/package/base-")
        self.assertTrue(
            next(span for span in spans if span["text"] == "parsePaneId")["declaration"]
        )
        constructors = [
            signature
            for symbol in symbols.values()
            if symbol["kind"] == "function" and symbol["parent"] != symbol["namespace"]
            for signature in symbol["signatures"]
        ]
        self.assertEqual(len(constructors), 5)
        self.assertTrue(all(signature["methodKind"] == "constructor" for signature in constructors))
        for symbol in symbols.values():
            for signature in symbol["signatures"]:
                self.assertEqual(
                    "".join(span["text"] for span in signature["nativeSpans"]), signature["raw"]
                )

    def test_signature_links_reject_nonpublic_or_unsafe_destinations(self):
        for href in ["LibTmux-Internal-Process.html#v:submit", "#t:Missing", "javascript:alert(1)"]:
            with self.subTest(href=href):
                inputs = _native_inputs()
                marker = '<a id="v:parsePaneId"'
                before, tail = inputs[0]["LibTmux.Id"].split(marker, 1)
                header, after = tail.split("</p>", 1)
                original = 'href="LibTmux-Id.html#t:IdError"'
                self.assertIn(original, header)
                inputs[0]["LibTmux.Id"] = (
                    before + marker + header.replace(original, f'href="{href}"', 1) + "</p>" + after
                )
                with self.assertRaisesRegex(
                    ValueError, "no public target|Unsupported documentation link scheme"
                ):
                    EXPORT.extract_modules(*inputs)

    def test_opaque_ids_do_not_reveal_their_newtype_constructor(self):
        symbols = {s["id"]: s for s in _artifact()["symbols"]}
        self.assertIn("LibTmux.Id#t:PaneId", symbols)
        pane = symbols["LibTmux.Id#t:PaneId"]
        self.assertEqual(pane["signatures"][0]["raw"], "data PaneId")
        self.assertIn("opaque", pane["modifiers"])
        self.assertNotIn("LibTmux.Id#v:PaneId", symbols)
        self.assertNotIn("Word32", pane["signatures"][0]["raw"])

    def test_fields_keep_strict_types_without_inventing_selectors(self):
        symbols = {s["id"]: s for s in _artifact()["symbols"]}
        self.assertIn("LibTmux.Id#v:expectedPrefix", symbols)
        field = symbols["LibTmux.Id#v:expectedPrefix"]
        self.assertEqual(field["kind"], "property")
        self.assertEqual(field["parent"], "LibTmux.Id#t:IdError")
        self.assertEqual(field["signatures"][0]["raw"], "expectedPrefix :: !Char")
        self.assertEqual(field["source"]["line"], 64)
        self.assertIn("LibTmux.Id#v:InvalidId", symbols)

    def test_native_module_prose_groups_links_and_repl_examples_survive(self):
        result = _artifact()
        symbols = {s["id"]: s for s in result["symbols"]}
        self.assertIn("LibTmux.Id", symbols)
        module = symbols["LibTmux.Id"]
        self.assertIn("Parsing and rendering are pure", module["doc"]["body"])
        self.assertIn("LibTmux.Id#v:parsePaneId", module["doc"]["body"])
        self.assertIn(">>> fmap renderWindowId", module["doc"]["body"])
        self.assertIn(
            "Parse external values", [group["title"] for group in result["modules"][0]["groups"]]
        )
        parser = symbols["LibTmux.Id#v:parsePaneId"]
        self.assertEqual(
            parser["signatures"][0]["raw"], "parsePaneId :: Text -> Either IdError PaneId"
        )
        self.assertEqual(parser["source"]["revision"], REVISION)


if __name__ == "__main__":
    unittest.main()
