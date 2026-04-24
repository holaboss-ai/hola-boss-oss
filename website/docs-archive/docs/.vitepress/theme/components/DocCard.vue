<script setup lang="ts">
import { withBase } from "vitepress";
import { computed } from "vue";

const props = defineProps<{
  title: string;
  description?: string;
  href?: string;
  eyebrow?: string;
}>();

// biome-ignore lint/correctness/noUnusedVariables: used in Vue template
const tagName = computed(() => (props.href ? "a" : "div"));
// biome-ignore lint/correctness/noUnusedVariables: used in Vue template
const resolvedHref = computed(() =>
  props.href ? withBase(props.href) : undefined
);
</script>

<template>
  <component :is="tagName" :href="resolvedHref" class="hb-doc-card">
    <div v-if="eyebrow" class="hb-doc-card__eyebrow">{{ eyebrow }}</div>
    <div class="hb-doc-card__title">{{ title }}</div>
    <div v-if="description" class="hb-doc-card__description">{{ description }}</div>
    <div v-if="$slots.default" class="hb-doc-card__description">
      <slot />
    </div>
  </component>
</template>
