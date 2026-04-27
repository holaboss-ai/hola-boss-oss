import { useLayoutEffect } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";

function App() {
  // Remove the pre-React splash element from index.html now that React
  // has committed its first render. useLayoutEffect runs synchronously
  // after the commit and before the browser paints, so the React tree
  // (which itself shows WorkspaceBootstrapPane during workspace
  // hydration) is on screen by the time the static splash disappears —
  // no flash.
  useLayoutEffect(() => {
    document.getElementById("boot-splash")?.remove();
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <AppShell />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
