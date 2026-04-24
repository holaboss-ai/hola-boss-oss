import type { Theme } from "vitepress";
import { useData } from "vitepress";
import DefaultTheme from "vitepress/theme";
import { createMermaidRenderer } from "vitepress-mermaid-renderer";
import { h, nextTick, watch } from "vue";
import DiagramFileTree from "./components/DiagramFileTree.vue";
import DiagramLocalStack from "./components/DiagramLocalStack.vue";
import DiagramStepFlow from "./components/DiagramStepFlow.vue";
import DiagramSystemOverview from "./components/DiagramSystemOverview.vue";
import DiagramWorkspaceTree from "./components/DiagramWorkspaceTree.vue";
import DocCard from "./components/DocCard.vue";
import DocCards from "./components/DocCards.vue";
import DocDefinition from "./components/DocDefinition.vue";
import DocStep from "./components/DocStep.vue";
import DocSteps from "./components/DocSteps.vue";
import DocTerm from "./components/DocTerm.vue";
import GlobalTopBar from "./components/GlobalTopBar.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout: () => {
    const { isDark } = useData();

    const initMermaid = () => {
      createMermaidRenderer({
        theme: isDark.value ? "dark" : "neutral",
      });
    };

    nextTick(() => initMermaid());

    watch(
      () => isDark.value,
      () => {
        initMermaid();
      }
    );

    return h(DefaultTheme.Layout, null, {
      "layout-top": () => h(GlobalTopBar),
    });
  },
  enhanceApp({ app }) {
    app.component("DocCards", DocCards);
    app.component("DocCard", DocCard);
    app.component("DocSteps", DocSteps);
    app.component("DocStep", DocStep);
    app.component("DocDefinition", DocDefinition);
    app.component("DocTerm", DocTerm);
    app.component("DiagramSystemOverview", DiagramSystemOverview);
    app.component("DiagramWorkspaceTree", DiagramWorkspaceTree);
    app.component("DiagramStepFlow", DiagramStepFlow);
    app.component("DiagramLocalStack", DiagramLocalStack);
    app.component("DiagramFileTree", DiagramFileTree);
  },
} satisfies Theme;
