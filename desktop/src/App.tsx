import { AppShell } from "@/components/layout/AppShell";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";

function App() {
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <AppShell />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
