import {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
  DESKTOP_BROWSER_TOOL_IDS,
  type DesktopBrowserToolDefinition,
  type DesktopBrowserToolId,
} from "../../harnesses/src/desktop-browser-tools.js";
import { resolveProductRuntimeConfig, type ProductRuntimeConfig } from "./runtime-config.js";

export {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
  DESKTOP_BROWSER_TOOL_IDS,
  type DesktopBrowserToolDefinition,
  type DesktopBrowserToolId,
} from "../../harnesses/src/desktop-browser-tools.js";

export interface DesktopBrowserToolExecutionContext {
  workspaceId?: string | null;
  sessionId?: string | null;
  space?: "agent" | "user" | null;
}

export interface DesktopBrowserToolServiceLike {
  getStatus(context?: DesktopBrowserToolExecutionContext): Promise<Record<string, unknown>>;
  execute(
    toolId: string,
    args: Record<string, unknown>,
    context?: DesktopBrowserToolExecutionContext
  ): Promise<Record<string, unknown>>;
}

export interface DesktopBrowserToolServiceOptions {
  fetchImpl?: typeof fetch;
  resolveConfig?: () => ProductRuntimeConfig;
}

type BrowserFetchOptions = {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  workspaceId?: string | null;
  sessionId?: string | null;
  space?: "agent" | "user" | null;
};

type BrowserTargetKind = "element" | "media";

const INTERACTIVE_ELEMENTS_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='link']",
  "[contenteditable='true']",
  "[tabindex]"
].join(",");
const VISIBLE_MEDIA_SELECTOR = [
  "img",
  "video",
  "canvas",
  "[role='img']",
].join(",");

const BROWSER_GET_STATE_TEXT_MAX_CHARS = 2500;
const BROWSER_GET_STATE_ELEMENT_TEXT_MAX_CHARS = 120;
const BROWSER_GET_STATE_MEDIA_TEXT_MAX_CHARS = 240;
const BROWSER_GET_STATE_MAX_ATTEMPTS = 4;
const BROWSER_GET_STATE_RETRY_DELAY_MS = 350;


export class DesktopBrowserToolServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function optionalBoolean(value: unknown, defaultValue = false): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function optionalInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DesktopBrowserToolServiceError(400, "browser_tool_invalid_args", `${fieldName} is required`);
  }
  return value.trim();
}

function requiredPositiveInteger(value: unknown, fieldName: string): number {
  const parsed = optionalInteger(value);
  if (!parsed || parsed <= 0) {
    throw new DesktopBrowserToolServiceError(
      400,
      "browser_tool_invalid_args",
      `${fieldName} must be a positive integer`
    );
  }
  return parsed;
}

function browserToolDefinition(toolId: string): DesktopBrowserToolDefinition | null {
  return DESKTOP_BROWSER_TOOL_DEFINITIONS.find((tool) => tool.id === toolId) ?? null;
}

function browserToolHeaders(
  config: ProductRuntimeConfig,
  context: DesktopBrowserToolExecutionContext = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "x-holaboss-desktop-token": config.desktopBrowserAuthToken
  };
  const workspaceId = typeof context.workspaceId === "string" ? context.workspaceId.trim() : "";
  if (workspaceId) {
    headers["x-holaboss-workspace-id"] = workspaceId;
  }
  const sessionId = typeof context.sessionId === "string" ? context.sessionId.trim() : "";
  if (sessionId) {
    headers["x-holaboss-session-id"] = sessionId;
  }
  const browserSpace =
    context.space === "user" || context.space === "agent" ? context.space : "";
  if (browserSpace) {
    headers["x-holaboss-browser-space"] = browserSpace;
  }
  return headers;
}

function browserBaseUrl(config: ProductRuntimeConfig): string {
  return config.desktopBrowserUrl.replace(/\/+$/, "");
}

