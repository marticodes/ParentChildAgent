import React from "react";
import AgentChat from "./AgentChat";
import DeveloperDashboard from "./pages/DeveloperDashboard";
import ChildEvaluation from "./pages/ChildEvaluation";
import ParentEvaluation from "./pages/ParentEvaluation";

export default function App() {
  const path = window.location.pathname;

  // Existing AI mediator: preserve its original routes.
  if (path === "/child" || path === "/parent" || path === "/") {
    return <AgentChat />;
  }

  // New content evaluation module.
  if (path === "/evaluation/developer") {
    return <DeveloperDashboard />;
  }

  if (path === "/evaluation/child") {
    return <ChildEvaluation />;
  }

  if (path === "/evaluation/parent") {
    return <ParentEvaluation />;
  }

  return (
    <main style={{ padding: 40 }}>
      <h1>Page not found</h1>
      <a href="/child">Return to AI mediator</a>
    </main>
  );
}
