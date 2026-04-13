<script setup lang="ts">
defineProps<{
  term: string;
  meta?: string;
}>();
</script>

<template>
  <div
    :id="term.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')"
    class="hb-doc-definition"
  >
    <div class="hb-doc-definition__term">
      <span>{{ term }}</span>
      <span v-if="meta" class="hb-doc-definition__meta">{{ meta }}</span>
    </div>
    <div class="hb-doc-definition__body">
      <slot />
    </div>
  </div>
</template>