function ensureDesktopBrowserConfig(config: ProductRuntimeConfig): void {
  if (!config.desktopBrowserEnabled || !config.desktopBrowserUrl.trim() || !config.desktopBrowserAuthToken.trim()) {
    throw new DesktopBrowserToolServiceError(
      409,
      "desktop_browser_unavailable",
      "Desktop browser capability is not available in this runtime."
    );
  }
}

function evaluateExpressionPayload(expression: string): Record<string, unknown> {
  return { expression };
}

function serializedValue(value: unknown): string {
  return JSON.stringify(value);
}

function interactiveElementsExpression(includePageText: boolean): string {
  return `(() => {
    const selector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    const mediaSelector = ${serializedValue(VISIBLE_MEDIA_SELECTOR)};
    const includePageText = ${includePageText ? "true" : "false"};
    const textLimit = ${BROWSER_GET_STATE_ELEMENT_TEXT_MAX_CHARS};
    const mediaTextLimit = ${BROWSER_GET_STATE_MEDIA_TEXT_MAX_CHARS};
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const describe = (element, index) => {
      const rect = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute("role") || "";
      const type = "type" in element ? String(element.type || "") : "";
      const text = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, textLimit);
      const label = [
        element.getAttribute("aria-label") || "",
        "placeholder" in element ? String(element.placeholder || "") : "",
        "value" in element ? String(element.value || "") : "",
        text
      ].find((value) => Boolean(value)) || "";
      return {
        index,
        tag_name: tagName,
        role,
        type,
        text,
        label: label.slice(0, textLimit),
        disabled: "disabled" in element ? Boolean(element.disabled) : false,
        href: "href" in element ? String(element.href || "") : "",
        bounding_box: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    };
    const describeMedia = (element, index) => {
      const rect = element.getBoundingClientRect();
      const tagName = element.tagName.toLowerCase();
      const alt = element instanceof HTMLImageElement ? String(element.alt || "") : "";
      const ariaLabel = element.getAttribute("aria-label") || "";
      const text = (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, mediaTextLimit);
      const label = [alt, ariaLabel, text].find((value) => Boolean(value)) || "";
      const anchor = typeof element.closest === "function" ? element.closest("a[href]") : null;
      const currentSrc =
        element instanceof HTMLImageElement
          ? String(element.currentSrc || element.src || "")
          : element instanceof HTMLVideoElement
            ? String(element.currentSrc || element.poster || "")
            : element instanceof HTMLCanvasElement
              ? ""
              : String(element.getAttribute("src") || "");
      const mediaType =
        element instanceof HTMLImageElement
          ? "image"
          : element instanceof HTMLVideoElement
            ? "video"
            : element instanceof HTMLCanvasElement
              ? "canvas"
              : "media";
      return {
        index,
        media_type: mediaType,
        tag_name: tagName,
        label: label.slice(0, mediaTextLimit),
        alt: alt.slice(0, mediaTextLimit),
        text,
        src: "src" in element ? String(element.getAttribute("src") || "") : "",
        current_src: currentSrc,
        link_href: anchor instanceof HTMLAnchorElement ? String(anchor.href || "") : "",
        bounding_box: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    };
    const nodes = Array.from(document.querySelectorAll(selector))
      .filter((element) => isVisible(element))
      .filter((element, index, all) => all.indexOf(element) === index);
    const mediaNodes = Array.from(document.querySelectorAll(mediaSelector))
      .filter((element) => isVisible(element))
      .filter((element, index, all) => all.indexOf(element) === index);
    return {
      url: location.href,
      title: document.title,
      ...(includePageText
        ? { text: (document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, ${BROWSER_GET_STATE_TEXT_MAX_CHARS}) }
        : {}),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      elements: nodes.map((element, idx) => describe(element, idx + 1)),
      media: mediaNodes.map((element, idx) => describeMedia(element, idx + 1))
    };
  })()`;
}

