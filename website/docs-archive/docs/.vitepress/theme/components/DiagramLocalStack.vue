<template>
  <div class="hb-diagram-stack">
    <div class="hb-diagram-stack__pipeline">
      <!-- Desktop -->
      <section class="hb-diagram-stack__layer hb-diagram-stack__layer--surface">
        <div class="hb-diagram-stack__layer-label">🖥️ Desktop</div>
        <div class="hb-diagram-stack__node">
          <span class="hb-diagram-stack__node-name">Electron UI</span>
          <span class="hb-diagram-stack__node-meta">Operator surface</span>
        </div>
      </section>

      <div class="hb-diagram-stack__arrow" aria-hidden="true">→</div>

      <!-- Runtime -->
      <section class="hb-diagram-stack__layer hb-diagram-stack__layer--engine">
        <div class="hb-diagram-stack__layer-label">⚙️ Runtime Bundle</div>
        <div class="hb-diagram-stack__runtime-grid">
          <div class="hb-diagram-stack__node">
            <span class="hb-diagram-stack__node-name">Embedded Runtime API</span>
            <span class="hb-diagram-stack__node-meta">Fastify :5160 in desktop dev</span>
          </div>
          <div class="hb-diagram-stack__node">
            <span class="hb-diagram-stack__node-name">State Store</span>
            <span class="hb-diagram-stack__node-meta">SQLite runtime.db</span>
          </div>
          <div class="hb-diagram-stack__boundary">
            <div class="hb-diagram-stack__boundary-label">Execution Boundary</div>
            <div class="hb-diagram-stack__boundary-row">
              <div class="hb-diagram-stack__node hb-diagram-stack__node--compact">
                <span class="hb-diagram-stack__node-name">Harness Host</span>
                <span class="hb-diagram-stack__node-meta">Runtime-owned bridge</span>
              </div>
              <div class="hb-diagram-stack__inline-arrow" aria-hidden="true">→</div>
              <div class="hb-diagram-stack__node hb-diagram-stack__node--compact">
                <span class="hb-diagram-stack__node-name">Agent Harness</span>
                <span class="hb-diagram-stack__node-meta">Selected executor</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="hb-diagram-stack__arrow" aria-hidden="true">→</div>

      <!-- Workspace -->
      <section class="hb-diagram-stack__layer hb-diagram-stack__layer--context">
        <div class="hb-diagram-stack__layer-label">📂 Workspace</div>
        <div class="hb-diagram-stack__workspace-grid">
          <div class="hb-diagram-stack__node">
            <span class="hb-diagram-stack__node-name">Workspace Apps</span>
            <span class="hb-diagram-stack__node-meta">MCP + UI + Jobs</span>
          </div>
          <div class="hb-diagram-stack__node">
            <span class="hb-diagram-stack__node-name">Workspace Files</span>
            <span class="hb-diagram-stack__node-meta">AGENTS.md · workspace.yaml · apps/skills</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hb-diagram-stack {
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg-soft);
  padding: 22px 18px;
  container-type: inline-size;
}

.hb-diagram-stack__pipeline {
  display: grid;
  grid-template-columns:
    minmax(132px, 0.9fr)
    auto
    minmax(240px, 1.3fr)
    auto
    minmax(168px, 1fr);
  align-items: stretch;
  column-gap: 10px;
}

.hb-diagram-stack__layer {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--vp-c-bg);
  transition: border-color 0.2s;
  min-width: 0;
  height: 100%;
}

.hb-diagram-stack__layer:hover {
  border-color: var(--vp-c-brand-1);
}

.hb-diagram-stack__layer-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-3);
}

.hb-diagram-stack__layer--surface .hb-diagram-stack__layer-label {
  color: var(--vp-c-brand-2);
}

.hb-diagram-stack__layer--engine .hb-diagram-stack__layer-label {
  color: var(--vp-c-brand-1);
}

.hb-diagram-stack__layer--context .hb-diagram-stack__layer-label {
  color: var(--vp-c-brand-3);
}

.hb-diagram-stack__node {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  border: 1px solid color-mix(in srgb, var(--vp-c-divider) 86%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 72%, transparent);
  padding: 10px 12px;
}

.hb-diagram-stack__node--compact {
  flex: 1;
  min-width: 0;
}

.hb-diagram-stack__node-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.hb-diagram-stack__node-meta {
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.hb-diagram-stack__runtime-grid,
.hb-diagram-stack__workspace-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.hb-diagram-stack__boundary {
  grid-column: 1 / -1;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 12px;
  padding: 10px 12px;
  background: var(--vp-c-bg-soft);
}

.hb-diagram-stack__boundary-label {
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.hb-diagram-stack__boundary-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hb-diagram-stack__arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vp-c-text-3);
  font-size: 16px;
  font-weight: 400;
  flex-shrink: 0;
}

.hb-diagram-stack__inline-arrow {
  color: var(--vp-c-text-3);
  font-size: 14px;
  flex-shrink: 0;
}

@container (max-width: 720px) {
  .hb-diagram-stack__pipeline {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .hb-diagram-stack__layer--surface,
  .hb-diagram-stack__layer--context,
  .hb-diagram-stack__layer--engine {
    width: 100%;
    max-width: none;
    justify-self: stretch;
  }

  .hb-diagram-stack__node {
    align-items: flex-start;
    text-align: left;
  }

  .hb-diagram-stack__boundary {
    width: 100%;
    max-width: none;
  }

  .hb-diagram-stack__arrow {
    transform: rotate(90deg);
    justify-self: center;
  }

  .hb-diagram-stack__boundary-row {
    justify-content: center;
  }
}

@container (max-width: 560px) {
  .hb-diagram-stack {
    padding: 18px 14px;
  }

  .hb-diagram-stack__runtime-grid,
  .hb-diagram-stack__workspace-grid {
    grid-template-columns: 1fr;
  }

  .hb-diagram-stack__boundary-row {
    flex-direction: column;
    align-items: stretch;
  }

  .hb-diagram-stack__inline-arrow {
    align-self: center;
    transform: rotate(90deg);
  }
}
</style>
