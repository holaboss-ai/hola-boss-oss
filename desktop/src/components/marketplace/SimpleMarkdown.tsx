/**
 * Markdown renderer shared by the marketplace README and workspace chat.
 * Uses react-markdown with GFM support while preserving the existing md-* CSS hooks.
 */

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

function createMarkdownComponents(onLinkClick?: ((url: string) => void) | undefined): Components {
  return {
  a({ className, ...props }) {
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
  blockquote({ className, ...props }) {
    return <blockquote {...props} className={appendClassName(className, "md-blockquote")} />;
  },
  h1({ className, ...props }) {
    return <h1 {...props} className={appendClassName(className, "md-h1")} />;
  },
  h2({ className, ...props }) {
    return <h2 {...props} className={appendClassName(className, "md-h2")} />;
  },
  h3({ className, ...props }) {
    return <h3 {...props} className={appendClassName(className, "md-h3")} />;
  },
  h4({ className, ...props }) {
    return <h4 {...props} className={appendClassName(className, "md-h4")} />;
  },
  h5({ className, ...props }) {
    return <h5 {...props} className={appendClassName(className, "md-h5")} />;
  },
  h6({ className, ...props }) {
    return <h6 {...props} className={appendClassName(className, "md-h6")} />;
  },
  hr({ className, ...props }) {
    return <hr {...props} className={appendClassName(className, "md-hr")} />;
  },
  img({ className, alt, ...props }) {
    return <img {...props} alt={alt ?? ""} className={appendClassName(className, "md-img")} loading="lazy" />;
  },
  li({ className, ...props }) {
    return <li {...props} className={appendClassName(className, "md-li md-oli")} />;
  },
  ol({ className, ...props }) {
    return <ol {...props} className={appendClassName(className, "md-ol")} />;
  },
  p({ className, ...props }) {
    return <p {...props} className={appendClassName(className, "md-p")} />;
  },
  pre({ className, ...props }) {
    return <pre {...props} className={appendClassName(className, "md-code-block")} />;
  },
  table({ className, ...props }) {
    return <table {...props} className={appendClassName(className, "md-table")} />;
  },
  td({ className, ...props }) {
    return <td {...props} className={appendClassName(className, "md-table-cell")} />;
  },
  th({ className, ...props }) {
    return <th {...props} className={appendClassName(className, "md-table-head-cell")} />;
  },
  ul({ className, ...props }) {
    return <ul {...props} className={appendClassName(className, "md-ul")} />;
  },
  code({ className, ...props }) {
    return <code {...props} className={appendClassName(className, "md-inline-code")} />;
  }
  };
}

interface SimpleMarkdownProps {
  children: string;
  className?: string;
  onLinkClick?: (url: string) => void;
}

export function SimpleMarkdown({ children, className = "", onLinkClick }: SimpleMarkdownProps) {
  const components = createMarkdownComponents(onLinkClick);

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
