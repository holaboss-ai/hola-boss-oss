<script lang="ts">
import { useData, withBase } from "vitepress";
import VPNavBarAppearance from "vitepress/dist/client/theme-default/components/VPNavBarAppearance.vue";
import VPNavBarSocialLinks from "vitepress/dist/client/theme-default/components/VPNavBarSocialLinks.vue";
import { VPNavBarSearch } from "vitepress/theme";
import { computed, defineComponent } from "vue";

export default defineComponent({
  name: "GlobalTopBar",
  components: {
    VPNavBarAppearance,
    VPNavBarSocialLinks,
    VPNavBarSearch,
  },
  setup() {
    const { site, theme } = useData();

    const siteTitle = computed(() => theme.value.siteTitle ?? site.value.title);
    const logoSrc = computed(() =>
      typeof theme.value.logo === "string"
        ? withBase(theme.value.logo)
        : undefined
    );

    return {
      logoSrc,
      siteTitle,
      withBase,
    };
  },
});
</script>

<template>
  <header class="HBGlobalTopBar" aria-label="Global">
    <div class="HBGlobalTopBar__container">
      <a class="HBGlobalTopBar__brand" :href="withBase('/')">
        <img v-if="logoSrc" class="HBGlobalTopBar__logo" :src="logoSrc" alt="" />
        <span class="HBGlobalTopBar__title">{{ siteTitle }}</span>
      </a>

      <div class="HBGlobalTopBar__search">
        <VPNavBarSearch />
      </div>

      <div class="HBGlobalTopBar__actions">
        <VPNavBarSocialLinks class="HBGlobalTopBar__socials" />
        <VPNavBarAppearance class="HBGlobalTopBar__appearance" />
      </div>
    </div>
  </header>
</template>
