/**
 * Lightweight markdown renderer for template README content.
 * Handles: headings, bold, italic, inline code, code blocks, images,
 * blockquotes, tables, links, lists, and horizontal rules.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderMarkdown(source: string): string {
  const normalizedSource = source.replace(/\r\n?/g, "\n");
  let html = escapeHtml(normalizedSource);
  const codeBlocks: string[] = [];

  // Code blocks (``` ... ```)
  html = html.replace(/```[\w-]*\n([\s\S]*?)```/g, (_match, code: string) => {
    const token = `@@MD_CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(`<pre class="md-code-block"><code>${code.trim()}</code></pre>`);
    return token;
  });

  // Images ![alt](src)
  html = html.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" class="md-img" loading="lazy" />'
  );

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener">$1</a>'
  );

  // Tables
  html = html.replace(
    /^( {0,3}\|[^\n]*\|[ \t]*)\n( {0,3}\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*)\n((?: {0,3}\|[^\n]*\|[ \t]*(?:\n|$))+)/gm,
    (_match, header: string, _sep: string, body: string) => {
      const parseCells = (line: string) =>
        line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell: string) => cell.trim());

      const headerCells = parseCells(header);
      const ths = headerCells.map((cell) => `<th>${cell}</th>`).join("");
      const rows = body
        .trim()
        .split("\n")
        .map((row: string) => parseCells(row))
        .filter((cells) => cells.length > 0)
        .map((cells) => {
          const tds = cells.map((cell) => `<td>${cell}</td>`).join("");
          return `<tr>${tds}</tr>`;
        })
        .join("");
      return `<table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  );

  // Headings
  html = html.replace(/^ {0,3}###### (.+)$/gm, '<h6 class="md-h6">$1</h6>');
  html = html.replace(/^ {0,3}##### (.+)$/gm, '<h5 class="md-h5">$1</h5>');
  html = html.replace(/^ {0,3}#### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^ {0,3}### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^ {0,3}## (.+)$/gm, '<h2 class="md-h2">$1</h2>');
  html = html.replace(/^ {0,3}# (.+)$/gm, '<h1 class="md-h1">$1</h1>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="md-hr" />');

  // Blockquotes
  html = html.replace(
    /^&gt; (.+)$/gm,
    '<blockquote class="md-blockquote">$1</blockquote>'
  );

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li class="md-li">$1</li>');
  html = html.replace(/((?:<li class="md-li">.*<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-oli">$1</li>');
  html = html.replace(/((?:<li class="md-oli">.*<\/li>\n?)+)/g, '<ol class="md-ol">$1</ol>');

  // Inline formatting
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');

  // Restore fenced code blocks after all markdown transforms.
  codeBlocks.forEach((blockHtml, index) => {
    html = html.replaceAll(`@@MD_CODE_BLOCK_${index}@@`, blockHtml);
  });

  // Paragraphs: wrap lines that aren't already block elements
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (
        trimmed.startsWith("<h") ||
        trimmed.startsWith("<pre") ||
        trimmed.startsWith("<ul") ||
        trimmed.startsWith("<ol") ||
        trimmed.startsWith("<table") ||
        trimmed.startsWith("<blockquote") ||
        trimmed.startsWith("<hr") ||
        trimmed.startsWith("<img")
      ) {
        return trimmed;
      }
      return `<p class="md-p">${trimmed.replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");

  return html;
}

interface SimpleMarkdownProps {
  children: string;
  className?: string;
}

export function SimpleMarkdown({ children, className = "" }: SimpleMarkdownProps) {
  const html = renderMarkdown(children);

  return (
    <div
      className={`simple-markdown ${className}`.trim()}
      // biome-ignore lint: markdown rendering requires innerHTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
