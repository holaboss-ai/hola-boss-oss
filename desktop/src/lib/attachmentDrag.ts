export const EXPLORER_ATTACHMENT_DRAG_TYPE = "application/x-holaboss-explorer-attachment";

export interface ExplorerAttachmentDragPayload {
  absolutePath: string;
  name: string;
  size: number;
  mimeType?: string | null;
}

const IMAGE_ATTACHMENT_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function inferDraggedAttachmentKind(name: string, mimeType?: string | null): "image" | "file" {
  const normalizedMimeType = (mimeType ?? "").trim().toLowerCase();
  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }

  const lastDotIndex = name.lastIndexOf(".");
  const extension = lastDotIndex >= 0 ? name.slice(lastDotIndex).toLowerCase() : "";
  return IMAGE_ATTACHMENT_EXTENSIONS.has(extension) ? "image" : "file";
}

export function serializeExplorerAttachmentDragPayload(payload: ExplorerAttachmentDragPayload): string {
  return JSON.stringify(payload);
}

export function parseExplorerAttachmentDragPayload(raw: string): ExplorerAttachmentDragPayload | null {
  if (!raw.trim()) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) {
      return null;
    }

    const absolutePath = typeof value.absolutePath === "string" ? value.absolutePath.trim() : "";
    const name = typeof value.name === "string" ? value.name.trim() : "";
    const size = typeof value.size === "number" && Number.isFinite(value.size) ? value.size : 0;
    const mimeType =
      typeof value.mimeType === "string" && value.mimeType.trim().length > 0 ? value.mimeType.trim() : undefined;

    if (!absolutePath || !name) {
      return null;
    }

    return {
      absolutePath,
      name,
      size,
      mimeType,
    };
  } catch {
    return null;
  }
}
