import {
  DESKTOP_BROWSER_TOOL_DEFINITIONS,
  DESKTOP_BROWSER_TOOL_IDS,
  type DesktopBrowserToolDefinition,
  type DesktopBrowserToolId,
} from "../../harnesses/src/desktop-browser-tools.js";
import { createHash, randomUUID } from "node:crypto";
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
type BrowserWaitSelectorState = "present" | "visible" | "hidden";
type BrowserWaitUrlMode = "exact" | "contains" | "regex";
type BrowserWaitLoadState = "domcontentloaded" | "load" | "networkidle";
type BrowserActionCategory = "navigate" | "history" | "interaction" | "keyboard" | "scroll";

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
const DEFAULT_BROWSER_GET_STATE_ELEMENT_LIMIT = 40;
const MAX_BROWSER_GET_STATE_ELEMENT_LIMIT = 200;
const DEFAULT_BROWSER_GET_STATE_MEDIA_LIMIT = 20;
const MAX_BROWSER_GET_STATE_MEDIA_LIMIT = 120;
const DEFAULT_BROWSER_WAIT_TIMEOUT_MS = 10_000;
const MAX_BROWSER_WAIT_TIMEOUT_MS = 120_000;
const DEFAULT_BROWSER_WAIT_INTERVAL_MS = 250;
const MAX_BROWSER_WAIT_INTERVAL_MS = 5_000;
const DEFAULT_BROWSER_BOUNDARY_LABEL = "HOLABOSS_UNTRUSTED_PAGE_CONTENT";


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

function optionalTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function optionalInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function normalizedLowercaseSet(values: string[] | null | undefined): Set<string> {
  const normalized = new Set<string>();
  for (const value of values ?? []) {
    const token = value.trim().toLowerCase();
    if (token) {
      normalized.add(token);
    }
  }
  return normalized;
}

function boundedPositiveInteger(params: {
  value: unknown;
  fieldName: string;
  defaultValue: number;
  minValue: number;
  maxValue: number;
}): number {
  const parsed = optionalInteger(params.value);
  if (parsed === null) {
    return params.defaultValue;
  }
  if (parsed < params.minValue) {
    throw new DesktopBrowserToolServiceError(
      400,
      "browser_tool_invalid_args",
      `${params.fieldName} must be at least ${params.minValue}`,
    );
  }
  return Math.min(parsed, params.maxValue);
}

function actionRequiresConfirmation(args: Record<string, unknown>): boolean {
  return optionalBoolean(args.confirm, false);
}

function browserActionCategory(toolId: DesktopBrowserToolId): BrowserActionCategory | null {
  switch (toolId) {
    case "browser_navigate":
    case "browser_open_tab":
      return "navigate";
    case "browser_back":
    case "browser_forward":
    case "browser_reload":
      return "history";
    case "browser_click":
    case "browser_context_click":
    case "browser_type":
      return "interaction";
    case "browser_press":
      return "keyboard";
    case "browser_scroll":
      return "scroll";
    default:
      return null;
  }
}

function browserWaitSelectorState(value: unknown): BrowserWaitSelectorState {
  if (value === "present" || value === "visible" || value === "hidden") {
    return value;
  }
  return "visible";
}

function browserWaitUrlMode(value: unknown): BrowserWaitUrlMode {
  if (value === "exact" || value === "contains" || value === "regex") {
    return value;
  }
  return "contains";
}

function browserWaitLoadState(value: unknown): BrowserWaitLoadState {
  if (value === "domcontentloaded" || value === "load" || value === "networkidle") {
    return value;
  }
  return "load";
}

function browserWaitTimeoutMs(value: unknown): number {
  return boundedPositiveInteger({
    value,
    fieldName: "timeout_ms",
    defaultValue: DEFAULT_BROWSER_WAIT_TIMEOUT_MS,
    minValue: 1,
    maxValue: MAX_BROWSER_WAIT_TIMEOUT_MS,
  });
}

function browserWaitIntervalMs(value: unknown): number {
  return boundedPositiveInteger({
    value,
    fieldName: "interval_ms",
    defaultValue: DEFAULT_BROWSER_WAIT_INTERVAL_MS,
    minValue: 1,
    maxValue: MAX_BROWSER_WAIT_INTERVAL_MS,
  });
}

