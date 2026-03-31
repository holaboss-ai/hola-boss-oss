export function marketplaceGalleryBranding(mode: "browse" | "pick") {
  if (mode === "pick") {
    return {
      eyebrow: "Welcome",
      title: "Pick a kit to get started",
      description: "Choose a workspace template, or start from scratch.",
      showLogo: true,
    };
  }

  return {
    eyebrow: "Marketplace",
    title: "Explore kits",
    description: "",
    showLogo: false,
  };
}
