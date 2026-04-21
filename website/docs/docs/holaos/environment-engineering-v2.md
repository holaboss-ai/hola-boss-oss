# Environment Engineering V2

This page explains the core technical thesis behind `holaOS`: long-horizon agent systems need environment engineering as well as harness engineering.

In many agent systems, the word "harness" is used broadly. It often refers to the whole execution and control layer around an agent: tools, permissions, context handling, retries, approvals, streaming, and stop rules. `holaOS` agrees that this layer matters. Its stronger claim is that some of those responsibilities should be pulled into a durable environment contract rather than left implicit inside one swappable execution runtime.

The key distinction is not between easy tasks and hard tasks. A strong harness can support very capable task execution. The more important distinction is between a task and a role. A task is bounded work with a local objective and a stopping point. A long-horizon task is still a task, but it cannot be completed coherently inside one short run: it spans many steps, often many runs, interruptions, intermediate artifacts, and changing state before it reaches completion. A role is different again. A role is an ongoing operating responsibility that persists across many tasks, time, and changing context. A harness can help an agent execute a task well. An environment helps a system carry a long-horizon task forward and inhabit a role over time.

## Harnesses and environments are different layers

In `holaOS`, the harness is the execution subsystem for a run. A large part of its job is context management: deciding what state becomes active for a given step, what stays out of the prompt, what tools are visible, and how the loop continues. The environment is the durable operating context around that subsystem.

That split is the point of this page:

- harness engineering makes a run operable
- environment engineering makes the operating context durable, inspectable, portable, and stable across runs

The goal is not to minimize the harness. The goal is to keep key system invariants from being trapped inside one executor's private behavior.

## Why a first-class environment contract matters

This is not a claim that harnesses only matter for isolated or simple tasks. A strong harness can support complex, multi-step task execution. The issue is different: once a task becomes long-horizon, or once a system is expected to operate in a continuing role, it still needs stable answers to questions that span beyond any one run:

- where standing instructions live
- what memory is durable versus volatile
- how continuity is restored after interruption
- what the agent is allowed to see and call for a given run
- how outputs stay inspectable to operators
- how reviewed improvements become durable system capability

Harnesses can implement the mechanics of a run extremely well. They should not be the only place those invariants exist.

You can test the idea with one question: if you replaced the harness tomorrow, what should still remain true?

Context makes the distinction concrete. The exact prompt for a step may change when the harness changes, but the broader state it is compiled from should not. Not all relevant state should be in the prompt for every step. Some state is active in the current call, some is nearby runtime continuity, and much more is durable but retrievable.

- hot context: the prompt package actually sent to the model for this step
- warm context: recent run or session state that is cheap to resume from, but not always injected in full
- cold context: durable retrievable state such as memory, instructions, skills, artifacts, traces, and policy

This is why memory should not be treated as synonymous with context. Most memory lives outside the prompt and only becomes hot context when the system decides it is relevant for a particular step.

It also clarifies the harness. In large part, the harness is a context compiler operating against a larger environment: it selects from warm and cold state, builds the hot context for the current step, exposes the allowed action surface, and manages the control loop around that step.

In `holaOS`, these things should still hold:

- the workspace contract and authored structure as durable cold context
- memory and continuity surfaces as warm and cold context that survive across runs
- capability projection and visibility rules
- app and integration wiring
- output artifacts and operator visibility
- the system's ability to resume work across time, even if a different harness compiles the next hot context differently

When those invariants must survive a harness swap, the environment is not incidental. It becomes a first-class contract around the harness and one of the main units the system is designed to preserve.


## The environment contract

The `holaOS` environment is not one flat bag of features. It defines several layers of state around the harness boundary.

### Durable authored state

- the workspace root and its authored structure
- app manifests, skills, commands, and standing instructions
- the template and packaging boundaries that define a reproducible starting shape

### Durable adaptive state

- memory that can survive across runs
- durable outputs, reusable artifacts, and evaluation traces
- operator feedback, approvals, and other reward-like signals
- reviewed improvements such as promoted memory or reusable skills

### Runtime continuity state

- turn results, snapshots, checkpoints, and session-scoped continuity records
- runtime-owned state that helps future runs restore context coherently
- warm context that keeps the next step or next run cheap to resume without promoting everything into durable memory

### Projected execution state

