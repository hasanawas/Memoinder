"use client";

import { useCallback, useEffect, useState } from "react";

// Loads data in the browser and lets the page reload it after a change.
export function useLoad<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => !cancelled && setState({ data, loading: false }),
      (e: unknown) => !cancelled && setState({ error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      cancelled = true;
    };
    // `load` is re-created on every render; `version` is the reload signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}
