---
name: feature-level-merges
description: Write feature-level commit and merge messages for shared documentation pins and pull requests in this project and its ports.
---

# Feature-level merge messages

Read the repository's commit and merge guidance before composing a message.

For a pin update, inspect the exact old and new upstream trees. Summarize
that net change; a merge's ancestry may contain work already present in the
old tree. Check relevant source and dependency manifests before claiming a
feature, fix, changed default or compatibility requirement.

Name the delivered capability or bug fix in the subject. Explain what the
project adopts and why in the body. For dependency-only changes, name the
actual tools or dependencies and their purpose. Keep source refs and pinned
comparison links in the body as provenance.

Identify language-specific behavior in shared tooling. A Go workflow can
adopt a renderer containing a Rust linking fix; that does not change the
Go library API. Keep tests, publication status and future work separate
from the features actually included.

Follow the repository's subject, body and PR-number conventions. Supply the
message explicitly to the commit or merge operation, then read back the
actual result before another merge. Existing authorization and delivery
gates still apply.
