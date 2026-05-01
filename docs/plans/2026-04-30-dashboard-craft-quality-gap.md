---
title: Dashboard 质感对标 craft-agents-oss
date: 2026-04-30
status: analysis
related:
  - 2026-04-30-dashboard-v2-design.md
---

# 我们 vs craft-agents-oss — 质感差在哪

读了 craft-agents-oss 的 `packages/ui/src/styles/index.css`、`Island.tsx`、`MarkdownDatatableBlock.tsx`、`TurnCard.tsx` 之后的结论：**功能我们已经基本对齐甚至超出**（dashboard、stat_grid、charts、view tabs 这些他们没有）。差距集中在 5 个层面：阴影体系、颜色 mix 体系、字体/字号、滚动条/边角、动画。

下面按"看一眼就发现"到"打磨级"的顺序排。

## 1. 阴影体系是我们最大的差距（一眼能看出来）

**他们怎么做：** 5-6 层 box-shadow 叠加，graduated depth。比如 hero card：

```css
.shadow-hero {
  box-shadow:
    rgba(var(--foreground-rgb), 0.06) 0px 0px 0px 1px,    /* 1px 边框环 */
    rgba(0, 0, 0, 0.06) 0px 1px 1px -0.5px,                /* 紧贴的小阴影 */
    rgba(0, 0, 0, 0.06) 0px 3px 3px -1.5px,                /* 中近距离 */
    rgba(0, 0, 0, 0.06) 0px 6px 6px -3px,                  /* 中距离 */
    rgba(0, 0, 0, 0.04) 0px 12px 12px -6px,                /* 远距离 */
    rgba(0, 0, 0, 0.03) 0px 24px 32px -12px,               /* 软层 */
    rgba(0, 0, 0, 0.02) 0px 48px 64px -24px;               /* 最软的环境光 */
}
```

5 个名字：`shadow-minimal`、`shadow-middle`、`shadow-medium`、`shadow-hero`、`shadow-strong`，分别对应"贴在页面上"到"悬浮"。每张 Island/Card 选一个。

**我们怎么做：** 单层 `shadow-[0_0_0_1px_oklch(0_0_0/0.02)]` —— 就是个 1px 边框环，没真正的阴影。结果是 stat_grid surface 看起来"贴"在页面上而不是"浮"在页面上，完全没层次感。

**差距视觉效果：** 他们的卡片像一张厚卡纸放在桌上，**有重量、有距离**；我们的卡片像贴纸贴在墙上，扁平。

**修法：** 把 5 个 shadow utility 直接抄过来（`packages/ui/src/styles/index.css:361-433` 整段），dashboard 各 panel：

| Panel | Shadow |
|---|---|
| `text` | 无 |
| `kpi` 单独 | 无（直接放页面上，最少干扰） |
| `stat_grid`、`data_view`、`chart` | `shadow-minimal` |
| Modal / Popover / `gallery` 卡片 | `shadow-modal-small` |
| Hero（首页头图等） | `shadow-hero` |

## 2. `color-mix` 实底变体 vs 我们的 alpha 透明

**他们：**
```css
--foreground-2:  color-mix(in oklch, var(--foreground) 2%,  var(--background));
--foreground-3:  color-mix(in oklch, var(--foreground) 3%,  var(--background));
--foreground-5:  color-mix(in oklch, var(--foreground) 5%,  var(--background));
/* …一路到 -95 */
```

→ `bg-foreground-5` 是**实色**（深 5% 的灰蓝），跟页面分得清清楚楚。

**我们：** `bg-muted/40` —— alpha 透明，叠在 `bg-background` 上是同色相的浅色，**对比不够**。这就是你之前指出 "stat_grid surface 应该有背景色"的根本原因 —— 我后来改成 `bg-card` 解决了那一处，但全 dashboard 还有几十处 `bg-muted/30`、`bg-muted/40`、`bg-muted/50` 在偷懒。

