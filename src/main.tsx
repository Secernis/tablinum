import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * Set the theme before the first frame.
 *
 * theme.css defines its tokens under [data-theme="light"] and
 * [data-theme="dark"]. Without the attribute neither rule applies and the app
 * would render without colours. This happens here rather than in a component
 * because a useEffect only runs after the first paint — the app would visibly
 * jump.
 */
const stored = (() => {
  try {
    return localStorage.getItem("tablinum-theme");
  } catch {
    return null; // private window, or site data blocked
  }
})();
const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
document.documentElement.dataset.theme = stored ?? system;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
