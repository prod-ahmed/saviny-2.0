"use client";

import dynamic from "next/dynamic";
import { StrictMode, useEffect } from "react";

/** The screens run in the browser only: they need the session, the socket and the router. */
const SavinyApp = dynamic(() => import("../../client/app/App"), { ssr: false });

export default function Spa() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* the app works without offline support */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return (
    <StrictMode>
      <SavinyApp />
    </StrictMode>
  );
}