function browserGetStateOffset(value: unknown, fieldName: string): number {
  const parsed = optionalInteger(value);
  if (parsed === null) {
    return 0;
  }
  if (parsed < 0) {
    throw new DesktopBrowserToolServiceError(
      400,
      "browser_tool_invalid_args",
      `${fieldName} must be a non-negative integer`
    );
  }
  return parsed;
}

function browserGetStateLimit(params: {
  value: unknown;
  fieldName: string;
  defaultValue: number;
  maxValue: number;
}): number {
  const parsed = optionalInteger(params.value);
  if (parsed === null) {
    return params.defaultValue;
  }
  if (parsed <= 0) {
    throw new DesktopBrowserToolServiceError(
      400,
      "browser_tool_invalid_args",
      `${params.fieldName} must be a positive integer`
    );
  }
  return Math.min(parsed, params.maxValue);
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

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname.trim().toLowerCase();
  } catch {
    return null;
  }
}

function domainPatternMatches(host: string, pattern: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedHost || !normalizedPattern) {
    return false;
  }
  if (normalizedPattern === "*") {
    return true;
  }
  const patternHost = normalizedPattern.includes("://")
    ? hostFromUrl(normalizedPattern)
    : normalizedPattern;
  if (!patternHost) {
    return false;
  }
  if (patternHost.startsWith("*.")) {
    const suffix = patternHost.slice(2);
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedHost === patternHost;
}

function browserDomainAllowed(params: {
  url: string;
  allowedDomains: string[];
}): boolean {
  const host = hostFromUrl(params.url);
  if (!host) {
    return false;
  }
  if (params.allowedDomains.length === 0) {
    return true;
  }
  return params.allowedDomains.some((pattern) =>
    domainPatternMatches(host, pattern),
  );
}

function wrapUntrustedBoundaryText(params: {
  text: string;
  origin: string | null;
  enabled: boolean;
}): { wrappedText: string; boundary: Record<string, unknown> | null } {
  if (!params.enabled || !params.text.trim()) {
    return { wrappedText: params.text, boundary: null };
  }
  const nonce = randomUUID().replace(/-/g, "").slice(0, 24);
  const origin = params.origin || "unknown";
  const wrappedText = [
    `--- ${DEFAULT_BROWSER_BOUNDARY_LABEL} nonce=${nonce} origin=${origin} ---`,
    params.text,
    `--- END_${DEFAULT_BROWSER_BOUNDARY_LABEL} nonce=${nonce} ---`,
  ].join("\n");
  return {
    wrappedText,
    boundary: {
      marker: DEFAULT_BROWSER_BOUNDARY_LABEL,
      nonce,
      origin,
    },
  };
}

function evaluateExpressionPayload(expression: string): Record<string, unknown> {
  return { expression };
}

function serializedValue(value: unknown): string {
  return JSON.stringify(value);
}

function frameAwareBrowserQueryHelpersExpression(): string {
  return `
    const sameOriginFrameDocument = (frameElement) => {
      if (!(frameElement instanceof HTMLIFrameElement)) return null;
      try {
        return (
          frameElement.contentDocument ||
          (frameElement.contentWindow && frameElement.contentWindow.document) ||
          null
        );
      } catch {
        return null;
      }
    };
    const frameUrlForDocument = (doc) => {
      try {
        return String(doc.location?.href || "");
      } catch {
        return "";
      }
    };
    const collectDocumentEntries = (rootDocument) => {
      const entries = [
        {
          doc: rootDocument,
          frame_path: "main",
          frame_url: frameUrlForDocument(rootDocument),
        },
      ];
      let inaccessibleFrameCount = 0;
      const queue = [{ doc: rootDocument, frame_path: "main" }];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || !(current.doc instanceof Document)) {
          continue;
        }
        const iframes = Array.from(current.doc.querySelectorAll("iframe"));
        for (let index = 0; index < iframes.length; index += 1) {
          const frameElement = iframes[index];
          const framePath = \`\${current.frame_path}/iframe[\${index + 1}]\`;
          const childDoc = sameOriginFrameDocument(frameElement);
          if (!(childDoc instanceof Document)) {
            inaccessibleFrameCount += 1;
            continue;
          }
          const frameUrl = frameUrlForDocument(childDoc);
          const entry = {
            doc: childDoc,
            frame_path: framePath,
            frame_url: frameUrl,
          };
          entries.push(entry);
          queue.push(entry);
        }
      }
      return { entries, inaccessible_frame_count: inaccessibleFrameCount };
    };
    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    };
    const resolveScope = (entries, scopeSelector) => {
      if (!scopeSelector) {
        return null;
      }
      for (const entry of entries) {
        const candidate = entry.doc.querySelector(scopeSelector);
        if (!(candidate instanceof Element)) {
          continue;
        }
        return {
          root_element: candidate,
          frame_path: entry.frame_path,
          frame_url: entry.frame_url,
          doc: entry.doc,
        };
      }
      return null;
    };
    const collectVisibleCandidates = (entries, selector, scope) => {
      const result = [];
      const seen = new Set();
      const targetEntries =
        scope && scope.doc instanceof Document
          ? entries.filter((entry) => entry.doc === scope.doc)
          : entries;
      for (const entry of targetEntries) {
        const root = scope?.root_element instanceof Element ? scope.root_element : entry.doc;
        const nodes = Array.from(root.querySelectorAll(selector));
        for (const node of nodes) {
          if (!(node instanceof Element) || !isVisible(node) || seen.has(node)) {
            continue;
          }
          seen.add(node);
          result.push({
            element: node,
            frame_path: entry.frame_path,
            frame_url: entry.frame_url,
          });
        }
      }
      return result;
    };
  `;
}

