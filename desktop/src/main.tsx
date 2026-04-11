import * as Sentry from "@sentry/electron/renderer";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

Sentry.init();

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