function contextClickTargetExpression(target: BrowserTargetKind, index: number): string {
  return `(() => {
    const selector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    const mediaSelector = ${serializedValue(VISIBLE_MEDIA_SELECTOR)};
    const targetKind = ${serializedValue(target)};
    const targetIndex = ${index};
    const textLimit = ${BROWSER_GET_STATE_ELEMENT_TEXT_MAX_CHARS};
    const mediaTextLimit = ${BROWSER_GET_STATE_MEDIA_TEXT_MAX_CHARS};
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const describe = (element) => {
      const text = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, textLimit);
      const label = [
        element.getAttribute("aria-label") || "",
        "placeholder" in element ? String(element.placeholder || "") : "",
        "value" in element ? String(element.value || "") : "",
        text
      ].find((value) => Boolean(value)) || "";
      return {
        text,
        label: label.slice(0, textLimit)
      };
    };
    const describeMedia = (element) => {
      const alt = element instanceof HTMLImageElement ? String(element.alt || "") : "";
      const ariaLabel = element.getAttribute("aria-label") || "";
      const text = (element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, mediaTextLimit);
      const label = [alt, ariaLabel, text].find((value) => Boolean(value)) || "";
      return {
        text,
        label: label.slice(0, mediaTextLimit)
      };
    };
    const candidates = Array.from(document.querySelectorAll(targetKind === "media" ? mediaSelector : selector))
      .filter((element) => isVisible(element))
      .filter((element, idx, all) => all.indexOf(element) === idx);
    const target = candidates[targetIndex - 1] || null;
    if (!target) {
      throw new Error(targetKind === "media"
        ? ${serializedValue(`No visible media found for index ${index}.`)}
        : ${serializedValue(`No interactive element found for index ${index}.`)});
    }
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (typeof target.focus === "function") target.focus();
    const rect = target.getBoundingClientRect();
    const centerX = Math.round(rect.left + rect.width / 2);
    const centerY = Math.round(rect.top + rect.height / 2);
    return {
      ok: true,
      target_kind: targetKind,
      index: targetIndex,
      x: centerX,
      y: centerY,
      tag_name: target.tagName.toLowerCase(),
      ...(targetKind === "media" ? describeMedia(target) : describe(target))
    };
  })()`;
}

function clickExpression(index: number): string {
  return `(() => {
    const selector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const target = Array.from(document.querySelectorAll(selector)).filter((element) => isVisible(element))[${index - 1}] || null;
    if (!target) {
      throw new Error(${serializedValue(`No interactive element found for index ${index}.`)});
    }
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (typeof target.focus === "function") target.focus();
    if (typeof target.click === "function") target.click();
    return {
      ok: true,
      index: ${index},
      tag_name: target.tagName.toLowerCase(),
      text: (target.innerText || target.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 200)
    };
  })()`;
}