**差距视觉效果：** 同一个面板悬浮在白色页面上，他们的灰阶分得清晰一层一层；我们的多层灰阶糊在一起。Light mode 尤其明显。

**修法：** 加一组 mix 变体到 desktop 的 css tokens。所有 dashboard 内部用 `bg-foreground-3` / `bg-foreground-5` / `bg-foreground-10` 替代 `bg-muted/30~50`。这是个**搜索-替换级别**的改动，影响面小但视觉提升立竿见影。

## 3. Tinted shadow（带颜色的阴影）

**他们：** `shadow-tinted` 用 CSS 变量 `--shadow-color`，每张卡片可以带自己的色调阴影：

```html
<div class="shadow-tinted" style="--shadow-color: 34, 120, 60">
  <!-- success-tinted shadow -->
</div>
```

绿色 success 卡片下方就有淡淡的绿色光晕，红色 error 卡片有淡红光晕。Notion 就是这么做的。

**我们：** 没有概念。所有 chip/badge 都只有平面颜色。

**修法：** 加 `.shadow-tinted` utility（直接抄）。在 KpiCard 的 delta 芯片、Board card 的 group_colors 行、status chip 上选择性应用。**不要乱用** —— 只在状态语义强的地方加，否则 dashboard 看起来像圣诞树。

## 4. 字号 + 字体系统

**他们：**
- `--font-size-base: 15px`（默认字号 15，不是 16）
- `--font-mono: "JetBrains Mono"` 默认是 JetBrains，统一好看
- 可选 Inter via `html[data-font="inter"]`，激活 `font-feature-settings: "cv01" "cv02" "cv03" "cv04" "case"`（启用替代字形）

**我们：** 用系统默认 16px、`tabular-nums` 是 ad-hoc 在数字列上加。

**差距视觉效果：** 15px 给整个产品一种"工程师 / 编辑器"的细密感（Linear / Cursor 都用 14-15px）；16px 默认是文档型的，dashboard 用着会显得"松散"。

**修法：**
- 把 desktop 的 `--font-size-base` 设 15px
- 表格里所有数字加 `font-feature-settings: "tnum" "lnum"`（tabular + lining numerals 同时启用，比单 `tabular-nums` 视觉对齐更整齐）
- KpiCard 的大数字 (28px) 用 mono 字体可能更"工业"，可选
- 把 JetBrains Mono 加入 desktop bundle，设为默认 mono

## 5. 边角处理 + 滚动条

**他们：**
- `border-radius: 0` 默认（部分 utility 显式 8px、12px）→ 整体偏 Notion-Linear 锋利感
- `corner-shape: superellipse`（iOS 那种连续角） in `.smooth-corners` utility
- 自定义滚动条 8px 宽，`scrollbar-thumb` 用 `var(--border)`，hover 变 `var(--muted-foreground)`
- `.scrollbar-hover` —— 只在父级 hover 时才显示（Notion 的"幽灵滚动条"）

**我们：** 默认 webkit 滚动条（粗、硬、灰、跨平台不一致）；圆角到处 `rounded-md` / `rounded-lg`。

**修法：**
- 把他们的 scrollbar styles 整段抄过来
- 加 `.smooth-corners` utility（一行 CSS）
- dashboard 的 panel border-radius 从 `rounded-xl` 降到 `rounded-[10px]` + `smooth-corners`，更精致
- DataView 内部的滚动区加 `.scrollbar-hover` —— 鼠标不在面板上时滚动条隐藏

## 6. 动画 / 加载态

**他们：**
- `animate-shimmer` —— 一个移动的渐变 sweep 通过 `::after` 伪元素覆盖整个元素，loading skeleton 上叠这个 → 真正"水波"质感
- `.spinner` —— 9 个小立方体（3×3 grid）按波浪节奏淡入淡出，比单纯的 spin 圆圈高级
- 主要 transition 用 `200ms ease-out`，hover state 是 50-100ms