- the visible and callable surface passed to the harness for a run
- selected model routing, attachments, MCP visibility, permissions, and run metadata
- the step-specific hot context package compiled from warm and cold state

Some of these surfaces are already concrete in `holaOS` today. Others are part of the architectural direction. The thesis is about the system boundary: these concerns should be modeled as one environment contract rather than scattered across executor-specific behavior.

## Portability is a design goal, not just an export button

Long-horizon systems need more than persistence. They need a durable unit that can be inspected, packaged, moved, and rehydrated without losing the operating shape of the role they are meant to carry.

In `holaOS`, that means treating authored workspace content, learned state, and runtime-owned residue as different categories with different packaging rules. The architectural goal is not that every piece of runtime state travels everywhere. The goal is that the durable environment can be reproduced deliberately, with clear boundaries around what belongs in the portable unit and what remains transient.

That distinction matters because portability should be designed into the environment contract, not retrofitted after the fact.

## Learning loops are enablers, not the goal

Long-horizon work is the goal. That includes both bounded long-horizon tasks and sustained role performance across many runs and changing conditions. Continual learning, memory evolution, reflection, and reinforcement are possible mechanisms for helping the system get better at that goal.

Those mechanisms only become system capability when the environment can hold durable records of:

- the hot context it acted under, and the warm or cold state it was drawn from
- the action surface it was allowed to use
- the outcomes, evaluations, and operator feedback that judged the run
- the review boundary that decides what may become durable memory, skill, policy, or capability

If those trajectories and feedback signals are trapped inside one executor, they may help that one loop, but they do not reliably improve the system's ability to handle long-horizon work across time.

In `holaOS`, the point of these learning loops is not to make learning the center of the architecture. The point is to give long-horizon tasks and continuing roles a durable operating boundary where useful evidence can accumulate into better memory, stronger skills, safer policy, and other reviewed capability over time.

## Improvement needs somewhere durable to land

Long-horizon work is not just “a longer chat.” Sometimes it appears as a bounded task that takes many steps and many runs to finish. Sometimes it appears as work performed in a continuing role. In both cases, it has to continue coherently across runs, survive interruptions, and stay inspectable to both the operator and the system. Systems do not get better at that work just because an executor had a good run. Improvement becomes systemic only when reviewed outcomes can become durable state.

In `holaOS` today, the clearest landing zones are durable memory, evolve flows, and candidate skills. The broader direction is larger than that: repeated good work should become inspectable system capability rather than staying trapped inside a transient execution loop. Over time, that could expand into stronger policy, reusable packaged behavior, and other reviewed capability surfaces.

## Why this is a system thesis

This page is not mainly arguing about where current frameworks draw the line. Its point is narrower and more architectural: if long-horizon tasks and continuing roles span many runs and many possible improvement loops, then the system needs a durable contract that organizes the relevant state and evidence across them.

That is the role of environment engineering in `holaOS`. The environment owns the durable state. The harness compiles that state into hot context and action for each step. Portability, inspectability, continuity, capability governance, and optional learning loops all sit inside that operating boundary rather than existing as a loose collection of adjacent features.


## What this means in practice

If you are building on `holaOS`, you are building against an environment contract, not just writing tools for a harness:

- apps are packaged into workspace-local `apps/<app-id>/`
- skills are packaged into workspace-local `skills/`
- memory has explicit storage and governance rules
- the runtime decides capability visibility per run
- the desktop app is one operator shell, not the only surface

That shift is what makes the system easier to inspect, package, resume, and extend.

## Read next

<DocCards>
  <DocCard
    title="Environment Engineering"
    eyebrow="Original Version"
    href="/holaos/environment-engineering"
    description="Compare the original phrasing of the thesis against this V2 draft."
  />
  <DocCard
    title="Workspace Model"
    eyebrow="Environment Contract"
    href="/holaos/workspace-model"
    description="See how the authored workspace and runtime-owned state are separated."
  />
  <DocCard
    title="Memory and Continuity"
    eyebrow="Long-Horizon State"
    href="/holaos/memory-and-continuity/"
    description="Learn how durable memory and runtime continuity make work resume coherently."
  />
  <DocCard
    title="Build on holaOS"
    eyebrow="Developer Path"
    href="/build-on-holaos/"
    description="Move from the thesis into the concrete developer paths for runtime work, apps, and templates."
  />
</DocCards>
