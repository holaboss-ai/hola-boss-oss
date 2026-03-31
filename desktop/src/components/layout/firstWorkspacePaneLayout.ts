type FirstWorkspacePaneStep = "gallery" | "detail" | "configure";

export function firstWorkspacePaneSectionClassName(
  step: FirstWorkspacePaneStep,
): string {
  return [
    "relative",
    "h-full",
    "min-h-0",
    "min-w-0",
    "overflow-auto",
    "px-3",
    "py-3",
    "sm:px-4",
    "sm:py-4",
    "grid place-items-center",
  ].join(" ");
}
