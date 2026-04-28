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
  signal?: AbortSignal;
};

type BrowserTargetKind = "element" | "media";
type BrowserGetStateMode = "state" | "text" | "structured" | "visual";
type BrowserGetStateScope = "main" | "viewport" | "focused" | "dialog";
type BrowserActionKind =
  | "click"
  | "double_click"
  | "hover"
  | "focus"
  | "fill"
  | "type"
  | "press"
  | "select"
  | "scroll_into_view";
type BrowserWaitCondition = "load" | "url" | "text" | "element" | "hidden" | "dom_change";

type BrowserGetStateOptions = {
  includePageText: boolean;
  includeScreenshot: boolean;
  mode: BrowserGetStateMode;
  scope: BrowserGetStateScope;
  maxNodes: number | null;
  includeMetadata: boolean;
};

type BrowserLocatorOptions = {
  ref: string | null;
  text: string | null;
  label: string | null;
  placeholder: string | null;
  role: string | null;
  selector: string | null;
  xpath: string | null;
  exact: boolean;
  includeHidden: boolean;
  scope: BrowserGetStateScope;
};

type BrowserFindOptions = BrowserLocatorOptions & {
  maxResults: number;
};

type BrowserActOptions = BrowserLocatorOptions & {
  action: BrowserActionKind;
  value: string | null;
  key: string | null;
  clear: boolean | null;
  submit: boolean;
};

type BrowserWaitOptions = BrowserLocatorOptions & {
  condition: BrowserWaitCondition;
  url: string | null;
  timeoutMs: number;
};

type BrowserEvaluateOptions = {
  expression: string;
  allowMutation: boolean;
  timeoutMs: number;
};

