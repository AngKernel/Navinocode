import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { initializeWorkspaceStore } from "./advanced/storage.js";
import WorkspaceErrorBoundary from "./advanced/WorkspaceErrorBoundary.jsx";
import "./index.css";
import "../github.css";

try { initializeWorkspaceStore(); } catch (error) { console.error("Workspace initialization failed", error); }

ReactDOM.createRoot(document.getElementById("root")).render(
    <WorkspaceErrorBoundary><App /></WorkspaceErrorBoundary>
);
