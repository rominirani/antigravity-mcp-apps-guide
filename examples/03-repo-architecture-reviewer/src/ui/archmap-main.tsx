import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArchmapViewer } from "./ArchmapViewer";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ArchmapViewer />
  </StrictMode>
);
