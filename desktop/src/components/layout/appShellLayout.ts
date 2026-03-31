export function appShellMainGridClassName({
  hasWorkspaces,
  isMacDesktop,
}: {
  hasWorkspaces: boolean;
  isMacDesktop: boolean;
}): string {
  return [
    "relative",
    "z-10",
    "grid",
    "h-full",
    "w-full",
    hasWorkspaces
      ? "grid-rows-[auto_minmax(0,1fr)]"
      : "grid-rows-[minmax(0,1fr)]",
    "gap-2",
    "p-2",
    isMacDesktop ? "sm:gap-2.5 sm:px-3 sm:pb-3 sm:pt-2.5" : "sm:gap-3 sm:p-3",
  ].join(" ");
}
