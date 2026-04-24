import { useEffect, useRef, useState } from "react";

export interface BrowserChatCommentDraftItem {
  id: string;
  text: string;
  elementLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  file: File;
}

export interface BrowserChatCommentDraftPayload {
  tabId: string;
  pageTitle: string;
  url: string;
  comments: BrowserChatCommentDraftItem[];
  mode?: "replace" | "append";
}

interface UseBrowserCaptureActionsOptions {
  onAttachCommentsToChat?: (payload: BrowserChatCommentDraftPayload) => void;
}

function browserCaptureErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "Browser capture failed.";
}

function sanitizeBrowserCaptureFilenameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return normalized || "selection";
}

function browserCommentFileName(
  comment: BrowserCommentCaptureAttachmentPayload,
  index: number,
): string {
  const label = sanitizeBrowserCaptureFilenameSegment(comment.elementLabel);
  return `browser-comment-${index + 1}-${label}.png`;
}

function browserCommentDataUrl(
  comment: BrowserCommentCaptureAttachmentPayload,
): string {
  const mimeType = comment.mimeType?.trim() || "image/png";
  return `data:${mimeType};base64,${comment.base64}`;
}

async function loadBrowserCommentImage(
  comment: BrowserCommentCaptureAttachmentPayload,
): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  const imageUrl = browserCommentDataUrl(comment);
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not prepare the browser comment image."));
    image.src = imageUrl;
  });
  return image;
}

function wrapBrowserCommentText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const normalizedText = text.trim().replace(/\s+/g, " ");
  if (!normalizedText) {
    return [];
  }
  const words = normalizedText.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (context.measureText(nextLine).width <= maxWidth || !currentLine) {
      currentLine = nextLine;
      continue;
    }
    lines.push(currentLine);
    currentLine = word;
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.lineTo(x + width - clampedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  context.lineTo(x + width, y + height - clampedRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - clampedRadius,
    y + height,
  );
  context.lineTo(x + clampedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  context.lineTo(x, y + clampedRadius);
  context.quadraticCurveTo(x, y, x + clampedRadius, y);
  context.closePath();
}

function fallbackBrowserCommentFile(
  comment: BrowserCommentCaptureAttachmentPayload,
  index: number,
): File {
  const binary = globalThis.atob(comment.base64);
  const bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += 1) {
    bytes[offset] = binary.charCodeAt(offset);
  }
  return new File([bytes], browserCommentFileName(comment, index), {
    type: comment.mimeType || "image/png",
    lastModified: Date.now(),
  });
}

async function browserCommentFile(
  comment: BrowserCommentCaptureAttachmentPayload,
  index: number,
): Promise<File> {
  const fallbackFile = fallbackBrowserCommentFile(comment, index);
  if (typeof document === "undefined") {
    return fallbackFile;
  }

  try {
    const image = await loadBrowserCommentImage(comment);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      return fallbackFile;
    }

    const canvasPadding = 20;
    const cardWidth = Math.max(320, image.width + canvasPadding * 2);
    const bubbleWidth = cardWidth - canvasPadding * 2;
    const badgeSize = 28;
    const bubbleHorizontalPadding = 16;
    const bubbleTopPadding = 16;
    const bubbleBottomPadding = 14;
    const bubbleLineHeight = 20;
    const bubbleGap = 14;
    const bubbleTitle =
      comment.elementLabel.trim() || `Comment ${index + 1}`;
    const bubbleText = comment.text.trim();

    context.font = '600 12px "Inter Variable", system-ui, sans-serif';
    const titleLines = wrapBrowserCommentText(
      context,
      bubbleTitle,
      bubbleWidth - bubbleHorizontalPadding * 2 - badgeSize - 10,
    );
    context.font = '500 15px "Inter Variable", system-ui, sans-serif';
    const textLines = wrapBrowserCommentText(
      context,
      bubbleText,
      bubbleWidth - bubbleHorizontalPadding * 2,
    );
    const titleBlockHeight = Math.max(1, titleLines.length) * 16;
    const textBlockHeight = Math.max(1, textLines.length) * bubbleLineHeight;
    const bubbleHeight =
      bubbleTopPadding +
      titleBlockHeight +
      10 +
      textBlockHeight +
      bubbleBottomPadding;
    const screenshotY = canvasPadding + bubbleHeight + bubbleGap;

    canvas.width = cardWidth;
    canvas.height = screenshotY + image.height + canvasPadding;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const bubbleX = canvasPadding;
    const bubbleY = canvasPadding;
    context.save();
    drawRoundedRect(context, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 18);
    context.fillStyle = "#f8fbff";
    context.fill();
    context.strokeStyle = "rgba(59, 130, 246, 0.18)";
    context.lineWidth = 1;
    context.stroke();
    context.restore();

    const badgeX = bubbleX + bubbleHorizontalPadding;
    const badgeY = bubbleY + bubbleTopPadding;
    context.fillStyle = "#2563eb";
    context.beginPath();
    context.arc(
      badgeX + badgeSize / 2,
      badgeY + badgeSize / 2,
      badgeSize / 2,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = '700 14px "Inter Variable", system-ui, sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      String(index + 1),
      badgeX + badgeSize / 2,
      badgeY + badgeSize / 2 + 0.5,
    );

    let textY = bubbleY + bubbleTopPadding;
    const textX = badgeX + badgeSize + 10;
    context.textAlign = "left";
    context.textBaseline = "top";
    context.fillStyle = "#0f172a";
    context.font = '600 12px "Inter Variable", system-ui, sans-serif';
    for (const line of titleLines) {
      context.fillText(line, textX, textY);
      textY += 16;
    }

    textY += 10;
    context.fillStyle = "#111827";
    context.font = '500 15px "Inter Variable", system-ui, sans-serif';
    for (const line of textLines) {
      context.fillText(line, bubbleX + bubbleHorizontalPadding, textY);
      textY += bubbleLineHeight;
    }

    const screenshotX = Math.round((canvas.width - image.width) / 2);
    context.save();
    drawRoundedRect(context, screenshotX, screenshotY, image.width, image.height, 16);
    context.clip();
    context.drawImage(image, screenshotX, screenshotY, image.width, image.height);
    context.restore();
    context.strokeStyle = "rgba(15, 23, 42, 0.08)";
    context.lineWidth = 1;
    drawRoundedRect(context, screenshotX, screenshotY, image.width, image.height, 16);
    context.stroke();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) {
      return fallbackFile;
    }
    return new File([blob], browserCommentFileName(comment, index), {
      type: "image/png",
      lastModified: Date.now(),
    });
  } catch {
    return fallbackFile;
  }
}

