import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";
import MultiplayerApp from "./MultiplayerApp";

function Root() {
  const [multiplayer, setMultiplayer] = useState(() => window.location.hash === "#/multiplayer");

  useEffect(() => {
    const syncRoute = () => setMultiplayer(window.location.hash === "#/multiplayer");
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  return multiplayer ? <MultiplayerApp /> : <Home />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
