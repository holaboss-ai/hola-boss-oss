# Learning Path

Holaboss Desktop is the product surface. `holaOS` is the technical foundation underneath it.

If you have not gone through [Quick Start](/getting-started/) yet, do that first. After the environment is set up, use this path to understand the system and start building on top of it.

<DocSteps>
  <DocStep title="Understand holaOS first">

Read [Overview](/) and [Environment Engineering](/holaos/environment-engineering) first so the rest of the docs are grounded in the right systems model.

  </DocStep>
  <DocStep title="Understand the core concepts">

Then read [Concepts](/holaos/concepts) so terms like workspace, runtime, template, app, integration, and output have a clear meaning.

  </DocStep>
  <DocStep title="Learn the workspace and memory model">

Read [Workspace Model](/holaos/workspace-model) and [Memory and Continuity](/holaos/memory-and-continuity/) to understand what the runtime owns, what lives in workspace files, and how the next run resumes coherently.

  </DocStep>
  <DocStep title="Understand the execution boundary">

Read [Agent Harness](/holaos/agent-harness/) and [Runtime APIs](/build-on-holaos/runtime-apis) to see what the runtime passes into the executor and which operational surfaces exist around it.

  </DocStep>
  <DocStep title="Start developing locally">

Read [Start Developing](/build-on-holaos/start-developing/) before you jump into app code so your local desktop/runtime setup matches the actual OSS contributor path.

  </DocStep>
  <DocStep title="Choose a builder track">

If you are extending the system, continue into [Build on holaOS](/build-on-holaos/) and pick the app, template, runtime, or desktop path that matches the code you are changing.

  </DocStep>
</DocSteps>

## What This Site Covers

Use this docs site when you want the technical and developer view:

- the `holaOS` systems model
- how to build on top of that model
- how the desktop application fits on top as a product surface

## Choose your track

<DocCards>
  <DocCard
    title="Overview"
    eyebrow="Technical Vision"
    href="/"
    description="Start with the environment-engineering thesis and the systems model underneath the desktop."
  />
  <DocCard
    title="Environment Engineering"
    eyebrow="Core Thesis"
    href="/holaos/environment-engineering"
    description="See why holaOS is framed around the environment contract instead of only the harness."
  />
  <DocCard
    title="Concepts"
    eyebrow="Shared Vocabulary"
    href="/holaos/concepts"
    description="Learn the core terms and boundaries before going deeper into the runtime and app model."
  />
  <DocCard
    title="Memory and Continuity"
    eyebrow="Core Runtime Behavior"
    href="/holaos/memory-and-continuity/"
    description="Understand how Holaboss restores runs, stages evolve work, and keeps durable memory separate from runtime truth."
  />
  <DocCard
    title="Agent Harness"
    eyebrow="Execution Boundary"
    href="/holaos/agent-harness/"
    description="See how the runtime prepares a reduced execution package and what the current `pi` path actually receives."
  />
  <DocCard
    title="Build on holaOS"
    eyebrow="Developer Path"
    href="/build-on-holaos/"
    description="Choose the real developer path for local setup, runtime work, app contracts, and template materialization."
  />
</DocCards>
