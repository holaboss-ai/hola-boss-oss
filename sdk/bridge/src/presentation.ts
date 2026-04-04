import type { AppOutputPresentationInput } from "./types"

/**
 * Builds the presentation object used for app resources.
 *
 * Use it when the workspace UI should open a resource in a
 * predictable view and path.
 */
export function buildAppResourcePresentation({
  view,
  path,
}: AppOutputPresentationInput) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return {
    kind: "app_resource" as const,
    view,
    path: normalizedPath,
  }
}
