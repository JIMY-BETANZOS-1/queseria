import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Inter autohospedada: sus .woff2 salen en /assets (mismo origen); unicode-range hace que solo se baje el latín
import "@fontsource-variable/inter/wght.css";

import App from "./App";
import "./estilos.css";

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
