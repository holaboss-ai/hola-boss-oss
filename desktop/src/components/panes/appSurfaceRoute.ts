interface AppSurfaceRouteInput {
  resourceId?: string | null;
  view?: string | null;
}

function normalizedViewSegment(view?: string | null): string {
  return (view || "").trim().toLowerCase();
}

function encodedPathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

export function resolveAppSurfacePath({
  resourceId,
  view,
}: AppSurfaceRouteInput): string {
  const normalizedView = normalizedViewSegment(view);
  const normalizedResourceId = (resourceId || "").trim();

  if (!normalizedResourceId) {
    if (!normalizedView || normalizedView === "home") {
      return "/";
    }
    return `/${encodedPathSegment(normalizedView)}`;
  }

  if (!normalizedView || normalizedView === "home") {
    return `/posts/${encodedPathSegment(normalizedResourceId)}`;
  }

  return `/${encodedPathSegment(normalizedView)}/${encodedPathSegment(normalizedResourceId)}`;
}
