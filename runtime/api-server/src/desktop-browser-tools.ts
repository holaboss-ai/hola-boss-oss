import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
  inputId?: string | null;
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
  artifactStore?: BrowserScreenshotArtifactStore | null;
}

interface BrowserScreenshotArtifactStore {
  workspaceRoot: string;
  createOutput(params: {
    workspaceId: string;
    outputType: string;
    title?: string;
    status?: string;
    filePath?: string | null;
    sessionId?: string | null;
    inputId?: string | null;
    artifactId?: string | null;
    platform?: string | null;
    metadata?: Record<string, unknown> | null;
  }): {
    id: string;
    artifactId: string | null;
    filePath: string | null;
  };
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
type BrowserGetStateMode = "state" | "text" | "structured" | "visual";
type BrowserGetStateScope = "main" | "viewport" | "focused" | "dialog";

type BrowserGetStateOptions = {
  includePageText: boolean;
  includeScreenshot: boolean;
  mode: BrowserGetStateMode;
  scope: BrowserGetStateScope;
  maxNodes: number | null;
  includeMetadata: boolean;
};

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
const BROWSER_SCREENSHOT_ARTIFACT_DIR = "outputs/browser-screenshots";


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

function optionalPositiveIntegerArg(
  value: unknown,
  fieldName: string,
): number | null {
  if (value === undefined || value === null) {
    return null;
  }
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

function browserGetStateMode(value: unknown): BrowserGetStateMode {
  if (value === undefined || value === null) {
    return "state";
  }
  if (value === "state" || value === "text" || value === "structured" || value === "visual") {
    return value;
  }
  throw new DesktopBrowserToolServiceError(
    400,
    "browser_tool_invalid_args",
    "mode must be `state`, `text`, `structured`, or `visual`"
  );
}

function browserGetStateScope(value: unknown): BrowserGetStateScope {
  if (value === undefined || value === null) {
    return "main";
  }
  if (value === "main" || value === "viewport" || value === "focused" || value === "dialog") {
    return value;
  }
  throw new DesktopBrowserToolServiceError(
    400,
    "browser_tool_invalid_args",
    "scope must be `main`, `viewport`, `focused`, or `dialog`"
  );
}

function browserGetStateOptions(args: Record<string, unknown>): BrowserGetStateOptions {
  const mode = browserGetStateMode(args.mode);
  const scope = browserGetStateScope(args.scope);
  const maxNodes = optionalPositiveIntegerArg(args.max_nodes ?? args.maxNodes, "max_nodes");
  const includePageText = mode === "text" || optionalBoolean(args.include_page_text, false);
  const includeScreenshot = mode === "visual" || optionalBoolean(args.include_screenshot, false);
  return {
    includePageText,
    includeScreenshot,
    mode,
    scope,
    maxNodes,
    includeMetadata:
      args.mode !== undefined ||
      args.scope !== undefined ||
      args.max_nodes !== undefined ||
      args.maxNodes !== undefined,
  };
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

function interactiveElementsExpression(options: BrowserGetStateOptions): string {
  return `(() => {
    const selector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    const mediaSelector = ${serializedValue(VISIBLE_MEDIA_SELECTOR)};
    const includePageText = ${options.includePageText ? "true" : "false"};
    const includeMetadata = ${options.includeMetadata ? "true" : "false"};
    const mode = ${serializedValue(options.mode)};
    const scope = ${serializedValue(options.scope)};
    const maxNodes = ${options.maxNodes === null ? "null" : String(options.maxNodes)};
    const textLimit = ${BROWSER_GET_STATE_ELEMENT_TEXT_MAX_CHARS};
    const mediaTextLimit = ${BROWSER_GET_STATE_MEDIA_TEXT_MAX_CHARS};
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const intersectsViewport = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    };
    const dialogRoots = Array.from(document.querySelectorAll("dialog[open], [role='dialog'], [aria-modal='true']"))
      .filter((element) => element instanceof HTMLElement && isVisible(element));
    const focusedRoot = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inScope = (element) => {
      if (scope === "main") return true;
      if (scope === "viewport") return intersectsViewport(element);
      if (scope === "dialog") return dialogRoots.some((root) => root === element || root.contains(element));
      if (scope === "focused") {
        return focusedRoot ? element === focusedRoot || focusedRoot.contains(element) || element.contains(focusedRoot) : false;
      }
      return true;
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
      .filter((element, index, all) => all.indexOf(element) === index)
      .map((element, index) => ({ element, index: index + 1 }));
    const mediaNodes = Array.from(document.querySelectorAll(mediaSelector))
      .filter((element) => isVisible(element))
      .filter((element, index, all) => all.indexOf(element) === index)
      .map((element, index) => ({ element, index: index + 1 }));
    const scopedNodes = nodes.filter((entry) => inScope(entry.element));
    const scopedMediaNodes = mediaNodes.filter((entry) => inScope(entry.element));
    const includeNodeLists = mode !== "text";
    let remainingNodes = typeof maxNodes === "number" && maxNodes > 0 ? maxNodes : null;
    const takeNodes = (entries) => {
      if (!includeNodeLists) return [];
      if (remainingNodes === null) return entries;
      const selected = entries.slice(0, remainingNodes);
      remainingNodes = Math.max(0, remainingNodes - selected.length);
      return selected;
    };
    const returnedNodes = takeNodes(scopedNodes);
    const returnedMediaNodes = takeNodes(scopedMediaNodes);
    const scopedText = () => {
      if (scope === "main") {
        return (document.body?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, ${BROWSER_GET_STATE_TEXT_MAX_CHARS});
      }
      if (scope === "viewport") {
        const body = document.body;
        if (!body) return "";
        return Array.from(body.querySelectorAll("*"))
          .filter((element) => element instanceof HTMLElement && isVisible(element) && intersectsViewport(element))
          .map((element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim())
          .filter((text) => Boolean(text))
          .join(" ")
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, ${BROWSER_GET_STATE_TEXT_MAX_CHARS});
      }
      const roots = scope === "dialog" ? dialogRoots : focusedRoot ? [focusedRoot] : [];
      return roots
        .map((element) => (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim())
        .filter((text) => Boolean(text))
        .join(" ")
        .replace(/\\s+/g, " ")
        .trim()
        .slice(0, ${BROWSER_GET_STATE_TEXT_MAX_CHARS});
    };
    const truncated = includeNodeLists && (returnedNodes.length < scopedNodes.length || returnedMediaNodes.length < scopedMediaNodes.length);
    const result = {
      url: location.href,
      title: document.title,
      ...(includePageText ? { text: scopedText() } : {}),
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      elements: returnedNodes.map((entry) => describe(entry.element, entry.index)),
      media: returnedMediaNodes.map((entry) => describeMedia(entry.element, entry.index))
    };
    if (includeMetadata) {
      result.metadata = {
        schema_version: 1,
        mode,
        scope,
        max_nodes: maxNodes,
        include_page_text: includePageText,
        include_screenshot: ${options.includeScreenshot ? "true" : "false"},
        lists_included: includeNodeLists,
        returned: {
          elements: returnedNodes.length,
          media: returnedMediaNodes.length
        },
        totals: {
          elements: scopedNodes.length,
          media: scopedMediaNodes.length
        },
        full_page_totals: scope === "main" ? null : {
          elements: nodes.length,
          media: mediaNodes.length
        },
        truncated
      };
    }
    return result;
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

function normalizedScreenshotMimeType(value: unknown): string {
  const raw =
    typeof value === "string" && value.trim()
      ? value.trim().toLowerCase()
      : "";
  if (raw === "image/jpeg" || raw === "image/jpg") {
    return "image/jpeg";
  }
  if (raw === "image/webp") {
    return "image/webp";
  }
  return "image/png";
}

function screenshotExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") {
    return ".jpg";
  }
  if (mimeType === "image/webp") {
    return ".webp";
  }
  return ".png";
}

function safePathSegment(value: string, fallback: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

function timestampPathSegment(date = new Date()): string {
  return date.toISOString().replace(/[^0-9A-Za-z]+/g, "-").replace(/^-+|-+$/g, "");
}

function screenshotBase64(value: Record<string, unknown>): string | null {
  const raw = value.base64;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
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
  readonly #artifactStore: BrowserScreenshotArtifactStore | null;

  constructor(options: DesktopBrowserToolServiceOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#artifactStore = options.artifactStore ?? null;
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
        const options = browserGetStateOptions(args);
        const snapshot = await this.#readBrowserGetStateSnapshot(
          config,
          context,
          options,
        );
        const payload: Record<string, unknown> = {
          ok: true,
          page: snapshot.page,
          state: snapshot.state,
        };
        const warnings = browserGetStateWarnings({
          page: snapshot.page,
          state: snapshot.state,
          screenshot: snapshot.screenshot,
          includeScreenshot: options.includeScreenshot,
        });
        if (snapshot.screenshot) {
          const screenshot = await this.#screenshotForToolResult({
            screenshot: snapshot.screenshot,
            context,
            sourceToolId: "browser_get_state",
            page: snapshot.page,
            state: snapshot.state,
          });
          payload.screenshot = screenshot.result;
          if (screenshot.warning) {
            warnings.push(screenshot.warning);
          }
        }
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
        const screenshot = await this.#browserFetch(config, {
          method: "POST",
          path: "/screenshot",
          body: {
            format,
            ...(quality !== null ? { quality } : {})
          },
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        const artifactScreenshot = await this.#screenshotForToolResult({
          screenshot,
          context,
          sourceToolId: "browser_screenshot",
        });
        return {
          ok: true,
          screenshot: artifactScreenshot.result,
          ...(artifactScreenshot.warning ? { warnings: [artifactScreenshot.warning] } : {})
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

  async #screenshotForToolResult(params: {
    screenshot: Record<string, unknown>;
    context: DesktopBrowserToolExecutionContext;
    sourceToolId: string;
    page?: Record<string, unknown>;
    state?: Record<string, unknown>;
  }): Promise<{ result: Record<string, unknown>; warning: string | null }> {
    const workspaceId = typeof params.context.workspaceId === "string" ? params.context.workspaceId.trim() : "";
    if (!this.#artifactStore || !workspaceId) {
      return { result: params.screenshot, warning: null };
    }

    const base64 = screenshotBase64(params.screenshot);
    if (!base64) {
      return { result: params.screenshot, warning: null };
    }

    const mimeType = normalizedScreenshotMimeType(
      params.screenshot.mimeType ?? params.screenshot.mime_type,
    );
    const extension = screenshotExtension(mimeType);
    const sessionId = typeof params.context.sessionId === "string" ? params.context.sessionId.trim() : "";
    const inputId = typeof params.context.inputId === "string" ? params.context.inputId.trim() : "";
    const artifactId = randomUUID();
    const timestamp = timestampPathSegment();
    const relativePath = path.posix.join(
      BROWSER_SCREENSHOT_ARTIFACT_DIR,
      safePathSegment(sessionId, "session"),
      `${timestamp}-${artifactId}${extension}`,
    );
    const absolutePath = path.join(this.#artifactStore.workspaceRoot, workspaceId, ...relativePath.split("/"));
    const bytes = Buffer.from(base64, "base64");

    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, bytes);
      const width = positiveNumber(params.screenshot.width);
      const height = positiveNumber(params.screenshot.height);
      const output = this.#artifactStore.createOutput({
        workspaceId,
        outputType: "file",
        title: `Browser screenshot ${new Date().toISOString()}`,
        status: "completed",
        filePath: relativePath,
        sessionId: sessionId || null,
        inputId: inputId || null,
        artifactId,
        platform: "browser",
        metadata: {
          origin_type: "browser_tool",
          change_type: "created",
          artifact_type: "browser_screenshot",
          category: "image",
          mime_type: mimeType,
          size_bytes: bytes.byteLength,
          tool_id: params.sourceToolId,
          inline_base64: false,
          ...(width !== null ? { width } : {}),
          ...(height !== null ? { height } : {}),
          ...(sessionId ? { source_session_id: sessionId } : {}),
          ...(inputId ? { source_input_id: inputId } : {}),
          ...(typeof params.page?.url === "string" ? { page_url: params.page.url } : {}),
          ...(typeof params.page?.title === "string" ? { page_title: params.page.title } : {}),
          ...(typeof params.state?.url === "string" && typeof params.page?.url !== "string"
            ? { page_url: params.state.url }
            : {}),
          ...(typeof params.state?.title === "string" && typeof params.page?.title !== "string"
            ? { page_title: params.state.title }
            : {}),
        },
      });
      return {
        result: {
          artifact_id: output.artifactId ?? artifactId,
          output_id: output.id,
          file_path: output.filePath ?? relativePath,
          mime_type: mimeType,
          size_bytes: bytes.byteLength,
          ...(width !== null ? { width } : {}),
          ...(height !== null ? { height } : {}),
          storage: "workspace_output",
          inline_base64: false,
        },
        warning: null,
      };
    } catch {
      return {
        result: params.screenshot,
        warning: "Browser screenshot artifact persistence failed; screenshot is inlined.",
      };
    }
  }

  async #readBrowserGetStateSnapshot(
    config: ProductRuntimeConfig,
    context: DesktopBrowserToolExecutionContext,
    options: BrowserGetStateOptions,
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
        interactiveElementsExpression(options),
        context,
      );
      const screenshot = options.includeScreenshot
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
          includeScreenshot: options.includeScreenshot,
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