export function useBrowserCaptureActions(
  options?: UseBrowserCaptureActionsOptions,
) {
  const [actionStatus, setActionStatus] = useState("");
  const [busyAction, setBusyAction] = useState<"clipboard" | "comments" | null>(
    null,
  );
  const clearStatusTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (clearStatusTimeoutRef.current !== null) {
        window.clearTimeout(clearStatusTimeoutRef.current);
      }
    };
  }, []);

  const showActionStatus = (message: string) => {
    if (clearStatusTimeoutRef.current !== null) {
      window.clearTimeout(clearStatusTimeoutRef.current);
    }
    setActionStatus(message);
    clearStatusTimeoutRef.current = window.setTimeout(() => {
      setActionStatus("");
      clearStatusTimeoutRef.current = null;
    }, 1800);
  };

  const captureScreenshotToClipboard = async () => {
    if (busyAction) {
      return;
    }
    setBusyAction("clipboard");
    try {
      const result = await window.electronAPI.browser.captureScreenshotToClipboard();
      showActionStatus(
        result.copied
          ? "Copied screenshot to clipboard."
          : "Screenshot capture cancelled.",
      );
    } catch (error) {
      showActionStatus(browserCaptureErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  const captureCommentsForChat = async () => {
    if (busyAction) {
      return;
    }
    setBusyAction("comments");
    try {
      const result = await window.electronAPI.browser.captureCommentsForChat();
      if (result.canceled || result.comments.length === 0) {
        showActionStatus("Comment mode cancelled.");
        return;
      }
      if (!options?.onAttachCommentsToChat) {
        showActionStatus("Chat attachments are unavailable.");
        return;
      }
      const comments = await Promise.all(
        result.comments.map(async (comment, index) => ({
          id: comment.id,
          text: comment.text,
          elementLabel: comment.elementLabel,
          x: comment.x,
          y: comment.y,
          width: comment.width,
          height: comment.height,
          file: await browserCommentFile(comment, index),
        })),
      );
      options.onAttachCommentsToChat({
        tabId: result.tabId,
        pageTitle: result.pageTitle,
        url: result.url,
        comments,
        mode: "replace",
      });
      showActionStatus(
        result.comments.length === 1
          ? "Attached 1 browser comment."
          : `Attached ${result.comments.length} browser comments.`,
      );
    } catch (error) {
      showActionStatus(browserCaptureErrorMessage(error));
    } finally {
      setBusyAction(null);
    }
  };

  return {
    actionStatus,
    busyAction,
    captureScreenshotToClipboard,
    captureCommentsForChat,
    screenshotCapturePending: busyAction === "clipboard",
    commentCapturePending: busyAction === "comments",
  };
}
