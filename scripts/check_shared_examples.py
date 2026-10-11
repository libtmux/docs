#!/usr/bin/env python3
"""Fail when a libtmux port's shared example rules differ from this repo's.

Every port carries a copy of ``check_example_width.py`` and the text between
the ``shared:examples`` markers in WRITING.md. The rule is to change both in
all ports together. This script fetches each port's copy from the default
branch on raw.githubusercontent.com, digests it the way
``check_example_width.py --digest`` does, and compares the result with this
repository's own files.

A port with a missing checker or shared section fails, unless it is listed in
``PENDING`` with the reason it cannot be read yet and the date it was listed;
a pending port passes with a notice. A pending port whose checker and shared
section are both present fails until it leaves ``PENDING``, a port listed for
more than ``PENDING_DAYS`` days fails, so the list cannot go stale quietly,
and a port whose file differs fails. Remove a port from ``PENDING`` when its
example-style change merges.

To roll out a change to the shared text or the checker, record the digests
the ports still carry in ``PREVIOUS`` with the last day they are accepted:
a port on that version passes with a notice until then, so ports can merge
one at a time, and fails after it.

``NOT_FETCHED`` lists a port this script cannot read, such as a private
repository whose raw files return 404 without a token, with the reason and
where that port is compared instead; this script prints a notice for it
rather than fetching. Every port is public, so the list is empty.

A repository of the libtmux organisation that is neither listed nor this
one is looked up through the GitHub REST API (``GET /orgs/libtmux/repos``,
public and not archived, paginated; ``GITHUB_TOKEN`` is sent as a bearer
token when set). If its ``.github/WRITING.md`` or ``WRITING.md`` carries the
``shared:examples`` markers, the script fails with "<repo> carries the
shared example section but is not in PORTS", so a new adopter cannot go
uncompared.

It needs the network, so it runs in CI only, never in the local test loops;
``--self-test`` needs none.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import sys
import typing as t
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
# Importing the checker must not leave a __pycache__ beside it.
sys.dont_write_bytecode = True
import check_example_width as width  # noqa: E402

CHECKER = "check_example_width.py"
# repository -> (directory holding the checker, path of WRITING.md)
PORTS: dict[str, tuple[str, str]] = {
    "libtmux/libtmux-cxx": ("tools/docs", ".github/WRITING.md"),
    "libtmux/libtmux-dotnet": ("eng/docs", ".github/WRITING.md"),
    "libtmux/libtmux-go": ("internal/tools", ".github/WRITING.md"),
    "libtmux/libtmux-java": ("tools", ".github/WRITING.md"),
    "libtmux/libtmux-julia": ("dev", "WRITING.md"),
    "libtmux/libtmux-lua": ("scripts", ".github/WRITING.md"),
    "libtmux/libtmux-powershell": ("eng", ".github/WRITING.md"),
    "libtmux/libtmux-rs": ("scripts", ".github/WRITING.md"),
    "libtmux/libtmux-ruby": ("scripts", ".github/WRITING.md"),
    "libtmux/libtmux-swift": ("Scripts", ".github/WRITING.md"),
    "libtmux/libtmux-ts": ("scripts", ".github/WRITING.md"),
    "tmux-python/libtmux": ("scripts", ".github/WRITING.md"),
}
# Ports this script never fetches, with the reason and where they are checked.
NOT_FETCHED: dict[str, str] = {}
# During a change to the shared text or checker: the digest ports may still
# carry for each file ("checker" or "shared section"), and the last day it is
# accepted. Empty between changes.
PREVIOUS: dict[str, tuple[str, datetime.date]] = {
    # libtmux-powershell merged this checker before its marker-fallback fix.
    "checker": (
        "f261e9a3ef44101ead5fe1ce03331716372aac828f7421ef8f06c83c987ee956",
        datetime.date(2026, 11, 10),
    ),
}
# Ports whose missing files are expected: the reason and the date listed.
PENDING_DAYS = 30
_UNMERGED = ("example-style change not merged yet", datetime.date(2026, 10, 4))
PENDING: dict[str, tuple[str, datetime.date]] = {
    "libtmux/libtmux-cxx": _UNMERGED,
    "libtmux/libtmux-dotnet": _UNMERGED,
    "libtmux/libtmux-go": _UNMERGED,
    "libtmux/libtmux-java": _UNMERGED,
    "libtmux/libtmux-julia": _UNMERGED,
    "libtmux/libtmux-lua": _UNMERGED,
    "libtmux/libtmux-rs": _UNMERGED,
    "libtmux/libtmux-ruby": _UNMERGED,
    "libtmux/libtmux-swift": _UNMERGED,
    "libtmux/libtmux-ts": _UNMERGED,
    "tmux-python/libtmux": _UNMERGED,
}
OWN_REPO = "libtmux/docs"
ORG = "libtmux"
ORG_REPOS = "https://api.github.com/orgs/{org}/repos?type=public&per_page=100&page={page}"
WRITING_PATHS = (".github/WRITING.md", "WRITING.md")
RAW = "https://raw.githubusercontent.com/{repo}/HEAD/{path}"

Fetch = t.Callable[[str, str], t.Optional[bytes]]
ListRepos = t.Callable[[], list[str]]


def fetch_raw(repo: str, path: str) -> bytes | None:
    """Return a file from the repo's default branch, or None when absent."""
    request = urllib.request.Request(RAW.format(repo=repo, path=path))
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def list_org_repos() -> list[str]:
    """Return ``org/name`` for each public, non-archived organisation repo."""
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    names: list[str] = []
    page = 1
    while True:
        request = urllib.request.Request(
            ORG_REPOS.format(org=ORG, page=page), headers=headers
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            repos = json.load(response)
        names += [r["full_name"] for r in repos if not r["archived"]]
        if len(repos) < 100:
            return names
        page += 1


def unlisted_adopters(
    ports: dict[str, tuple[str, str]],
    list_repos: ListRepos,
    fetch: Fetch,
    own_repo: str = OWN_REPO,
) -> list[str]:
    """Return a failure for each unlisted repo that carries the markers."""
    failures: list[str] = []
    for repo in sorted(list_repos()):
        if repo == own_repo or repo in ports:
            continue
        for path in WRITING_PATHS:
            if shared_digest(fetch(repo, path)) is not None:
                failures.append(
                    f"{repo} carries the shared example section "
                    "but is not in PORTS"
                )
                break
    return failures


def shared_digest(writing: bytes | None) -> str | None:
    """Digest the shared section of a WRITING.md the way --digest does."""
    if writing is None:
        return None
    match = width.SHARED.search(writing.decode("utf-8"))
    if not match:
        return None
    return hashlib.sha256(match["body"].encode()).hexdigest()


def checker_digest(checker: bytes | None) -> str | None:
    return None if checker is None else hashlib.sha256(checker).hexdigest()


def local_digests(root: pathlib.Path) -> tuple[str | None, str | None]:
    checker = root / "scripts" / CHECKER
    writing = root / "WRITING.md"
    return (
        checker_digest(checker.read_bytes()),
        shared_digest(writing.read_bytes() if writing.is_file() else None),
    )


def compare(
    own: tuple[str | None, str | None],
    ports: dict[str, tuple[str, str]],
    fetch: Fetch,
    pending: dict[str, tuple[str, datetime.date]] | None = None,
    not_fetched: dict[str, str] | None = None,
    today: datetime.date | None = None,
    previous: dict[str, tuple[str, datetime.date]] | None = None,
) -> tuple[list[str], list[str]]:
    """Return (failures, notices) for every port against ``own``.

    A missing file is a failure unless the port is in ``pending``, and a
    pending port with both files present is a failure too. A port in
    ``not_fetched`` is never fetched and gives a notice.
    """
    pending = pending or {}
    not_fetched = not_fetched or {}
    previous = previous or {}
    today = today or datetime.datetime.now(datetime.UTC).date()
    failures: list[str] = [
        f"{repo}: in PENDING but not in PORTS" for repo in sorted(set(pending) - set(ports))
    ]
    notices: list[str] = []
    for repo, (_, since) in sorted(pending.items()):
        if (today - since).days > PENDING_DAYS:
            failures.append(
                f"{repo}: pending since {since}, more than {PENDING_DAYS} days; "
                "merge its example-style change or update the reason and date"
            )
    for repo, (directory, writing_path) in sorted(ports.items()):
        if repo in not_fetched:
            notices.append(f"{repo}: not fetched ({not_fetched[repo]})")
            continue
        theirs = (
            checker_digest(fetch(repo, f"{directory}/{CHECKER}")),
            shared_digest(fetch(repo, writing_path)),
        )
        if repo in pending and None not in theirs:
            failures.append(f"{repo}: both files present; remove it from PENDING")
            continue
        for label, mine, other, path in (
            ("checker", own[0], theirs[0], f"{directory}/{CHECKER}"),
            ("shared section", own[1], theirs[1], writing_path),
        ):
            if other is None and repo in pending:
                reason, since = pending[repo]
                notices.append(f"{repo}: no {label} at {path} ({reason}, since {since})")
            elif other is None:
                failures.append(f"{repo}: no {label} at {path}, and not pending")
            elif other != mine and label in previous and other == previous[label][0]:
                until = previous[label][1]
                said = f"{repo}: {label} in {path} is the previous version, accepted"
                if today > until:
                    failures.append(f"{said} only until {until}")
                else:
                    notices.append(f"{said} until {until}")
            elif other != mine:
                failures.append(
                    f"{repo}: {label} in {path} differs "
                    f"(theirs {other[:12]}, ours {str(mine)[:12]})"
                )
    return failures, notices


def summary(failures: list[str]) -> str:
    """Return the closing line of a failed run, naming what to change.

    >>> summary(["a/one: checker in x differs (theirs 1, ours 2)"])
    '1 file differs; change the shared rules in every port together'
    >>> summary(["a: both files present; remove it from PENDING"] * 2)
    '2 list entries are out of date; edit PORTS, PENDING or PREVIOUS as each line says'
    """
    drift = sum(" differs " in f or " only until " in f for f in failures)
    stale = len(failures) - drift
    parts = []
    if drift:
        files = "1 file differs" if drift == 1 else f"{drift} files differ"
        parts.append(f"{files}; change the shared rules in every port together")
    if stale:
        entries = "1 list entry is" if stale == 1 else f"{stale} list entries are"
        parts.append(
            f"{entries} out of date; edit PORTS, PENDING or PREVIOUS as each line says"
        )
    return ". ".join(parts)


def self_test() -> int:
    """Plant a mismatch and a missing file, then clean controls."""
    problems: list[str] = []

    def expect(ok: bool, what: str) -> None:
        if not ok:
            problems.append(what)

    marked = b"x\n<!-- shared:examples -->\nrules\n<!-- /shared:examples -->\n"
    own = (checker_digest(b"checker"), shared_digest(marked))
    expect(own[1] is not None, "markers were not found in the control text")
    ports = {"a/one": ("scripts", "WRITING.md")}

    def serve(files: dict[str, bytes]) -> Fetch:
        return lambda repo, path: files.get(path)

    clean = {"scripts/" + CHECKER: b"checker", "WRITING.md": marked}
    failures, notices = compare(own, ports, serve(clean))
    expect(not failures and not notices, "a matching port was reported")

    drifted = dict(clean, **{"scripts/" + CHECKER: b"edited checker"})
    failures, _ = compare(own, ports, serve(drifted))
    expect(len(failures) == 1 and "checker" in failures[0], "checker drift passed")

    edited = dict(clean, **{"WRITING.md": marked.replace(b"rules", b"other")})
    failures, _ = compare(own, ports, serve(edited))
    expect(len(failures) == 1 and "shared" in failures[0], "text drift passed")

    failures, notices = compare(own, ports, serve({}))
    expect(len(failures) == 2 and not notices, "a missing file passed")

    today = datetime.date(2026, 10, 4)
    waiting = {"a/one": ("not merged", today)}
    failures, notices = compare(own, ports, serve({}), waiting, today=today)
    expect(not failures and len(notices) == 2, "a pending port failed")

    later = today + datetime.timedelta(days=PENDING_DAYS + 1)
    failures, _ = compare(own, ports, serve({}), waiting, today=later)
    expect(len(failures) == 1 and "pending since" in failures[0], "a stale entry passed")

    rolling = {"checker": (checker_digest(b"edited checker") or "", today)}
    failures, notices = compare(
        own, ports, serve(drifted), today=today, previous=rolling
    )
    expect(not failures and len(notices) == 1, "the previous checker failed early")
    failures, _ = compare(own, ports, serve(drifted), today=later, previous=rolling)
    expect(len(failures) == 1 and "only until" in failures[0], "an expired version passed")

    stray = {"b/two": ("not merged", today)}
    failures, _ = compare(own, ports, serve(clean), stray, today=today)
    expect(failures == ["b/two: in PENDING but not in PORTS"], "an unknown entry passed")

    half = {"scripts/" + CHECKER: b"edited checker"}
    failures, notices = compare(own, ports, serve(half), waiting, today=today)
    expect(
        len(failures) == 1 and "differs" in failures[0] and len(notices) == 1,
        "a pending port with drift passed",
    )

    failures, notices = compare(own, ports, serve(clean), waiting, today=today)
    expect(
        len(failures) == 1 and "remove it from PENDING" in failures[0],
        "a pending port with both files present passed",
    )
    expect(not notices, "a pending port with both files gave a notice")

    def refuse(repo: str, path: str) -> bytes | None:
        raise AssertionError(f"fetched {repo}")

    private = {"a/one": "private; checked by its own job"}
    failures, notices = compare(own, ports, refuse, None, private)
    expect(not failures and len(notices) == 1, "a not-fetched port failed")
    expect("own job" in "".join(notices), "the not-fetched notice lost its reason")

    unmarked = dict(clean, **{"WRITING.md": b"no markers"})
    failures, notices = compare(own, ports, serve(unmarked))
    expect(len(failures) == 1 and not notices, "a port without markers passed")

    stranger = {"a/new": {".github/WRITING.md": marked}, "a/plain": {}}

    def stranger_fetch(repo: str, path: str) -> bytes | None:
        return stranger[repo].get(path)

    def listing() -> list[str]:
        return ["a/one", "libtmux/docs", "a/new", "a/plain"]

    failures = unlisted_adopters(ports, listing, stranger_fetch)
    expect(
        failures == ["a/new carries the shared example section but is not in PORTS"],
        "an unlisted adopter passed, or a listed or unmarked repo failed",
    )

    import doctest

    if doctest.testmod(sys.modules[__name__]).failed:
        problems.append("a doctest failed")
    for problem in problems:
        print(f"self-test: {problem}", file=sys.stderr)
    if not problems:
        print("self-test: ok")
    return 1 if problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true", help="run without network")
    parser.add_argument("--root", type=pathlib.Path, help="this repository's root")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    root = args.root or pathlib.Path(__file__).resolve().parent.parent
    own = local_digests(root)
    if None in own:
        print("this repository lacks the checker or the shared section", file=sys.stderr)
        return 1
    failures, notices = compare(own, PORTS, fetch_raw, PENDING, NOT_FETCHED, previous=PREVIOUS)
    failures += unlisted_adopters(PORTS, list_org_repos, fetch_raw)
    for notice in notices:
        print(f"notice: {notice}")
    for failure in failures:
        print(f"error: {failure}", file=sys.stderr)
    if failures:
        print(summary(failures), file=sys.stderr)
        return 1
    compared = [repo for repo in PORTS if repo not in PENDING and repo not in NOT_FETCHED]
    print(
        f"{len(compared)} port{'' if len(compared) == 1 else 's'} compared, "
        f"{len(PENDING)} pending, "
        f"{len(NOT_FETCHED)} not fetched, {len(notices)} notices"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
