import { Component, ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: ""
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "Unknown renderer error"
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="flex h-full w-full items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-xl rounded-xl border border-primary/40 bg-muted/90 p-5 shadow-md">
          <h1 className="mb-2 text-lg font-semibold text-primary">Renderer Error</h1>
          <p className="text-sm text-muted-foreground/85">
            A component crashed. Check terminal logs for the stack trace and restart the app.
          </p>
          <pre className="mt-3 overflow-auto rounded-lg border border-primary/20 bg-black/40 p-3 text-xs text-foreground/80">
            {this.state.message}
          </pre>
        </div>
      </main>
    );
  }
}