function interactiveElementsExpression(params: {
  includePageText: boolean;
  scopeSelector: string | null;
  elementOffset: number;
  elementLimit: number;
  mediaOffset: number;
  mediaLimit: number;
}): string {
  return `(() => {
    const selector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    const mediaSelector = ${serializedValue(VISIBLE_MEDIA_SELECTOR)};
    const includePageText = ${params.includePageText ? "true" : "false"};
    const scopeSelector = ${serializedValue(params.scopeSelector)};
    const elementOffset = ${params.elementOffset};
    const elementLimit = ${params.elementLimit};
    const mediaOffset = ${params.mediaOffset};
    const mediaLimit = ${params.mediaLimit};
    const textLimit = ${BROWSER_GET_STATE_ELEMENT_TEXT_MAX_CHARS};
    const mediaTextLimit = ${BROWSER_GET_STATE_MEDIA_TEXT_MAX_CHARS};
    ${frameAwareBrowserQueryHelpersExpression()}
    const documentCollection = collectDocumentEntries(document);
    const documentEntries = documentCollection.entries;
    const scope = resolveScope(documentEntries, scopeSelector);
    if (scopeSelector && !scope) {
      throw new Error("No element found for scope_selector.");
    }
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
    const nodes = collectVisibleCandidates(documentEntries, selector, scope);
    const mediaNodes = collectVisibleCandidates(documentEntries, mediaSelector, scope);
    const boundedElementOffset = Math.min(Math.max(0, elementOffset), nodes.length);
    const boundedMediaOffset = Math.min(Math.max(0, mediaOffset), mediaNodes.length);
    const pagedElements = nodes.slice(boundedElementOffset, boundedElementOffset + elementLimit);
    const pagedMedia = mediaNodes.slice(boundedMediaOffset, boundedMediaOffset + mediaLimit);
    const nextElementsOffset = boundedElementOffset + pagedElements.length;
    const nextMediaOffset = boundedMediaOffset + pagedMedia.length;
    const contentRoot = scope?.root_element instanceof Element ? scope.root_element : document.body;
    const contentText = (contentRoot?.textContent || "").replace(/\\s+/g, " ").trim();
    return {
      url: location.href,
      title: document.title,
      ...(includePageText ? { text: contentText.slice(0, ${BROWSER_GET_STATE_TEXT_MAX_CHARS}) } : {}),
      scope_selector: scopeSelector || null,
      scope_applied: Boolean(scope),
      scope_frame_path: scope?.frame_path || null,
      scope_frame_url: scope?.frame_url || null,
      frame_count: documentEntries.length,
      inaccessible_frame_count: documentCollection.inaccessible_frame_count,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      elements_offset: boundedElementOffset,
      elements_limit: elementLimit,
      elements_total: nodes.length,
      elements_has_more: nextElementsOffset < nodes.length,
      next_elements_offset: nextElementsOffset < nodes.length ? nextElementsOffset : null,
      media_offset: boundedMediaOffset,
      media_limit: mediaLimit,
      media_total: mediaNodes.length,
      media_has_more: nextMediaOffset < mediaNodes.length,
      next_media_offset: nextMediaOffset < mediaNodes.length ? nextMediaOffset : null,
      elements: pagedElements.map((entry, idx) => ({
        ...describe(entry.element, boundedElementOffset + idx + 1),
        frame_path: entry.frame_path,
        frame_url: entry.frame_url || null,
        in_iframe: entry.frame_path !== "main",
      })),
      media: pagedMedia.map((entry, idx) => ({
        ...describeMedia(entry.element, boundedMediaOffset + idx + 1),
        frame_path: entry.frame_path,
        frame_url: entry.frame_url || null,
        in_iframe: entry.frame_path !== "main",
      }))
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
    ${frameAwareBrowserQueryHelpersExpression()}
    const documentCollection = collectDocumentEntries(document);
    const documentEntries = documentCollection.entries;
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
    const candidates = collectVisibleCandidates(
      documentEntries,
      targetKind === "media" ? mediaSelector : selector,
      null,
    );
    const targetEntry = candidates[targetIndex - 1] || null;
    if (!targetEntry || !(targetEntry.element instanceof Element)) {
      throw new Error(targetKind === "media"
        ? ${serializedValue(`No visible media found for index ${index}.`)}
        : ${serializedValue(`No interactive element found for index ${index}.`)});
    }
    const target = targetEntry.element;
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
      frame_path: targetEntry.frame_path,
      frame_url: targetEntry.frame_url || null,
      in_iframe: targetEntry.frame_path !== "main",
      ...(targetKind === "media" ? describeMedia(target) : describe(target))
    };
  })()`;
}