type BrowserDebugOptions = {
  x: number | null;
  y: number | null;
  includeDomSample: boolean;
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
const BROWSER_FIND_DEFAULT_MAX_RESULTS = 25;
const BROWSER_FIND_MAX_RESULTS = 100;
const BROWSER_WAIT_DEFAULT_TIMEOUT_MS = 5000;
const BROWSER_TOOL_MAX_TIMEOUT_MS = 30000;
const BROWSER_WAIT_POLL_INTERVAL_MS = 250;


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

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalStringArg(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

function boundedTimeoutMs(value: unknown, defaultValue: number): number {
  const parsed = optionalInteger(value);
  if (parsed === null) {
    return defaultValue;
  }
  if (parsed < 100 || parsed > BROWSER_TOOL_MAX_TIMEOUT_MS) {
    throw new DesktopBrowserToolServiceError(
      400,
      "browser_tool_invalid_args",
      `timeout_ms must be between 100 and ${BROWSER_TOOL_MAX_TIMEOUT_MS}`
    );
  }
  return parsed;
}

function boundedMaxResults(value: unknown): number {
  const parsed = optionalPositiveIntegerArg(value, "max_results") ?? BROWSER_FIND_DEFAULT_MAX_RESULTS;
  return Math.min(parsed, BROWSER_FIND_MAX_RESULTS);
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

function requiredNonNegativeInteger(value: unknown, fieldName: string): number {
  const parsed = optionalInteger(value);
  if (parsed === null || parsed < 0) {
    throw new DesktopBrowserToolServiceError(
      400,
      "browser_tool_invalid_args",
      `${fieldName} must be a non-negative integer`
    );
  }
  return parsed;
}

function browserActionKind(value: unknown): BrowserActionKind {
  if (
    value === "click" ||
    value === "double_click" ||
    value === "hover" ||
    value === "focus" ||
    value === "fill" ||
    value === "type" ||
    value === "press" ||
    value === "select" ||
    value === "scroll_into_view"
  ) {
    return value;
  }
  throw new DesktopBrowserToolServiceError(
    400,
    "browser_tool_invalid_args",
    "action must be one of `click`, `double_click`, `hover`, `focus`, `fill`, `type`, `press`, `select`, or `scroll_into_view`"
  );
}

function hasLocator(args: Record<string, unknown>): boolean {
  return Boolean(
    optionalStringArg(args.ref) ||
      optionalStringArg(args.text) ||
      optionalStringArg(args.label) ||
      optionalStringArg(args.placeholder) ||
      optionalStringArg(args.role) ||
      optionalStringArg(args.selector) ||
      optionalStringArg(args.xpath)
  );
}

function browserWaitCondition(value: unknown, args: Record<string, unknown>): BrowserWaitCondition {
  if (value === undefined || value === null) {
    if (optionalStringArg(args.url)) {
      return "url";
    }
    if (optionalStringArg(args.text)) {
      return "text";
    }
    if (hasLocator(args)) {
      return "element";
    }
    return "load";
  }
  if (
    value === "load" ||
    value === "url" ||
    value === "text" ||
    value === "element" ||
    value === "hidden" ||
    value === "dom_change"
  ) {
    return value;
  }
  if (value === "dom_mutation") {
    return "dom_change";
  }
  throw new DesktopBrowserToolServiceError(
    400,
    "browser_tool_invalid_args",
    "condition must be `load`, `url`, `text`, `element`, `hidden`, `dom_change`, or `dom_mutation`"
  );
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

function browserLocatorOptions(args: Record<string, unknown>, options: { requireLocator: boolean }): BrowserLocatorOptions {
  const locator = {
    ref: optionalStringArg(args.ref),
    text: optionalStringArg(args.text),
    label: optionalStringArg(args.label),
    placeholder: optionalStringArg(args.placeholder),
    role: optionalStringArg(args.role),
    selector: optionalStringArg(args.selector),
    xpath: optionalStringArg(args.xpath),
    exact: optionalBoolean(args.exact, false),
    includeHidden: optionalBoolean(args.include_hidden ?? args.includeHidden, false),
    scope: browserGetStateScope(args.scope),
  };
  if (
    options.requireLocator &&
    !locator.ref &&
    !locator.text &&
    !locator.label &&
    !locator.placeholder &&
    !locator.role &&
    !locator.selector &&
    !locator.xpath
  ) {
    throw new DesktopBrowserToolServiceError(
      400,
      "browser_tool_invalid_args",
      "at least one locator is required: ref, text, label, placeholder, role, selector, or xpath"
    );
  }
  return locator;
}

function browserFindOptions(args: Record<string, unknown>): BrowserFindOptions {
  return {
    ...browserLocatorOptions(args, { requireLocator: true }),
    maxResults: boundedMaxResults(args.max_results ?? args.maxResults),
  };
}

function browserActOptions(args: Record<string, unknown>): BrowserActOptions {
  const action = browserActionKind(args.action);
  return {
    ...browserLocatorOptions(args, { requireLocator: action !== "press" }),
    action,
    value: optionalStringArg(args.value ?? args.text_value),
    key: optionalStringArg(args.key),
    clear: typeof args.clear === "boolean" ? args.clear : null,
    submit: optionalBoolean(args.submit, false),
  };
}

function browserWaitOptions(args: Record<string, unknown>): BrowserWaitOptions {
  const condition = browserWaitCondition(args.condition, args);
  const url = optionalStringArg(args.url);
  const text = optionalStringArg(args.text);
  if (condition === "url" && !url) {
    throw new DesktopBrowserToolServiceError(400, "browser_tool_invalid_args", "url is required for url waits");
  }
  if (condition === "text" && !text) {
    throw new DesktopBrowserToolServiceError(400, "browser_tool_invalid_args", "text is required for text waits");
  }
  return {
    ...browserLocatorOptions(args, { requireLocator: condition === "element" || condition === "hidden" }),
    condition,
    url,
    timeoutMs: boundedTimeoutMs(args.timeout_ms ?? args.timeoutMs, BROWSER_WAIT_DEFAULT_TIMEOUT_MS),
  };
}

function browserEvaluateOptions(args: Record<string, unknown>): BrowserEvaluateOptions {
  return {
    expression: requiredString(args.expression, "expression"),
    allowMutation: optionalBoolean(args.allow_mutation ?? args.allowMutation, false),
    timeoutMs: boundedTimeoutMs(args.timeout_ms ?? args.timeoutMs, BROWSER_WAIT_DEFAULT_TIMEOUT_MS),
  };
}

function browserDebugOptions(args: Record<string, unknown>): BrowserDebugOptions {
  return {
    x: optionalNumber(args.x),
    y: optionalNumber(args.y),
    includeDomSample: optionalBoolean(args.include_dom_sample ?? args.includeDomSample, false),
  };
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

function browserLocatorRuntime(locator: BrowserLocatorOptions): string {
  return `
    const interactiveSelector = ${serializedValue(INTERACTIVE_ELEMENTS_SELECTOR)};
    const locator = ${serializedValue({
      ref: locator.ref,
      text: locator.text,
      label: locator.label,
      placeholder: locator.placeholder,
      role: locator.role,
      selector: locator.selector,
      xpath: locator.xpath,
      exact: locator.exact,
      includeHidden: locator.includeHidden,
      scope: locator.scope,
    })};
    const textLimit = ${BROWSER_GET_STATE_ELEMENT_TEXT_MAX_CHARS};
    const normalize = (value) => String(value || "").replace(/\\s+/g, " ").trim().toLowerCase();
    const visibleText = (element) => String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
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
      if (!(element instanceof HTMLElement)) return false;
      if (locator.scope === "main") return true;
      if (locator.scope === "viewport") return intersectsViewport(element);
      if (locator.scope === "dialog") return dialogRoots.some((root) => root === element || root.contains(element));
      if (locator.scope === "focused") {
        return focusedRoot ? element === focusedRoot || focusedRoot.contains(element) || element.contains(focusedRoot) : false;
      }
      return true;
    };
    const xpathElements = (xpath) => {
      const result = document.evaluate(xpath, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const elements = [];
      for (let index = 0; index < result.snapshotLength; index += 1) {
        const node = result.snapshotItem(index);
        if (node instanceof HTMLElement) elements.push(node);
      }
      return elements;
    };
    const cssEscape = (value) => {
      if (window.CSS && typeof window.CSS.escape === "function") {
        return window.CSS.escape(value);
      }
      return String(value).replace(/[^A-Za-z0-9_-]/g, "\\\\$&");
    };
    const cssPath = (element) => {
      if (!(element instanceof HTMLElement)) return "";
      if (element.id && document.querySelectorAll("#" + cssEscape(element.id)).length === 1) {
        return "css:#" + cssEscape(element.id);
      }
      const parts = [];
      let current = element;
      while (current instanceof HTMLElement && current !== document.documentElement) {
        const parent = current.parentElement;
        if (!parent) break;
        const tag = current.tagName.toLowerCase();
        const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
        const nth = siblings.indexOf(current) + 1;
        parts.unshift(tag + ":nth-of-type(" + nth + ")");
        current = parent;
      }
      return "css:html > " + parts.join(" > ");
    };
    const resolveRef = (ref) => {
      if (!ref) return null;
      if (ref.startsWith("css:")) {
        return document.querySelector(ref.slice(4));
      }
      if (ref.startsWith("xpath:")) {
        return xpathElements(ref.slice(6))[0] || null;
      }
      return document.querySelector(ref);
    };
    const hasFrameworkClickHandler = (element) => {
      for (const key of Object.keys(element)) {
        if (!key.startsWith("__reactProps$") && !key.startsWith("__reactEventHandlers$")) continue;
        const value = element[key];
        if (!value || typeof value !== "object") continue;
        if (
          typeof value.onClick === "function" ||
          typeof value.onMouseDown === "function" ||
          typeof value.onPointerDown === "function" ||
          typeof value.onKeyDown === "function"
        ) {
          return true;
        }
      }
      return false;
    };
    const isLikelyClickable = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const explicitRole = String(element.getAttribute("role") || "").toLowerCase();
      if (element.matches(interactiveSelector) || element.hasAttribute("onclick") || typeof element.onclick === "function") return true;
      if (["button", "link", "menuitem", "tab", "checkbox", "radio", "switch"].includes(explicitRole)) return true;
      if (hasFrameworkClickHandler(element)) return true;
      try {
        if (window.getComputedStyle(element).cursor === "pointer") return true;
      } catch {
        return false;
      }
      return false;
    };
    const implicitRole = (element) => {
      const tagName = element.tagName.toLowerCase();
      if (element.getAttribute("role")) return String(element.getAttribute("role") || "").toLowerCase();
      if (tagName === "button") return "button";
      if (tagName === "a" && element.hasAttribute("href")) return "link";
      if (tagName === "textarea") return "textbox";
      if (tagName === "select") return "combobox";
      if (tagName === "option") return "option";
      if (tagName === "input") {
        const type = String(element.getAttribute("type") || "text").toLowerCase();
        if (type === "button" || type === "submit" || type === "reset") return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        if (type === "search") return "searchbox";
        return "textbox";
      }
      if (element.isContentEditable) return "textbox";
      if (isLikelyClickable(element)) return "button";
      return "";
    };
    const labelText = (element) => {
      const labelledBy = String(element.getAttribute("aria-labelledby") || "")
        .split(/\\s+/g)
        .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
        .join(" ");
      const formLabels = "labels" in element && element.labels
        ? Array.from(element.labels).map((label) => label.innerText || label.textContent || "").join(" ")
        : "";
      return [
        element.getAttribute("aria-label") || "",
        labelledBy,
        element.getAttribute("title") || "",
        "placeholder" in element ? String(element.placeholder || "") : "",
        "value" in element ? String(element.value || "") : "",
        formLabels,
        visibleText(element)
      ].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
    };
    const placeholderText = (element) => "placeholder" in element ? String(element.placeholder || "") : "";
    const stringMatches = (value, expected) => {
      if (!expected) return true;
      const haystack = normalize(value);
      const needle = normalize(expected);
      return locator.exact ? haystack === needle : haystack.includes(needle);
    };
    const matchesLocator = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (!locator.includeHidden && !isVisible(element)) return false;
      if (!inScope(element)) return false;
      if (locator.role) {
        const actionElement = actionableTarget(element);
        const roles = [
          implicitRole(element),
          actionElement instanceof HTMLElement ? implicitRole(actionElement) : ""
        ].map((role) => normalize(role));
        if (!roles.includes(normalize(locator.role))) return false;
      }
      if (!stringMatches(visibleText(element), locator.text)) return false;
      if (!stringMatches(labelText(element), locator.label)) return false;
      if (!stringMatches(placeholderText(element), locator.placeholder)) return false;
      return true;
    };
    const sourceElements = () => {
      if (locator.ref) {
        const resolved = resolveRef(locator.ref);
        return resolved instanceof HTMLElement ? [resolved] : [];
      }
      if (locator.selector) {
        return Array.from(document.querySelectorAll(locator.selector)).filter((element) => element instanceof HTMLElement);
      }
      if (locator.xpath) {
        return xpathElements(locator.xpath);
      }
      return Array.from(document.querySelectorAll("body *")).filter((element) => element instanceof HTMLElement);
    };
    const actionableTarget = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      let current = element;
      let depth = 0;
      while (current instanceof HTMLElement && current !== document.body && depth < 8) {
        if (isLikelyClickable(current) || current.hasAttribute("role") || current.hasAttribute("aria-label")) return current;
        current = current.parentElement;
        depth += 1;
      }
      return element.closest(interactiveSelector + ", [onclick], [role], [aria-label]") || element;
    };
    const scoreElement = (element) => {
      let score = 0;
      if (locator.text && normalize(visibleText(element)) === normalize(locator.text)) score += 120;
      else if (locator.text && stringMatches(visibleText(element), locator.text)) {
        score += 70;
        const haystackLength = normalize(visibleText(element)).length;
        const needleLength = Math.max(normalize(locator.text).length, 1);
        const textRatio = haystackLength / needleLength;
        if (haystackLength > 240 || textRatio > 40) score -= 65;
        else if (textRatio > 10) score -= 35;
        else if (textRatio > 3) score -= 15;
      }
      if (locator.label && normalize(labelText(element)) === normalize(locator.label)) score += 90;
      else if (locator.label && stringMatches(labelText(element), locator.label)) score += 50;
      if (locator.placeholder && stringMatches(placeholderText(element), locator.placeholder)) score += 40;
      if (locator.role && normalize(implicitRole(element)) === normalize(locator.role)) score += 30;
      if (isLikelyClickable(element)) score += 25;
      if (intersectsViewport(element)) score += 10;
      return score;
    };
    const describeElement = (element) => {
      const rect = element.getBoundingClientRect();
      const actionElement = actionableTarget(element);
      return {
        ref: cssPath(element),
        action_ref: actionElement instanceof HTMLElement ? cssPath(actionElement) : cssPath(element),
        tag_name: element.tagName.toLowerCase(),
        role: implicitRole(element),
        text: visibleText(element).slice(0, textLimit),
        label: labelText(element).slice(0, textLimit),
        placeholder: placeholderText(element).slice(0, textLimit),
        disabled: "disabled" in element ? Boolean(element.disabled) : false,
        editable:
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element.isContentEditable,
        href: "href" in element ? String(element.href || "") : "",
        visible: isVisible(element),
        bounding_box: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        score: scoreElement(element)
      };
    };
    const findMatches = () => {
      const seen = new Set();
      return sourceElements()
        .filter((element) => matchesLocator(element))
        .filter((element) => {
          const ref = cssPath(element);
          if (!ref || seen.has(ref)) return false;
          seen.add(ref);
          return true;
        })
        .sort((left, right) => {
          const scoreDiff = scoreElement(right) - scoreElement(left);
          if (scoreDiff !== 0) return scoreDiff;
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.top - rightRect.top || leftRect.left - rightRect.left;
        });
    };
  `;
}

function browserFindExpression(options: BrowserFindOptions): string {
  return `(() => {
    ${browserLocatorRuntime(options)}
    const maxResults = ${options.maxResults};
    const allMatches = findMatches();
    const matches = allMatches.slice(0, maxResults).map((element) => describeElement(element));
    return {
      ok: true,
      query: {
        text: locator.text,
        label: locator.label,
        placeholder: locator.placeholder,
        role: locator.role,
        selector: locator.selector,
        xpath: locator.xpath,
        exact: locator.exact,
        include_hidden: locator.includeHidden,
        scope: locator.scope,
        max_results: maxResults
      },
      count: allMatches.length,
      truncated: allMatches.length > matches.length,
      matches
    };
  })()`;
}

function isNativePointerAction(action: BrowserActionKind): action is "click" | "double_click" | "hover" {
  return action === "click" || action === "double_click" || action === "hover";
}

function browserPointerTargetExpression(options: BrowserActOptions): string {
  return `(() => {
    ${browserLocatorRuntime(options)}
    const action = ${serializedValue(options.action)};
    const targetFromLocator = () => {
      const matched = findMatches()[0] || null;
      return matched || null;
    };
    const target = targetFromLocator();
    if (!(target instanceof HTMLElement)) {
      throw new Error("No browser element matched the requested action locator.");
    }
    const actionTarget = actionableTarget(target) || target;
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (typeof actionTarget.focus === "function") {
      try {
        actionTarget.focus({ preventScroll: true });
      } catch {
        actionTarget.focus();
      }
    }
    const rect = actionTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      throw new Error("Matched browser element has no clickable area.");
    }
    const x = Math.round(Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)));
    const y = Math.round(Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2)));
    return {
      ok: true,
      action,
      target: describeElement(target),
      action_target: describeElement(actionTarget),
      result: { x, y }
    };
  })()`;
}

function browserActExpression(options: BrowserActOptions): string {
  return `(() => {
    ${browserLocatorRuntime(options)}
    const action = ${serializedValue(options.action)};
    const value = ${serializedValue(options.value)};
    const key = ${serializedValue(options.key)};
    const submit = ${options.submit ? "true" : "false"};
    const clearArg = ${options.clear === null ? "null" : options.clear ? "true" : "false"};
    const targetFromLocator = () => {
      const matched = findMatches()[0] || null;
      if (matched) return matched;
      if (action === "press" && document.activeElement instanceof HTMLElement) return document.activeElement;
      return null;
    };
    const target = targetFromLocator();
    if (!(target instanceof HTMLElement)) {
      throw new Error("No browser element matched the requested action locator.");
    }
    const actionTarget = actionableTarget(target) || target;
    const editableTarget = (element) => {
      if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        element.isContentEditable
      ) {
        return element;
      }
      return element.querySelector("input, textarea, select, [contenteditable='true']");
    };
    const setNativeValue = (element, nextValue) => {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
        if (descriptor && typeof descriptor.set === "function") {
          descriptor.set.call(element, nextValue);
        } else {
          element.value = nextValue;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return String(element.value || "");
      }
      if (element instanceof HTMLElement && element.isContentEditable) {
        element.innerText = nextValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return String(element.innerText || "");
      }
      throw new Error("Target element is not text-editable.");
    };
    const dispatchMouse = (element, type, detail = 1) => {
      const rect = element.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      element.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        detail
      }));
      return { x, y };
    };
    const pressKey = (element, nextKey) => {
      if (!nextKey) throw new Error("key is required for press actions.");
      for (const type of ["keydown", "keypress", "keyup"]) {
        element.dispatchEvent(new KeyboardEvent(type, { key: nextKey, bubbles: true, cancelable: true }));
      }
      if (nextKey === "Enter" && element instanceof HTMLInputElement && element.form && typeof element.form.requestSubmit === "function") {
        element.form.requestSubmit();
      }
    };
    target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (typeof target.focus === "function") target.focus();
    let actionResult = {};
    if (action === "click" || action === "double_click") {
      if (typeof actionTarget.focus === "function") actionTarget.focus();
      const point = dispatchMouse(actionTarget, "mousemove");
      dispatchMouse(actionTarget, "mousedown");
      dispatchMouse(actionTarget, "mouseup");
      if (typeof actionTarget.click === "function") actionTarget.click();
      if (action === "double_click") {
        dispatchMouse(actionTarget, "mousedown", 2);
        dispatchMouse(actionTarget, "mouseup", 2);
        dispatchMouse(actionTarget, "dblclick", 2);
      }
      actionResult = point;
    } else if (action === "hover") {
      actionResult = dispatchMouse(actionTarget, "mouseover");
      dispatchMouse(actionTarget, "mousemove");
    } else if (action === "focus") {
      if (typeof actionTarget.focus === "function") actionTarget.focus();
    } else if (action === "fill" || action === "type") {
      if (value === null) throw new Error("value is required for fill and type actions.");
      const editTarget = editableTarget(target);
      if (!(editTarget instanceof HTMLElement)) throw new Error("No editable element matched the requested action locator.");
      if (typeof editTarget.focus === "function") editTarget.focus();
      const clear = clearArg === null ? action === "fill" : clearArg;
      const currentValue = "value" in editTarget ? String(editTarget.value || "") : String(editTarget.innerText || "");
      const nextValue = clear ? value : currentValue + value;
      const storedValue = setNativeValue(editTarget, nextValue);
      if (submit) pressKey(editTarget, "Enter");
      actionResult = { value: storedValue };
    } else if (action === "press") {
      pressKey(target, key);
      actionResult = { key };
    } else if (action === "select") {
      if (value === null) throw new Error("value is required for select actions.");
      const selectTarget = editableTarget(target);
      if (!(selectTarget instanceof HTMLSelectElement)) throw new Error("Target element is not a select.");
      const option = Array.from(selectTarget.options).find((entry) => entry.value === value || normalize(entry.textContent) === normalize(value));
      if (!option) throw new Error("No select option matched the requested value.");
      selectTarget.value = option.value;
      selectTarget.dispatchEvent(new Event("input", { bubbles: true }));
      selectTarget.dispatchEvent(new Event("change", { bubbles: true }));
      actionResult = { value: selectTarget.value, selected_text: option.textContent || "" };
    } else if (action === "scroll_into_view") {
      target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    }
    return {
      ok: true,
      action,
      target: describeElement(target),
      action_target: describeElement(actionTarget),
      result: actionResult
    };
  })()`;
}

function browserDomSignatureExpression(): string {
  return `(() => {
    const body = document.body;
    return {
      url: location.href,
      title: document.title,
      ready_state: document.readyState,
      text_length: String(body?.innerText || "").length,
      element_count: document.querySelectorAll("body *").length,
      active_tag: document.activeElement instanceof HTMLElement ? document.activeElement.tagName.toLowerCase() : ""
    };
  })()`;
}

function browserWaitPredicateExpression(options: BrowserWaitOptions, baseline: Record<string, unknown> | null): string {
  const locatorForWait: BrowserLocatorOptions = {
    ...options,
    includeHidden: options.condition === "hidden" ? false : options.includeHidden,
  };
  return `(() => {
    ${browserLocatorRuntime(locatorForWait)}
    const condition = ${serializedValue(options.condition)};
    const expectedUrl = ${serializedValue(options.url)};
    const baseline = ${serializedValue(baseline)};
    const textNeedle = ${serializedValue(options.text)};
    const matchesUrl = (value, expected) => {
      if (!expected) return false;
      if (expected.startsWith("/") && expected.endsWith("/") && expected.length > 2) {
        try {
          return new RegExp(expected.slice(1, -1)).test(value);
        } catch {
          return value.includes(expected);
        }
      }
      return value.includes(expected);
    };
    const bodyText = String(document.body?.innerText || "").replace(/\\s+/g, " ").trim();
    const currentSignature = {
      url: location.href,
      title: document.title,
      ready_state: document.readyState,
      text_length: bodyText.length,
      element_count: document.querySelectorAll("body *").length,
      active_tag: document.activeElement instanceof HTMLElement ? document.activeElement.tagName.toLowerCase() : ""
    };
    const matches = condition === "load"
      ? document.readyState === "complete"
      : condition === "url"
        ? matchesUrl(location.href, expectedUrl || "")
        : condition === "text"
          ? stringMatches(bodyText, textNeedle)
          : condition === "element"
            ? findMatches().length > 0
            : condition === "hidden"
              ? findMatches().length === 0
              : JSON.stringify(currentSignature) !== JSON.stringify(baseline || {});
    return {
      ok: true,
      matched: matches,
      condition,
      match_count: condition === "element" || condition === "hidden" ? findMatches().length : null,
      current: currentSignature
    };
  })()`;
}

function browserEvaluateExpression(options: BrowserEvaluateOptions): string {
  return `(async () => {
    const result = await (${options.expression});
    return {
      ok: true,
      allow_mutation: ${options.allowMutation ? "true" : "false"},
      result: result === undefined ? null : result
    };
  })()`;
}

function browserDebugExpression(options: BrowserDebugOptions): string {
  return `(() => {
    const includeDomSample = ${options.includeDomSample ? "true" : "false"};
    const pointX = ${options.x === null ? "Math.round(window.innerWidth / 2)" : String(options.x)};
    const pointY = ${options.y === null ? "Math.round(window.innerHeight / 2)" : String(options.y)};
    const describe = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      return {
        tag_name: element.tagName.toLowerCase(),
        id: element.id || "",
        class_name: String(element.className || "").slice(0, 120),
        role: element.getAttribute("role") || "",
        aria_label: element.getAttribute("aria-label") || "",
        text: String(element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 160),
        bounding_box: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    };
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hitElement = document.elementFromPoint(pointX, pointY);
    const dialogs = Array.from(document.querySelectorAll("dialog[open], [role='dialog'], [aria-modal='true']"))
      .map((element) => describe(element))
      .filter(Boolean);
    const iframes = Array.from(document.querySelectorAll("iframe"))
      .map((frame) => ({
        title: frame.getAttribute("title") || "",
        src: frame.getAttribute("src") || "",
        ...(() => {
          const rect = frame.getBoundingClientRect();
          return {
            bounding_box: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            }
          };
        })()
      }));
    const domSample = includeDomSample
      ? Array.from(document.querySelectorAll("body *"))
          .filter((element) => element instanceof HTMLElement)
          .slice(0, 40)
          .map((element) => describe(element))
          .filter(Boolean)
      : undefined;
    return {
      ok: true,
      url: location.href,
      title: document.title,
      ready_state: document.readyState,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
      active_element: describe(activeElement),
      hit_test: {
        x: pointX,
        y: pointY,
        element: describe(hitElement)
      },
      dialogs,
      iframes,
      console_logs_available: false,
      network_log_available: false,
      ...(domSample ? { dom_sample: domSample } : {})
    };
  })()`;
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
      case "browser_find": {
        const options = browserFindOptions(args);
        const result = await this.#evaluate(config, browserFindExpression(options), context);
        return { ok: true, find: result };
      }
      case "browser_act": {
        const options = browserActOptions(args);
        let result = await this.#evaluate(
          config,
          isNativePointerAction(options.action)
            ? browserPointerTargetExpression(options)
            : browserActExpression(options),
          context,
        );
        if (isNativePointerAction(options.action)) {
          const point = asRecord(result.result);
          const x = requiredNonNegativeInteger(point?.x, "x");
          const y = requiredNonNegativeInteger(point?.y, "y");
          const nativeInput = await this.#browserFetch(config, {
            method: "POST",
            path: "/mouse",
            body: { action: options.action, x, y },
            workspaceId: context.workspaceId,
            sessionId: context.sessionId,
            space: context.space,
          });
          result = {
            ...result,
            result: { ...(asRecord(result.result) ?? {}), native_input: nativeInput },
          };
        }
        const page = await this.#browserFetch(config, {
          method: "GET",
          path: "/page",
          workspaceId: context.workspaceId,
          sessionId: context.sessionId,
          space: context.space,
        });
        return { ok: true, action: result, page };
      }
      case "browser_wait": {
        const result = await this.#waitForBrowserCondition(config, context, browserWaitOptions(args));
        return { ok: true, wait: result };
      }
      case "browser_evaluate": {
        const options = browserEvaluateOptions(args);
        const result = await this.#evaluate(
          config,
          browserEvaluateExpression(options),
          context,
          options.timeoutMs,
        );
        return { ok: true, evaluation: result };
      }
      case "browser_debug": {
        const options = browserDebugOptions(args);
        const [page, debug] = await Promise.all([
          this.#browserFetch(config, {
            method: "GET",
            path: "/page",
            workspaceId: context.workspaceId,
            sessionId: context.sessionId,
            space: context.space,
          }),
          this.#evaluate(config, browserDebugExpression(options), context),
        ]);
        return { ok: true, page, debug };
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
    context: DesktopBrowserToolExecutionContext = {},
    timeoutMs: number | null = null,
  ): Promise<Record<string, unknown>> {
    const controller = timeoutMs !== null ? new AbortController() : null;
    const timeout =
      controller && timeoutMs !== null
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;
    try {
      const response = await this.#browserFetch(config, {
        method: "POST",
        path: "/evaluate",
        body: evaluateExpressionPayload(expression),
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        space: context.space,
        signal: controller?.signal,
      });
      const payload = asRecord(response);
      return asRecord(payload?.result) ?? {};
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  async #waitForBrowserCondition(
    config: ProductRuntimeConfig,
    context: DesktopBrowserToolExecutionContext,
    options: BrowserWaitOptions,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const baseline =
      options.condition === "dom_change"
        ? await this.#evaluate(config, browserDomSignatureExpression(), context)
        : null;
    let attempts = 0;
    let lastResult: Record<string, unknown> = {};
    while (Date.now() - startedAt <= options.timeoutMs) {
      attempts += 1;
      lastResult = await this.#evaluate(
        config,
        browserWaitPredicateExpression(options, baseline),
        context,
      );
      if (lastResult.matched === true) {
        return {
          matched: true,
          attempts,
          elapsed_ms: Date.now() - startedAt,
          condition: options.condition,
          result: lastResult,
        };
      }
      await new Promise((resolve) =>
        setTimeout(resolve, BROWSER_WAIT_POLL_INTERVAL_MS),
      );
    }
    return {
      matched: false,
      attempts,
      elapsed_ms: Date.now() - startedAt,
      condition: options.condition,
      result: lastResult,
    };
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
    let response: Response;
    try {
      response = await this.#fetch(requestUrl, {
        method: options.method,
        headers: browserToolHeaders(config, {
          workspaceId: options.workspaceId,
          sessionId: options.sessionId,
          space: options.space,
        }),
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new DesktopBrowserToolServiceError(
          504,
          "desktop_browser_request_timeout",
          "Desktop browser request timed out"
        );
      }
      throw error;
    }
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
