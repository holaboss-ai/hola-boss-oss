/**
 * Markdown renderer shared by the marketplace README and workspace chat.
 * Uses react-markdown with GFM support while preserving the existing md-* CSS hooks.
 */

import { memo, useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function appendClassName(current: string | undefined, next: string): string {
  return current ? `${current} ${next}` : next;
}

function normalizeHttpUrl(rawHref: string | null | undefined): string | null {
  const trimmed = (rawHref ?? "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

import type { ExtraProps } from "react-markdown";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MdProps = any;

function createMarkdownComponents(onLinkClick?: ((url: string) => void) | undefined): Components {
  return {
  a({ className, ...props }: MdProps) {
    const normalizedHref = normalizeHttpUrl(typeof props.href === "string" ? props.href : null);
    const upstreamOnClick = props.onClick;
    return (
      <a
        {...props}
        className={appendClassName(className, "md-link")}
        onClick={(event) => {
          upstreamOnClick?.(event);
          if (event.defaultPrevented || !onLinkClick || !normalizedHref) {
            return;
          }
          event.preventDefault();
          onLinkClick(normalizedHref);
        }}
        rel="noopener noreferrer"
        target="_blank"
      />
    );
  },
  blockquote({ className, ...props }: MdProps) {
    return <blockquote {...props} className={appendClassName(className, "md-blockquote")} />;
  },
  h1({ className, ...props }: MdProps) {
    return <h1 {...props} className={appendClassName(className, "md-h1")} />;
  },
  h2({ className, ...props }: MdProps) {
    return <h2 {...props} className={appendClassName(className, "md-h2")} />;
  },
  h3({ className, ...props }: MdProps) {
    return <h3 {...props} className={appendClassName(className, "md-h3")} />;
  },
  h4({ className, ...props }: MdProps) {
    return <h4 {...props} className={appendClassName(className, "md-h4")} />;
  },
  h5({ className, ...props }: MdProps) {
    return <h5 {...props} className={appendClassName(className, "md-h5")} />;
  },
  h6({ className, ...props }: MdProps) {
    return <h6 {...props} className={appendClassName(className, "md-h6")} />;
  },
  hr({ className, ...props }: MdProps) {
    return <hr {...props} className={appendClassName(className, "md-hr")} />;
  },
  img({ className, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
    return <img {...props} alt={alt ?? ""} className={appendClassName(className, "md-img")} loading="lazy" />;
  },
  li({ className, ...props }: MdProps) {
    return <li {...props} className={appendClassName(className, "md-li md-oli")} />;
  },
  ol({ className, ...props }: MdProps) {
    return <ol {...props} className={appendClassName(className, "md-ol")} />;
  },
  p({ className, ...props }: MdProps) {
    return <p {...props} className={appendClassName(className, "md-p")} />;
  },
  pre({ className, ...props }: MdProps) {
    return <pre {...props} className={appendClassName(className, "md-code-block")} />;
  },
  table({ className, ...props }: MdProps) {
    return <table {...props} className={appendClassName(className, "md-table")} />;
  },
  td({ className, ...props }: MdProps) {
    return <td {...props} className={appendClassName(className, "md-table-cell")} />;
  },
  th({ className, ...props }: MdProps) {
    return <th {...props} className={appendClassName(className, "md-table-head-cell")} />;
  },
  ul({ className, ...props }: MdProps) {
    return <ul {...props} className={appendClassName(className, "md-ul")} />;
  },
  code({ className, ...props }: MdProps) {
    return <code {...props} className={appendClassName(className, "md-inline-code")} />;
  }
  };
}

interface SimpleMarkdownProps {
  children: string;
  className?: string;
  onLinkClick?: (url: string) => void;
}

function SimpleMarkdownComponent({
  children,
  className = "",
  onLinkClick,
}: SimpleMarkdownProps) {
  const components = useMemo(
    () => createMarkdownComponents(onLinkClick),
    [onLinkClick],
  );

  return (
    <div className={`simple-markdown ${className}`.trim()}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={defaultUrlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const SimpleMarkdown = memo(SimpleMarkdownComponent);
