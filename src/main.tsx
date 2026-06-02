import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SlideshowApp } from "./components/SlideshowApp";

const isSlideshow = window.location.hash.replace(/^#/, "") === "slideshow";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isSlideshow ? <SlideshowApp /> : <App />}</React.StrictMode>,
);
