"""Keep documentation checks within this repository's Python source."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

PROJECT = Path(__file__).resolve().parents[3]


@pytest.fixture
def lint_workspace(tmp_path: Path) -> Path:
    """Include an owned script and a separately configured port checkout."""
    shutil.copyfile(PROJECT / "pyproject.toml", tmp_path / "pyproject.toml")
    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "owned.py").write_text(
        '"""Owned source."""\n\nfrom __future__ import annotations\n\nmissing_owned()\n'
    )
    port = tmp_path / ".port-sources" / "haskell"
    port.mkdir(parents=True)
    (port / "pyproject.toml").write_text('[tool.ruff.lint]\nselect = ["F"]\n')
    (port / "foreign.py").write_text("missing_foreign()\n")
    return tmp_path


def test_lint_checks_owned_source_with_a_nested_port(lint_workspace: Path) -> None:
    """Reject an owned defect while leaving port checks to their repository."""
    ruff = shutil.which("ruff")
    assert ruff is not None, "Run through the project's locked uv environment"
    result = subprocess.run(
        [ruff, "check", ".", "--output-format", "json"],
        cwd=lint_workspace,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1, result.stdout + result.stderr
    problems = json.loads(result.stdout)
    assert [
        (Path(problem["filename"]).relative_to(lint_workspace).as_posix(), problem["code"])
        for problem in problems
    ] == [("scripts/owned.py", "F821")]
