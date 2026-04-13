# Overview

**`holaOS` is an open-source agent environment for long-horizon work, continuity, and self-improvement.**

We are not another agent, we are defining the environment around the agent: the workspace contract, memory surfaces, continuity artifacts, capability projection, and packaging boundary that make work durable across runs. Instead of treating those concerns as incidental details around one executor, it turns them into explicit system surfaces.

## Our Mission

At [Holaboss](https://www.holaboss.ai/), our vision is that long-horizon AI work should be defined by the environment around the agent, not by the harness alone. A clearly defined environment gives the agent a stable workspace, memory, continuity model, and capability surface, creating the conditions for controlled, sample-efficient learning and self-improvement over time. That vision led us to build `holaOS`, the open-source environment layer that now powers Holaboss Desktop. Holaboss Desktop is the operator-facing desktop application built on top of `holaOS`, giving you the local product surface for installing, inspecting, and running workspaces.

## Why the environment matters

Long-horizon work needs more than a strong harness. It needs a stable operating context where progress can persist, continuity can resume, and improvement can accumulate over time. That is the core idea behind `holaOS`.

For the full technical argument behind that shift, read [Environment Engineering](/holaos/environment-engineering).

## Relationship to Holaboss Desktop

Holaboss Desktop is the operator-facing product surface built on top of `holaOS`. It gives you the local shell for installing, inspecting, and running workspaces, along with browser, file, notification, and model/runtime controls. The desktop is important, but it is not the whole system. The deeper technical story lives in the environment underneath it.

## Read Next

Start with the page that matches your goal:

<DocCards>
  <DocCard
    title="Quick Start"
    eyebrow="Setup"
    href="/getting-started/"
    description="Install the environment and get the local desktop path working."
  />
  <DocCard
    title="Learning Path"
    eyebrow="Technical Vision"
    href="/getting-started/learning-path"
    description="Understand the environment-engineering thesis and the systems model behind holaOS."
  />
  <DocCard
    title="Environment Engineering"
    eyebrow="Core Thesis"
    href="/holaos/environment-engineering"
    description="See why holaOS is framed around the environment contract instead of only the harness."
  />
  <DocCard
    title="holaOS Concepts"
    eyebrow="System Model"
    href="/holaos/concepts"
    description="Learn the core system vocabulary before moving deeper into runtime and workspace behavior."
  />
  <DocCard
    title="Build on holaOS"
    eyebrow="Developer Path"
    href="/build-on-holaos/"
    description="Go straight to the code-truth developer path for desktop, runtime, apps, and templates."
  />
</DocCards>