**我们：** Skeleton 是 5 行 `animate-pulse` —— `pulse` 是默认 Tailwind 的"整个变浅再变深"，没方向感。

**差距视觉效果：** 他们的 loading 让人觉得"东西正在朝你来"；我们的 loading 让人觉得"等会再说"。

**修法：**
- Skeleton 行加 `animate-shimmer` 取代 `animate-pulse`
- KpiCard 加载时用 9-cube spinner 取代 `h-7 w-24 animate-pulse`（spinner 比骨架更适合"还没数"的场景）

## 7. 表格的两个小细节我们直接漏了

**Sortable headers：** 他们的表头点一下就 `ASC → DESC → null`，旁边有 ↕️ / ↑ / ↓ 图标。我们是静态的。

**Edge fade mask：** 横向滚动的表格用 `mask-image` 渐隐左右边缘，明示"还有更多"。我们是硬切。

**修法：**
- TableView 加 `useState<{key, dir}>` + 表头 click handler，本地 sort
- 横向滚动的 div 加 `mask-image: linear-gradient(to right, transparent 0, black 24px, black calc(100% - 24px), transparent 100%)`，边缘自动淡出

## 8. 我们已经做对的

为了不全负面，列一下：

- View tab 的 animated indicator pill（craft 没有；他们的 view 切换是直接重 mount）
- KPI Δ 芯片 + 进度条（他们 KPI 没那么 fancy）
- Stat_grid bordered surface（这个 craft 也没有，是 Notion 那条线的）
- 列格式自动右对齐 + tabular-nums（craft 也是这样做）
- Board 的 group_by picker（**这是我们超过他们的地方**——他们的 board 没有 runtime group_by 切换；他们的 datatable 才有）

## 9. 优先级建议

| # | 改动 | 视觉冲击 | 工时 | 备注 |
|---|---|---|---|---|
| 1 | 阴影 utility 5 个 + 应用到 dashboard panels | **高** | 1h | 直接抄 CSS，搜替换 className |
| 2 | `--foreground-N` mix 变体 + 替换 `bg-muted/N0` 系列 | **高** | 2h | 全局体感提升 |
| 3 | 字号 15px + JetBrains Mono + tnum/lnum | 中 | 1h | 一锤定音改产品质感 |
| 4 | 自定义滚动条 + smooth-corners | 中 | 30min | 直接抄 |
| 5 | Shimmer skeleton 取代 pulse | 中 | 30min | 加一段 keyframes + 改 className |
| 6 | Tinted shadow + 选择性应用 | 低-中 | 1h | 慎用，只放 status-语义强的地方 |
| 7 | Table sortable headers + edge mask | 中 | 2h | TableView 内部改造 |
| 8 | 9-cube spinner 替代 KPI 加载骨架 | 低 | 30min | 小爽点 |

**总计 ~8h。** 第 1+2 两条做完已经能拿到 60% 的视觉提升。**优先做 1+2+3。**

## 10. 不该抄的

为了不被牵着鼻子走，几个 craft 的设计选择我们**不该**复制：

- **`border-radius: 0` 默认** —— 太锋利，跟 Holaboss 的"creator/orange-warm"品牌冲突。我们 `rounded-[10px]` + `smooth-corners` 才对。
- **6 色语义系统**（accent/info/success/destructive） —— 我们的 7 色 status palette（user-facing）+ chart 7 色（decorative）已经足够；混进 craft 的"info/success/destructive"反而把语义和装饰搅在一起。
- **Sentry 类的 telemetry 集成** —— 出现在他们 `package.json` 但跟我们这次任务无关。

## 11. 一句话总结

**功能我们已经赶上甚至超过；质感差在阴影、灰阶 mix、字号、滚动条 4 个小事一起做。**

Craft 的视觉权威感来自"系统化的小细节叠加"——任何一项都不是大事，但 30 项做齐就有了 Apple/Linear 那种"专业产品"的气场。我们目前是"对了 25 项，漏了 5 项"——拉的就是这 5 项。
