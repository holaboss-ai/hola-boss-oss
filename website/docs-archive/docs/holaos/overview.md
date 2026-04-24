# holaOS Overview

`holaOS` is the environment layer underneath Holaboss Desktop.

It defines the durable operating context around a run: the workspace contract, runtime services, memory and continuity surfaces, capability boundaries, and the harness boundary the runtime controls.

This section stays conceptual on purpose. It explains what should remain stable across runs, what the runtime owns, and how the major layers fit together. When you need exact commands, payloads, routes, or source-file seams, continue into [Build on holaOS](/build-on-holaos/).

Use [Overview](/) for the merged landing page. Use the pages in this section when you want the system model behind that landing-page summary.

At a glance:

- the workspace is the authored operating context for one workflow
- the runtime owns continuity, recall, capability projection, and app orchestration around that workspace
- the harness executes a prepared run inside that broader environment contract

## Read next

<DocCards>
  <DocCard
    title="Environment Engineering"
    eyebrow="Core Thesis"
    href="/holaos/environment-engineering"
    description="See how holaOS separates a durable environment contract from a swappable harness path."
  />
  <DocCard
    title="Workspace Model"
    eyebrow="Environment Contract"
    href="/holaos/workspace-model"
    description="Understand the workspace filesystem, authored surfaces, and runtime-owned state."
  />
  <DocCard
    title="Memory and Continuity"
    eyebrow="Long-Horizon State"
    href="/holaos/memory-and-continuity/"
    description="Learn how durable memory, continuity artifacts, and evolve work together."
  />
  <DocCard
    title="Build on holaOS"
    eyebrow="Developer Path"
    href="/build-on-holaos/"
    description="Move from the technical vision into the concrete developer path for runtime work, apps, and templates."
  />
</DocCards>