function browserTargetKind(value: unknown): BrowserTargetKind {
  if (value === undefined) {
    return "element";
  }
  if (value === "element" || value === "media") {
    return value;
  }
  throw new DesktopBrowserToolServiceError(
    400,
    "browser_tool_invalid_args",
    "target must be `element` or `media`",
  );
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function browserGetStateWarnings(params: {
  page: Record<string, unknown>;
  state: Record<string, unknown>;
  screenshot?: Record<string, unknown>;
  includeScreenshot: boolean;
}): string[] {
  const warnings: string[] = [];
  if (params.page.loading === true) {
    warnings.push("Browser page is still loading; page state may be incomplete.");
  }
  if (params.page.initialized === false) {
    warnings.push("Browser page is not fully initialized yet.");
  }
  const viewport = asRecord(params.state.viewport);
  if (
    positiveNumber(viewport?.width) === null ||
    positiveNumber(viewport?.height) === null
  ) {
    warnings.push("Browser page reported a 0x0 viewport.");
  }
  if (params.includeScreenshot) {
    const screenshot = params.screenshot ?? {};
    if (
      positiveNumber(screenshot.width) === null ||
      positiveNumber(screenshot.height) === null
    ) {
      warnings.push("Browser screenshot capture reported 0x0 dimensions.");
    }
  }
  return warnings;
}

function browserGetStateSnapshotReady(params: {
  page: Record<string, unknown>;
  state: Record<string, unknown>;
  screenshot?: Record<string, unknown>;
  includeScreenshot: boolean;
}): boolean {
  return browserGetStateWarnings(params).length === 0;
}

function typeExpression(params: {
  index: number;
  text: string;
  clear: boolean;
  submit: boolean;
}): string {
  return `(() => {
    const selector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const target = Array.from(document.querySelectorAll(selector)).filter((element) => isVisible(element))[${params.index - 1}] || null;
    if (!target) {
      throw new Error(${serializedValue(`No interactive element found for index ${params.index}.`)});
    }
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (typeof target.focus === "function") target.focus();
    const nextText = ${serializedValue(params.text)};
    const clear = ${params.clear ? "true" : "false"};
    const submit = ${params.submit ? "true" : "false"};
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const prototype = Object.getPrototypeOf(target);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      const prefix = clear ? "" : String(target.value || "");
      const value = prefix + nextText;
      if (descriptor && typeof descriptor.set === "function") {
        descriptor.set.call(target, value);
      } else {
        target.value = value;
      }
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit && target.form && typeof target.form.requestSubmit === "function") {
        target.form.requestSubmit();
      }
      return { ok: true, index: ${params.index}, value: target.value };
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      const prefix = clear ? "" : String(target.innerText || "");
      target.innerText = prefix + nextText;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      if (submit) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      return { ok: true, index: ${params.index}, value: target.innerText };
    }
    throw new Error(${serializedValue(`Element at index ${params.index} is not text-editable.`)});
  })()`;
}

function pressExpression(key: string): string {
  return `(() => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const key = ${serializedValue(key)};
    for (const type of ["keydown", "keypress", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));
    }
    if (key === "Enter" && target instanceof HTMLInputElement && target.form && typeof target.form.requestSubmit === "function") {
      target.form.requestSubmit();
    }
    return {
      ok: true,
      key,
      active_tag: target.tagName ? target.tagName.toLowerCase() : "body"
    };
  })()`;
}

function scrollExpression(deltaY: number): string {
  return `(() => {
    window.scrollBy({ top: ${deltaY}, left: 0, behavior: "instant" });
    return {
      ok: true,
      scroll_y: Math.round(window.scrollY)
    };
  })()`;
}

function historyExpression(direction: "back" | "forward"): string {
  return `(() => {
    history.${direction}();
    return { ok: true, direction: ${serializedValue(direction)} };
  })()`;
}

function reloadExpression(): string {
  return `(() => {
    location.reload();
    return { ok: true };
  })()`;
}

export class DesktopBrowserToolService implements DesktopBrowserToolServiceLike {
  readonly #fetch: typeof fetch;
  readonly #resolveConfig: () => ProductRuntimeConfig;

  constructor(options: DesktopBrowserToolServiceOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#resolveConfig =
      options.resolveConfig ??
      (() =>
        resolveProductRuntimeConfig({
          requireAuth: false,
          requireUser: false,
          requireBaseUrl: false
        }));
  }

  async getStatus(context: DesktopBrowserToolExecutionContext = {}): Promise<Record<string, unknown>> {
    const config = this.#resolveConfig();
    const configured = Boolean(
      config.desktopBrowserEnabled && config.desktopBrowserUrl.trim() && config.desktopBrowserAuthToken.trim()
    );
    let reachable = false;
    if (configured) {
      try {
        await this.#browserFetch(config, {
          method: "GET",
          path: "/health",
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        reachable = true;
      } catch {
        reachable = false;
      }
    }
    return {
      available: configured && reachable,
      configured,
      reachable,
      backend: configured ? "desktop_http" : null,
      tools: DESKTOP_BROWSER_TOOL_DEFINITIONS
    };
  }

  async execute(
    toolId: string,
    args: Record<string, unknown>,
    context: DesktopBrowserToolExecutionContext = {}
  ): Promise<Record<string, unknown>> {
    const definition = browserToolDefinition(toolId);
    if (!definition) {
      throw new DesktopBrowserToolServiceError(404, "browser_tool_unknown", `Unknown browser tool '${toolId}'`);
    }

    const config = this.#resolveConfig();
    ensureDesktopBrowserConfig(config);

    switch (definition.id) {
      case "browser_navigate": {
        const url = requiredString(args.url, "url");
        const result = await this.#browserFetch(config, {
          method: "POST",
          path: "/navigate",
          body: { url },
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, navigation: result };
      }
      case "browser_open_tab": {
        const url = requiredString(args.url, "url");
        const result = await this.#browserFetch(config, {
          method: "POST",
          path: "/tabs",
          body: {
            url,
            background: optionalBoolean(args.background, false)
          },
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, tabs: result };
      }
      case "browser_get_state": {
        const includePageText = optionalBoolean(args.include_page_text, false);
        const includeScreenshot = optionalBoolean(args.include_screenshot, false);
        const snapshot = await this.#readBrowserGetStateSnapshot(
          config,
          context,
          includePageText,
          includeScreenshot,
        );
        const payload: Record<string, unknown> = {
          ok: true,
          page: snapshot.page,
          state: snapshot.state,
        };
        if (snapshot.screenshot) {
          payload.screenshot = snapshot.screenshot;
        }
        const warnings = browserGetStateWarnings({
          page: snapshot.page,
          state: snapshot.state,
          screenshot: snapshot.screenshot,
          includeScreenshot,
        });
        if (warnings.length > 0) {
          payload.warnings = warnings;
        }
        return payload;
      }
      case "browser_click": {
        const index = requiredPositiveInteger(args.index, "index");
        const result = await this.#evaluate(config, clickExpression(index), context);
        const page = await this.#browserFetch(config, {
          method: "GET",
          path: "/page",
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, action: result, page };
      }
      case "browser_context_click": {
        const index = requiredPositiveInteger(args.index, "index");
        const target = browserTargetKind(args.target);
        const result = await this.#evaluate(config, contextClickTargetExpression(target, index), context);
        const x = requiredPositiveInteger(result.x, "x");
        const y = requiredPositiveInteger(result.y, "y");
        const contextMenu = await this.#browserFetch(config, {
          method: "POST",
          path: "/context-click",
          body: { x, y },
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, action: result, context_menu: contextMenu };
      }
      case "browser_type": {
        const index = requiredPositiveInteger(args.index, "index");
        const text = requiredString(args.text, "text");
        const result = await this.#evaluate(
          config,
          typeExpression({
            index,
            text,
            clear: optionalBoolean(args.clear, true),
            submit: optionalBoolean(args.submit, false)
          }),
          context
        );
        return { ok: true, action: result };
      }
      case "browser_press": {
        const key = requiredString(args.key, "key");
        const result = await this.#evaluate(config, pressExpression(key), context);
        return { ok: true, action: result };
      }
      case "browser_scroll": {
        const explicitDelta = optionalInteger(args.delta_y);
        const amount = optionalInteger(args.amount) ?? 600;
        const direction = args.direction === "up" ? "up" : "down";
        const deltaY = explicitDelta ?? (direction === "up" ? -Math.abs(amount) : Math.abs(amount));
        const result = await this.#evaluate(config, scrollExpression(deltaY), context);
        return { ok: true, action: result };
      }
      case "browser_back": {
        const result = await this.#evaluate(config, historyExpression("back"), context);
        const page = await this.#browserFetch(config, {
          method: "GET",
          path: "/page",
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, action: result, page };
      }
      case "browser_forward": {
        const result = await this.#evaluate(config, historyExpression("forward"), context);
        const page = await this.#browserFetch(config, {
          method: "GET",
          path: "/page",
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, action: result, page };
      }
      case "browser_reload": {
        const result = await this.#evaluate(config, reloadExpression(), context);
        const page = await this.#browserFetch(config, {
          method: "GET",
          path: "/page",
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, action: result, page };
      }
      case "browser_screenshot": {
        const format = args.format === "jpeg" ? "jpeg" : "png";
        const quality = optionalInteger(args.quality);
        return {
          ok: true,
          screenshot: await this.#browserFetch(config, {
            method: "POST",
            path: "/screenshot",
            body: {
              format,
              ...(quality !== null ? { quality } : {})
            },
            workspaceId: context.workspaceId,
            sessionId: context.sessionId,
            space: context.space,
          })
        };
      }
      case "browser_list_tabs": {
        return {
          ok: true,
          tabs: await this.#browserFetch(config, {
            method: "GET",
            path: "/tabs",
            workspaceId: context.workspaceId,
            sessionId: context.sessionId,
            space: context.space,
          })
        };
      }
    }
  }

  async #evaluate(
    config: ProductRuntimeConfig,
    expression: string,
    context: DesktopBrowserToolExecutionContext = {}
  ): Promise<Record<string, unknown>> {
    const response = await this.#browserFetch(config, {
      method: "POST",
      path: "/evaluate",
      body: evaluateExpressionPayload(expression),
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      space: context.space,
    });
    const payload = asRecord(response);
    return asRecord(payload?.result) ?? {};
  }

  async #readBrowserGetStateSnapshot(
    config: ProductRuntimeConfig,
    context: DesktopBrowserToolExecutionContext,
    includePageText: boolean,
    includeScreenshot: boolean,
  ): Promise<{
    page: Record<string, unknown>;
    state: Record<string, unknown>;
    screenshot?: Record<string, unknown>;
  }> {
    let snapshot: {
      page: Record<string, unknown>;
      state: Record<string, unknown>;
      screenshot?: Record<string, unknown>;
    } = {
      page: {},
      state: {},
    };
    for (let attempt = 0; attempt < BROWSER_GET_STATE_MAX_ATTEMPTS; attempt += 1) {
      const page = await this.#browserFetch(config, {
        method: "GET",
        path: "/page",
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        space: context.space,
      });
      const state = await this.#evaluate(
        config,
        interactiveElementsExpression(includePageText),
        context,
      );
      const screenshot = includeScreenshot
        ? await this.#browserFetch(config, {
            method: "POST",
            path: "/screenshot",
            body: { format: "png" },
            workspaceId: context.workspaceId,
            sessionId: context.sessionId,
            space: context.space,
          })
        : undefined;
      snapshot = { page, state, ...(screenshot ? { screenshot } : {}) };
      if (
        browserGetStateSnapshotReady({
          page,
          state,
          screenshot,
          includeScreenshot,
        })
      ) {
        return snapshot;
      }
      if (attempt < BROWSER_GET_STATE_MAX_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, BROWSER_GET_STATE_RETRY_DELAY_MS),
        );
      }
    }
    return snapshot;
  }

  async #browserFetch(config: ProductRuntimeConfig, options: BrowserFetchOptions): Promise<Record<string, unknown>> {
    const requestUrl = `${browserBaseUrl(config)}${options.path}`;
    const response = await this.#fetch(requestUrl, {
      method: options.method,
      headers: browserToolHeaders(config, {
        workspaceId: options.workspaceId,
        sessionId: options.sessionId,
        space: options.space,
      }),
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message = asRecord(payload)?.error;
      throw new DesktopBrowserToolServiceError(
        response.status,
        "desktop_browser_request_failed",
        typeof message === "string" && message.trim()
          ? message.trim()
          : `Desktop browser request failed with status ${response.status}`
      );
    }
    return asRecord(payload) ?? {};
  }
}
