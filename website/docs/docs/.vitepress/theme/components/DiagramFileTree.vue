<script setup lang="ts">
export interface FileNode {
  name: string;
  meta?: string;
  accent?: "brand" | "engine" | "context";
  children?: FileNode[];
}

defineProps<{
  root: FileNode;
}>();
</script>

<template>
  <div class="hb-diagram-filetree">
    <ul class="hb-ft">
      <FileTreeNode :node="root" :depth="0" />
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent, h } from "vue";
import type { PropType } from "vue";

const FileTreeNode = defineComponent({
  name: "FileTreeNode",
  props: {
    node: { type: Object as PropType<FileNode>, required: true },
    depth: { type: Number, default: 0 },
  },
  render() {
    const { node, depth } = this;

    const accentClass = node.accent
      ? `hb-ft__node--${node.accent}`
      : "hb-ft__node--default";

    const nodeEl = h("div", { class: ["hb-ft__node", accentClass] }, [
      h("span", { class: "hb-ft__name" }, node.name),
      node.meta ? h("span", { class: "hb-ft__meta" }, node.meta) : null,
    ]);

    const childrenEl =
      node.children && node.children.length > 0
        ? h(
            "ul",
            { class: "hb-ft__children" },
            node.children.map((child) =>
              h("li", { class: "hb-ft__item", key: child.name }, [
                h(FileTreeNode, { node: child, depth: depth + 1 }),
              ])
            )
          )
        : null;

    return h("div", { class: "hb-ft__entry" }, [nodeEl, childrenEl]);
  },
});
</script>

<style scoped>
.hb-diagram-filetree {
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  background: var(--vp-c-bg-soft);
  padding: 24px;
  overflow-x: auto;
}

.hb-ft,
.hb-ft ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hb-ft {
  min-width: max-content;
}

:deep(.hb-ft__children) {
  list-style: none;
  padding-left: 20px;
  border-left: 2px solid var(--vp-c-divider);
  margin-left: 10px;
  margin-top: 2px;
}

:deep(.hb-ft__item) {
  list-style: none;
  position: relative;
  padding: 2px 0;
}

:deep(.hb-ft__item::before) {
  content: "";
  position: absolute;
  top: 14px;
  left: -20px;
  width: 16px;
  height: 0;
  border-top: 2px solid var(--vp-c-divider);
}

:deep(.hb-ft__node) {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  transition: border-color 0.15s;
}

:deep(.hb-ft__node:hover) {
  border-color: var(--vp-c-brand-1);
}

:deep(.hb-ft__node--brand) {
  border-color: var(--vp-c-brand-soft);
  background: oklch(0.68 0.2 32 / 4%);
}

:deep(.hb-ft__node--engine) {
  border-color: oklch(0.68 0.15 250 / 20%);
  background: oklch(0.68 0.15 250 / 4%);
}

:deep(.hb-ft__node--context) {
  border-color: oklch(0.65 0.18 155 / 20%);
  background: oklch(0.65 0.18 155 / 4%);
}

:deep(.hb-ft__node--default) {
  border-color: var(--vp-c-divider);
}

:deep(.hb-ft__name) {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  font-family: var(--vp-font-family-mono);
}

:deep(.hb-ft__meta) {
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.dark :deep(.hb-ft__node--brand) {
  background: oklch(0.68 0.2 32 / 6%);
}

.dark :deep(.hb-ft__node--engine) {
  background: oklch(0.68 0.15 250 / 6%);
}

.dark :deep(.hb-ft__node--context) {
  background: oklch(0.65 0.18 155 / 6%);
}
</style>