function clickExpression(index: number): string {
  return `(() => {
    const selector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    ${frameAwareBrowserQueryHelpersExpression()}
    const candidates = collectVisibleCandidates(collectDocumentEntries(document).entries, selector, null);
    const targetEntry = candidates[${index - 1}] || null;
    if (!targetEntry || !(targetEntry.element instanceof Element)) {
      throw new Error(${serializedValue(`No interactive element found for index ${index}.`)});
    }
    const target = targetEntry.element;
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (typeof target.focus === "function") target.focus();
    if (typeof target.click === "function") target.click();
    return {
      ok: true,
      index: ${index},
      tag_name: target.tagName.toLowerCase(),
      frame_path: targetEntry.frame_path,
      frame_url: targetEntry.frame_url || null,
      in_iframe: targetEntry.frame_path !== "main",
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

function browserContentOrigin(page: Record<string, unknown>): string | null {
  const pageUrl = typeof page.url === "string" ? page.url.trim() : "";
  if (!pageUrl) {
    return null;
  }
  try {
    return new URL(pageUrl).origin;
  } catch {
    return null;
  }
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const parsed = optionalInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function normalizeBrowserGetStateState(params: {
  state: Record<string, unknown>;
  scopeSelector: string | null;
  elementOffset: number;
  elementLimit: number;
  mediaOffset: number;
  mediaLimit: number;
}): Record<string, unknown> {
  const normalized = { ...params.state };
  const elements = Array.isArray(normalized.elements) ? normalized.elements : [];
  const media = Array.isArray(normalized.media) ? normalized.media : [];

  const elementsOffset = nonNegativeIntegerOrNull(normalized.elements_offset) ?? params.elementOffset;
  const elementsLimit = nonNegativeIntegerOrNull(normalized.elements_limit) ?? params.elementLimit;
  const elementsTotal =
    nonNegativeIntegerOrNull(normalized.elements_total) ??
    Math.max(elementsOffset + elements.length, elements.length);
  const elementsHasMore =
    typeof normalized.elements_has_more === "boolean"
      ? normalized.elements_has_more
      : elementsOffset + elements.length < elementsTotal;
  const nextElementsOffset = elementsHasMore
    ? nonNegativeIntegerOrNull(normalized.next_elements_offset) ?? elementsOffset + elements.length
    : null;

  const mediaOffset = nonNegativeIntegerOrNull(normalized.media_offset) ?? params.mediaOffset;
  const mediaLimit = nonNegativeIntegerOrNull(normalized.media_limit) ?? params.mediaLimit;
  const mediaTotal =
    nonNegativeIntegerOrNull(normalized.media_total) ??
    Math.max(mediaOffset + media.length, media.length);
  const mediaHasMore =
    typeof normalized.media_has_more === "boolean"
      ? normalized.media_has_more
      : mediaOffset + media.length < mediaTotal;
  const nextMediaOffset = mediaHasMore
    ? nonNegativeIntegerOrNull(normalized.next_media_offset) ?? mediaOffset + media.length
    : null;

  normalized.scope_selector =
    typeof normalized.scope_selector === "string"
      ? normalized.scope_selector
      : params.scopeSelector;
  normalized.scope_applied =
    typeof normalized.scope_applied === "boolean"
      ? normalized.scope_applied
      : Boolean(normalized.scope_selector);
  normalized.elements_offset = elementsOffset;
  normalized.elements_limit = elementsLimit;
  normalized.elements_total = elementsTotal;
  normalized.elements_has_more = elementsHasMore;
  normalized.next_elements_offset = nextElementsOffset;
  normalized.media_offset = mediaOffset;
  normalized.media_limit = mediaLimit;
  normalized.media_total = mediaTotal;
  normalized.media_has_more = mediaHasMore;
  normalized.next_media_offset = nextMediaOffset;
  return normalized;
}

function browserStateFingerprint(params: {
  page: Record<string, unknown>;
  state: Record<string, unknown>;
}): string {
  const elements = Array.isArray(params.state.elements) ? params.state.elements : [];
  const media = Array.isArray(params.state.media) ? params.state.media : [];
  const summary = {
    page: {
      url: typeof params.page.url === "string" ? params.page.url : "",
      title: typeof params.page.title === "string" ? params.page.title : "",
    },
    viewport: asRecord(params.state.viewport),
    scroll: asRecord(params.state.scroll),
    scope_selector: typeof params.state.scope_selector === "string"
      ? params.state.scope_selector
      : null,
    elements: {
      offset: optionalInteger(params.state.elements_offset) ?? 0,
      total: optionalInteger(params.state.elements_total) ?? elements.length,
      sample: elements
        .slice(0, 5)
        .map((entry) => {
          const item = asRecord(entry);
          return {
            tag_name: typeof item?.tag_name === "string" ? item.tag_name : "",
            label: typeof item?.label === "string" ? item.label : "",
            text: typeof item?.text === "string" ? item.text : "",
          };
        }),
    },
    media: {
      offset: optionalInteger(params.state.media_offset) ?? 0,
      total: optionalInteger(params.state.media_total) ?? media.length,
      sample: media
        .slice(0, 5)
        .map((entry) => {
          const item = asRecord(entry);
          return {
            tag_name: typeof item?.tag_name === "string" ? item.tag_name : "",
            media_type: typeof item?.media_type === "string" ? item.media_type : "",
            label: typeof item?.label === "string" ? item.label : "",
          };
        }),
    },
  };
  return createHash("sha256").update(JSON.stringify(summary)).digest("hex");
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
    ${frameAwareBrowserQueryHelpersExpression()}
    const candidates = collectVisibleCandidates(collectDocumentEntries(document).entries, selector, null);
    const targetEntry = candidates[${params.index - 1}] || null;
    if (!targetEntry || !(targetEntry.element instanceof Element)) {
      throw new Error(${serializedValue(`No interactive element found for index ${params.index}.`)});
    }
    const target = targetEntry.element;
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
      return {
        ok: true,
        index: ${params.index},
        value: target.value,
        frame_path: targetEntry.frame_path,
        frame_url: targetEntry.frame_url || null,
        in_iframe: targetEntry.frame_path !== "main",
      };
    }
    if (target instanceof HTMLElement && target.isContentEditable) {
      const prefix = clear ? "" : String(target.innerText || "");
      target.innerText = prefix + nextText;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      if (submit) {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
      return {
        ok: true,
        index: ${params.index},
        value: target.innerText,
        frame_path: targetEntry.frame_path,
        frame_url: targetEntry.frame_url || null,
        in_iframe: targetEntry.frame_path !== "main",
      };
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

function waitForSelectorProbeExpression(params: {
  selector: string;
  state: BrowserWaitSelectorState;
}): string {
  return `(() => {
    const selector = ${serializedValue(params.selector)};
    const expectedState = ${serializedValue(params.state)};
    ${frameAwareBrowserQueryHelpersExpression()}
    const documentCollection = collectDocumentEntries(document);
    const documentEntries = documentCollection.entries;
    let presentCount = 0;
    let visibleCount = 0;
    let firstFramePath = null;
    let firstFrameUrl = null;
    for (const entry of documentEntries) {
      const nodes = Array.from(entry.doc.querySelectorAll(selector));
      if (nodes.length === 0) {
        continue;
      }
      presentCount += nodes.length;
      if (firstFramePath === null) {
        firstFramePath = entry.frame_path;
        firstFrameUrl = entry.frame_url || null;
      }
      for (const node of nodes) {
        if (node instanceof Element && isVisible(node)) {
          visibleCount += 1;
        }
      }
    }
    const matched =
      expectedState === "hidden"
        ? presentCount === 0
        : expectedState === "present"
          ? presentCount > 0
          : visibleCount > 0;
    return {
      selector,
      expected_state: expectedState,
      matched,
      present_count: presentCount,
      visible_count: visibleCount,
      frame_count: documentEntries.length,
      inaccessible_frame_count: documentCollection.inaccessible_frame_count,
      first_match_frame_path: firstFramePath,
      first_match_frame_url: firstFrameUrl,
    };
  })()`;
}

function waitForLoadStateProbeExpression(): string {
  return `(() => ({
    ready_state: document.readyState,
  }))()`;
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
    await this.#enforceBrowserSafetyPolicy(config, definition.id, args, context);

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
        const scopeSelector = optionalTrimmedString(args.scope_selector);
        const elementOffset = browserGetStateOffset(args.element_offset, "element_offset");
        const elementLimit = browserGetStateLimit({
          value: args.element_limit,
          fieldName: "element_limit",
          defaultValue: DEFAULT_BROWSER_GET_STATE_ELEMENT_LIMIT,
          maxValue: MAX_BROWSER_GET_STATE_ELEMENT_LIMIT,
        });
        const mediaOffset = browserGetStateOffset(args.media_offset, "media_offset");
        const mediaLimit = browserGetStateLimit({
          value: args.media_limit,
          fieldName: "media_limit",
          defaultValue: DEFAULT_BROWSER_GET_STATE_MEDIA_LIMIT,
          maxValue: MAX_BROWSER_GET_STATE_MEDIA_LIMIT,
        });
        const snapshot = await this.#readBrowserGetStateSnapshot(
          config,
          context,
          {
            includePageText,
            includeScreenshot,
            scopeSelector,
            elementOffset,
            elementLimit,
            mediaOffset,
            mediaLimit,
          }
        );
        const payload: Record<string, unknown> = {
          ok: true,
          page: snapshot.page,
          state: snapshot.state,
          state_fingerprint: browserStateFingerprint({
            page: snapshot.page,
            state: snapshot.state,
          }),
          trust_boundary: {
            browser_content_untrusted: true,
            source_origin: browserContentOrigin(snapshot.page),
            page_text_untrusted: includePageText,
          },
        };
        const state = asRecord(payload.state);
        const sourceOrigin = browserContentOrigin(snapshot.page);
        if (
          includePageText &&
          state &&
          typeof state.text === "string"
        ) {
          const boundaryWrapped = wrapUntrustedBoundaryText({
            text: state.text,
            origin: sourceOrigin,
            enabled: config.desktopBrowserUntrustedBoundariesEnabled !== false,
          });
          state.text = boundaryWrapped.wrappedText;
          if (boundaryWrapped.boundary) {
            const trustBoundary = asRecord(payload.trust_boundary) ?? {};
            trustBoundary.page_text_boundary = boundaryWrapped.boundary;
            payload.trust_boundary = trustBoundary;
          }
        }
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
      case "browser_wait_for_selector": {
        const selector = requiredString(args.selector, "selector");
        const state = browserWaitSelectorState(args.state);
        const timeoutMs = browserWaitTimeoutMs(args.timeout_ms);
        const intervalMs = browserWaitIntervalMs(args.interval_ms);
        return await this.#waitForSelector({
          config,
          context,
          selector,
          state,
          timeoutMs,
          intervalMs,
        });
      }
      case "browser_wait_for_url": {
        const expectedUrl = requiredString(args.url, "url");
        const mode = browserWaitUrlMode(args.mode);
        const timeoutMs = browserWaitTimeoutMs(args.timeout_ms);
        const intervalMs = browserWaitIntervalMs(args.interval_ms);
        return await this.#waitForUrl({
          config,
          context,
          expectedUrl,
          mode,
          timeoutMs,
          intervalMs,
        });
      }
      case "browser_wait_for_load_state": {
        const state = browserWaitLoadState(args.state);
        const timeoutMs = browserWaitTimeoutMs(args.timeout_ms);
        const intervalMs = browserWaitIntervalMs(args.interval_ms);
        return await this.#waitForLoadState({
          config,
          context,
          state,
          timeoutMs,
          intervalMs,
        });
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

  async #enforceBrowserSafetyPolicy(
    config: ProductRuntimeConfig,
    toolId: DesktopBrowserToolId,
    args: Record<string, unknown>,
    context: DesktopBrowserToolExecutionContext,
  ): Promise<void> {
    const actionCategory = browserActionCategory(toolId);
    if (!actionCategory) {
      return;
    }

    const blockedActions = normalizedLowercaseSet(config.desktopBrowserBlockedActions);
    if (blockedActions.has(actionCategory)) {
      throw new DesktopBrowserToolServiceError(
        403,
        "browser_action_blocked",
        `Browser action '${actionCategory}' is blocked by runtime policy.`,
      );
    }

    const confirmActions = normalizedLowercaseSet(config.desktopBrowserConfirmActions);
    if (confirmActions.has(actionCategory) && !actionRequiresConfirmation(args)) {
      throw new DesktopBrowserToolServiceError(
        409,
        "browser_action_confirmation_required",
        `Browser action '${actionCategory}' requires explicit confirmation. Retry with confirm=true.`,
      );
    }

    const allowedDomains = config.desktopBrowserAllowedDomains ?? [];
    if (allowedDomains.length === 0) {
      return;
    }

    const candidateUrls: string[] = [];
    if (toolId === "browser_navigate" || toolId === "browser_open_tab") {
      const targetUrl = optionalTrimmedString(args.url);
      if (targetUrl) {
        candidateUrls.push(targetUrl);
      } else {
        return;
      }
    } else {
      const page = await this.#browserFetch(config, {
        method: "GET",
        path: "/page",
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        space: context.space,
      });
      const activeUrl = optionalTrimmedString(page.url);
      if (activeUrl) {
        candidateUrls.push(activeUrl);
      }
    }

    for (const url of candidateUrls) {
      if (browserDomainAllowed({ url, allowedDomains })) {
        return;
      }
    }
    throw new DesktopBrowserToolServiceError(
      403,
      "browser_domain_blocked",
      `Browser action is blocked by domain policy. Allowed domains: ${allowedDomains.join(", ")}`,
    );
  }

  async #waitForSelector(params: {
    config: ProductRuntimeConfig;
    context: DesktopBrowserToolExecutionContext;
    selector: string;
    state: BrowserWaitSelectorState;
    timeoutMs: number;
    intervalMs: number;
  }): Promise<Record<string, unknown>> {
    const start = Date.now();
    let lastProbe: Record<string, unknown> = {};
    while (Date.now() - start <= params.timeoutMs) {
      lastProbe = await this.#evaluate(
        params.config,
        waitForSelectorProbeExpression({
          selector: params.selector,
          state: params.state,
        }),
        params.context,
      );
      if (lastProbe.matched === true) {
        return {
          ok: true,
          waited_for: "selector",
          selector: params.selector,
          expected_state: params.state,
          timeout_ms: params.timeoutMs,
          elapsed_ms: Date.now() - start,
          probe: lastProbe,
        };
      }
      await this.#sleep(params.intervalMs);
    }
    return {
      ok: false,
      timed_out: true,
      waited_for: "selector",
      selector: params.selector,
      expected_state: params.state,
      timeout_ms: params.timeoutMs,
      elapsed_ms: Date.now() - start,
      probe: lastProbe,
    };
  }

  async #waitForUrl(params: {
    config: ProductRuntimeConfig;
    context: DesktopBrowserToolExecutionContext;
    expectedUrl: string;
    mode: BrowserWaitUrlMode;
    timeoutMs: number;
    intervalMs: number;
  }): Promise<Record<string, unknown>> {
    const start = Date.now();
    let lastUrl = "";
    while (Date.now() - start <= params.timeoutMs) {
      const page = await this.#browserFetch(params.config, {
        method: "GET",
        path: "/page",
        workspaceId: params.context.workspaceId,
        sessionId: params.context.sessionId,
        space: params.context.space,
      });
      const currentUrl = optionalTrimmedString(page.url) ?? "";
      lastUrl = currentUrl;
      let matched = false;
      if (params.mode === "exact") {
        matched = currentUrl === params.expectedUrl;
      } else if (params.mode === "contains") {
        matched = currentUrl.includes(params.expectedUrl);
      } else {
        try {
          matched = new RegExp(params.expectedUrl).test(currentUrl);
        } catch {
          throw new DesktopBrowserToolServiceError(
            400,
            "browser_tool_invalid_args",
            "url regex is invalid",
          );
        }
      }
      if (matched) {
        return {
          ok: true,
          waited_for: "url",
          mode: params.mode,
          expected_url: params.expectedUrl,
          current_url: currentUrl,
          timeout_ms: params.timeoutMs,
          elapsed_ms: Date.now() - start,
        };
      }
      await this.#sleep(params.intervalMs);
    }
    return {
      ok: false,
      timed_out: true,
      waited_for: "url",
      mode: params.mode,
      expected_url: params.expectedUrl,
      current_url: lastUrl,
      timeout_ms: params.timeoutMs,
      elapsed_ms: Date.now() - start,
    };
  }

  async #waitForLoadState(params: {
    config: ProductRuntimeConfig;
    context: DesktopBrowserToolExecutionContext;
    state: BrowserWaitLoadState;
    timeoutMs: number;
    intervalMs: number;
  }): Promise<Record<string, unknown>> {
    const start = Date.now();
    let lastReadyState = "";
    let lastPageLoading: boolean | null = null;
    while (Date.now() - start <= params.timeoutMs) {
      const page = await this.#browserFetch(params.config, {
        method: "GET",
        path: "/page",
        workspaceId: params.context.workspaceId,
        sessionId: params.context.sessionId,
        space: params.context.space,
      });
      const probe = await this.#evaluate(
        params.config,
        waitForLoadStateProbeExpression(),
        params.context,
      );
      const readyState = optionalTrimmedString(probe.ready_state) ?? "";
      lastReadyState = readyState;
      const pageLoading = page.loading === true;
      lastPageLoading = pageLoading;
      const matched =
        params.state === "domcontentloaded"
          ? readyState === "interactive" || readyState === "complete"
          : params.state === "load"
            ? readyState === "complete"
            : readyState === "complete" && pageLoading === false;
      if (matched) {
        return {
          ok: true,
          waited_for: "load_state",
          state: params.state,
          ready_state: readyState,
          page_loading: pageLoading,
          timeout_ms: params.timeoutMs,
          elapsed_ms: Date.now() - start,
        };
      }
      await this.#sleep(params.intervalMs);
    }
    return {
      ok: false,
      timed_out: true,
      waited_for: "load_state",
      state: params.state,
      ready_state: lastReadyState,
      page_loading: lastPageLoading,
      timeout_ms: params.timeoutMs,
      elapsed_ms: Date.now() - start,
    };
  }

  async #sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
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
    params: {
      includePageText: boolean;
      includeScreenshot: boolean;
      scopeSelector: string | null;
      elementOffset: number;
      elementLimit: number;
      mediaOffset: number;
      mediaLimit: number;
    },
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
      const rawState = await this.#evaluate(
        config,
        interactiveElementsExpression({
          includePageText: params.includePageText,
          scopeSelector: params.scopeSelector,
          elementOffset: params.elementOffset,
          elementLimit: params.elementLimit,
          mediaOffset: params.mediaOffset,
          mediaLimit: params.mediaLimit,
        }),
        context,
      );
      const state = normalizeBrowserGetStateState({
        state: rawState,
        scopeSelector: params.scopeSelector,
        elementOffset: params.elementOffset,
        elementLimit: params.elementLimit,
        mediaOffset: params.mediaOffset,
        mediaLimit: params.mediaLimit,
      });
      const screenshot = params.includeScreenshot
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
          includeScreenshot: params.includeScreenshot,
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
