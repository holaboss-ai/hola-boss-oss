<template>
  <div class="hb-diagram-system">
    <div class="hb-diagram-system__shell">
      <section class="hb-diagram-system__surface">
        <div class="hb-diagram-system__eyebrow">Product Surface</div>
        <div class="hb-diagram-system__title">Holaboss Desktop</div>
        <p class="hb-diagram-system__copy">
          Operator shell for opening workspaces, configuring models, inspecting state,
          and launching the runtime.
        </p>
      </section>

      <div class="hb-diagram-system__arrow" aria-hidden="true">→</div>

      <section class="hb-diagram-system__os">
        <div class="hb-diagram-system__os-header">
          <span class="hb-diagram-system__badge">holaOS</span>
          <p class="hb-diagram-system__os-copy">
            Environment layer = workspace contract + runtime services + harness
            boundary
          </p>
        </div>

        <div class="hb-diagram-system__grid">
          <article class="hb-diagram-system__card">
            <div class="hb-diagram-system__eyebrow">Workspace Contract</div>
            <div class="hb-diagram-system__title">Workspace</div>
            <div class="hb-diagram-system__chips">
              <span class="hb-diagram-system__chip">workspace.yaml</span>
              <span class="hb-diagram-system__chip">AGENTS.md</span>
              <span class="hb-diagram-system__chip">Commands</span>
              <span class="hb-diagram-system__chip">Apps</span>
              <span class="hb-diagram-system__chip">Skills</span>
            </div>
            <p class="hb-diagram-system__copy">
              The authored environment surface the runtime reads and compiles per run after workspace creation.
            </p>
          </article>

          <article class="hb-diagram-system__card hb-diagram-system__card--runtime">
            <div class="hb-diagram-system__eyebrow">Runtime Services</div>
            <div class="hb-diagram-system__title">Runtime</div>
            <div class="hb-diagram-system__chips">
              <span class="hb-diagram-system__chip">API Server</span>
              <span class="hb-diagram-system__chip">Memory</span>
              <span class="hb-diagram-system__chip">State Store</span>
              <span class="hb-diagram-system__chip">Continuity</span>
              <span class="hb-diagram-system__chip">App Orchestration</span>
              <span class="hb-diagram-system__chip">Capability Projection</span>
            </div>
            <p class="hb-diagram-system__copy">
              Owns memory, continuity, and the execution environment around the run,
              then prepares the reduced package the harness receives.
            </p>

            <div class="hb-diagram-system__subcard">
              <div class="hb-diagram-system__sub-eyebrow">Execution Boundary</div>
              <div class="hb-diagram-system__flow">
                <span class="hb-diagram-system__flow-node">Harness Host</span>
                <span class="hb-diagram-system__flow-arrow">→</span>
                <span class="hb-diagram-system__flow-node">Agent Harness</span>
              </div>
              <p class="hb-diagram-system__subcopy">
                The selected harness runs inside the runtime path, not beside the
                workspace or desktop.
              </p>
            </div>
          </article>
        </div>

        <p class="hb-diagram-system__footer">
          The runtime compiles the workspace contract into a reduced execution package,
          then hands that package to the selected harness.
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hb-diagram-system {
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg-soft);
  padding: 24px;
  container-type: inline-size;
}

.hb-diagram-system__shell {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hb-diagram-system__surface {
  flex: 0 1 250px;
  min-width: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
  padding: 18px;
}

.hb-diagram-system__os {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    var(--vp-c-brand-soft),
    color-mix(in srgb, var(--vp-c-bg) 94%, transparent)
  );
  padding: 18px;
}

.hb-diagram-system__os-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.hb-diagram-system__badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  color: white;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 5px 10px;
  white-space: nowrap;
}

.hb-diagram-system__os-copy {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}

.hb-diagram-system__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: 14px;
}

.hb-diagram-system__card {
  min-width: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  padding: 16px;
}

.hb-diagram-system__card--runtime {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hb-diagram-system__eyebrow,
.hb-diagram-system__sub-eyebrow {
  color: var(--vp-c-brand-2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hb-diagram-system__sub-eyebrow {
  color: var(--vp-c-text-3);
}

.hb-diagram-system__title {
  margin-top: 8px;
  color: var(--vp-c-text-1);
  font-size: 18px;
  font-weight: 600;
  line-height: 1.3;
}

.hb-diagram-system__copy,
.hb-diagram-system__subcopy,
.hb-diagram-system__footer {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 13px;
  line-height: 1.6;
}

.hb-diagram-system__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.hb-diagram-system__chip {
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
}

.hb-diagram-system__subcard {
  border: 1px dashed var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  padding: 14px;
}

.hb-diagram-system__flow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0 8px;
}

.hb-diagram-system__flow-node {
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 10px;
}

.hb-diagram-system__flow-arrow,
.hb-diagram-system__arrow {
  color: var(--vp-c-text-3);
  font-size: 18px;
  font-weight: 400;
  flex-shrink: 0;
}

.hb-diagram-system__footer {
  margin-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--vp-c-divider) 82%, transparent);
  padding-top: 14px;
}

@container (max-width: 980px) {
  .hb-diagram-system__grid {
    grid-template-columns: 1fr;
  }

  .hb-diagram-system__os-header {
    flex-direction: column;
    align-items: flex-start;
  }
}

@container (max-width: 760px) {
  .hb-diagram-system__shell,
  .hb-diagram-system__flow {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .hb-diagram-system__shell {
    gap: 14px;
  }

  .hb-diagram-system__surface {
    flex-basis: auto;
  }

  .hb-diagram-system__arrow,
  .hb-diagram-system__flow-arrow {
    align-self: center;
    transform: rotate(90deg);
  }
}
</style>
