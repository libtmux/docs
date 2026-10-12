---
port: "julia"
route: "topics"
title: "Topics"
description: "Understand owned servers, transport guarantees, cancellation, and output observation."
sidebar: {"label": "Overview", "group": "Topics", "order": 1}
tableOfContents: false
cards: [{"label": "Ownership and I/O", "href": "./ownership/", "body": "Track daemon, connection, buffer, and observation cleanup."}, {"label": "Execution and cancellation", "href": "./execution/", "body": "Compare transport guarantees, batch ordering, and uncertain effects."}, {"label": "Observing output", "href": "./observations/", "body": "Distinguish screen baselines, future bytes, bounded replay, and lost observation."}]
---

Julia separates endpoint descriptions, owned daemons, control connections, and
captured observations. Choose a transport and a lifetime deliberately, then use
the result's evidence to decide what completed.

The [examples](../examples/) contain complete programs for owned capture, shared
windows, cancellation, and output observation. The [query concepts](../concepts/queries/)
explain local selection over captured state.
