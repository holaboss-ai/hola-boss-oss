import * as Sentry from "@sentry/electron/renderer";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import {
  enrichRendererSentryEvent,
  pushRendererSentryActivity,
} from "./lib/rendererSentry";

Sentry.init({
  enableLogs: true,
  maxBreadcrumbs: 200,
  integrations: [
    Sentry.consoleLoggingIntegration({
      levels: ["warn", "error"],
    }),
    Sentry.eventLoopBlockIntegration({
      threshold: 2000,
    }),
  ],
  beforeSend(event, hint) {
    return enrichRendererSentryEvent(event, hint);
  },
});
Sentry.setTag("process_kind", "electron_renderer");
pushRendererSentryActivity("lifecycle", "renderer initialized", {
  pathname: window.location.pathname,
  search: window.location.search,
});
window.addEventListener("online", () => {
  pushRendererSentryActivity("connectivity", "renderer went online", {
    online: true,
  });
});
window.addEventListener("offline", () => {
  pushRendererSentryActivity("connectivity", "renderer went offline", {
    online: false,
  });
});
document.addEventListener("visibilitychange", () => {
  pushRendererSentryActivity("visibility", "renderer visibility changed", {
    visibility_state: document.visibilityState,
    focused: document.hasFocus(),
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
