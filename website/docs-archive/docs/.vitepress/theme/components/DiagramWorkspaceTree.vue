<template>
  <div class="hb-diagram-tree">
    <ul class="hb-tree">
      <li class="hb-tree__item hb-tree__item--root">
        <div class="hb-tree__node hb-tree__node--template">
          <span class="hb-tree__label">Template</span>
          <span class="hb-tree__meta">provisioning source</span>
        </div>
        <ul>
          <li class="hb-tree__item">
            <div class="hb-tree__node hb-tree__node--workspace">
              <span class="hb-tree__label">Workspace</span>
              <span class="hb-tree__meta">unit of work</span>
            </div>
            <ul>
              <li class="hb-tree__item">
                <div class="hb-tree__node hb-tree__node--skill">
                  <span class="hb-tree__label">Skills</span>
                  <span class="hb-tree__meta">instruction packs</span>
                </div>
              </li>
              <li class="hb-tree__item">
                <div class="hb-tree__node hb-tree__node--leaf">
                  <span class="hb-tree__label">Workspace Commands</span>
                  <span class="hb-tree__meta">explicit runnable capabilities</span>
                </div>
              </li>
              <li class="hb-tree__item">
                <div class="hb-tree__node hb-tree__node--app">
                  <span class="hb-tree__label">Apps</span>
                  <span class="hb-tree__meta">capability modules — code-based</span>
                </div>
                <ul>
                  <li class="hb-tree__item">
                    <div class="hb-tree__node hb-tree__node--leaf">
                      <span class="hb-tree__label">MCP Tools</span>
                      <span class="hb-tree__meta">what the runtime can project</span>
                    </div>
                  </li>
                  <li class="hb-tree__item">
                    <div class="hb-tree__node hb-tree__node--leaf">
                      <span class="hb-tree__label">Web UI</span>
                      <span class="hb-tree__meta">what the user can see</span>
                    </div>
                  </li>
                  <li class="hb-tree__item">
                    <div class="hb-tree__node hb-tree__node--integration">
                      <span class="hb-tree__label">Integration Requirements</span>
                      <span class="hb-tree__meta">what credentials it needs</span>
                    </div>
                    <ul>
                      <li class="hb-tree__item">
                        <div class="hb-tree__node hb-tree__node--leaf">
                          <span class="hb-tree__label">Bindings</span>
                          <span class="hb-tree__meta">which account serves which app</span>
                        </div>
                      </li>
                      <li class="hb-tree__item">
                        <div class="hb-tree__node hb-tree__node--leaf">
                          <span class="hb-tree__label">Connections</span>
                          <span class="hb-tree__meta">authenticated external accounts</span>
                        </div>
                      </li>
                    </ul>
                  </li>
                </ul>
              </li>
            </ul>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hb-diagram-tree {
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg-soft);
  padding: 28px 24px;
  overflow-x: auto;
}

/* Reset list styles */
.hb-tree,
.hb-tree ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hb-tree ul {
  padding-left: 24px;
  border-left: 2px solid var(--vp-c-divider);
  margin-left: 12px;
  margin-top: 4px;
}

.hb-tree__item {
  position: relative;
  padding: 3px 0;
}

/* Horizontal connector */
.hb-tree ul > .hb-tree__item::before {
  content: "";
  position: absolute;
  top: 16px;
  left: -24px;
  width: 20px;
  height: 0;
  border-top: 2px solid var(--vp-c-divider);
}

.hb-tree__node {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  transition: border-color 0.15s, background 0.15s;
}

.hb-tree__node:hover {
  border-color: var(--vp-c-brand-1);
}

.hb-tree__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.hb-tree__meta {
  font-size: 12px;
  color: var(--vp-c-text-3);
}

/* Color accents per type */
.hb-tree__node--template {
  border-color: var(--vp-c-brand-soft);
  background: oklch(0.68 0.2 32 / 4%);
}

.hb-tree__node--workspace {
  border-color: var(--vp-c-brand-soft);
  background: oklch(0.68 0.2 32 / 4%);
}

.hb-tree__node--agent {
  border-color: oklch(0.68 0.15 250 / 30%);
  background: oklch(0.68 0.15 250 / 4%);
}

.hb-tree__node--skill {
  border-color: oklch(0.65 0.18 155 / 30%);
  background: oklch(0.65 0.18 155 / 4%);
}

.hb-tree__node--app {
  border-color: var(--vp-c-brand-soft);
  background: oklch(0.68 0.2 32 / 4%);
}

.hb-tree__node--integration {
  border-style: dashed;
  border-color: oklch(0.65 0.15 280 / 30%);
  background: oklch(0.65 0.15 280 / 4%);
}

.hb-tree__node--leaf {
  border-color: var(--vp-c-divider);
  background: transparent;
}

/* Dark mode adjustments */
.dark .hb-tree__node--template,
.dark .hb-tree__node--workspace,
.dark .hb-tree__node--app {
  background: oklch(0.68 0.2 32 / 6%);
}

.dark .hb-tree__node--agent {
  background: oklch(0.68 0.15 250 / 6%);
}

.dark .hb-tree__node--skill {
  background: oklch(0.65 0.18 155 / 6%);
}

.dark .hb-tree__node--integration {
  background: oklch(0.65 0.15 280 / 6%);
}
</style>
