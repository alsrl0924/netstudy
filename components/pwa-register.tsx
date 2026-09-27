"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      );
      return;
    }

    navigator.serviceWorker
      .register("./sw.js", { updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        // The site remains fully usable online when service-worker registration fails.
      });
  }, []);

  return null;
}
