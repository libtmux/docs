"""Check the native producer's public using-declaration XML before building C++."""

import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


def check(binary: str, expected: str) -> None:
    version = subprocess.check_output([binary, "--version"], text=True, timeout=10).strip()
    if not re.fullmatch(re.escape(expected) + r"(?: \([0-9a-f]+\))?", version):
        raise ValueError(f"Expected Doxygen {expected}, got {version}")
    with tempfile.TemporaryDirectory(prefix="libtmux-doxygen-smoke-") as directory:
        root = Path(directory)
        (root / "query.hpp").write_text("""namespace libtmux {
/// Query expression.
template <typename Entity> struct FilterExpr {};
/// Boolean field.
template <typename Entity> struct BoolFieldHandle {};
namespace tmuxq {
/// Match an expression.
template <typename Entity> [[nodiscard]] auto matching(FilterExpr<Entity> expr) {
  return expr;
}
/// Match a boolean field.
template <typename Entity> [[nodiscard]] auto matching(BoolFieldHandle<Entity> field) {
  return field;
}
}
using tmuxq::matching;
}
""")
        config = "\n".join([
            "INPUT = query.hpp", "FILE_PATTERNS = *.hpp", "GENERATE_XML = YES",
            "GENERATE_HTML = NO", "GENERATE_LATEX = NO", "XML_PROGRAMLISTING = NO",
            "EXTRACT_ALL = NO", "EXTRACT_PRIVATE = NO", "EXTRACT_STATIC = NO",
            "HIDE_UNDOC_MEMBERS = YES", "WARN_AS_ERROR = FAIL_ON_WARNINGS", "QUIET = YES",
        ])
        subprocess.run([binary, "-"], input=config, text=True, cwd=root, check=True, timeout=30)
        members = [
            member
            for path in (root / "xml").glob("namespace*.xml")
            for member in ET.parse(path).findall(".//memberdef[@kind='function'][@prot='public']")
        ]
        names = [member.findtext("qualifiedname") for member in members]
        if names.count("libtmux::matching") != 1 or names.count("libtmux::tmuxq::matching") != 2:
            raise ValueError("Doxygen must emit the public libtmux::matching using-declaration "
                             "and both libtmux::tmuxq::matching overloads")
    print(f"Doxygen {version}: public using-declaration and two original overloads verified")


if __name__ == "__main__":
    check(sys.argv[1], sys.argv[2])
