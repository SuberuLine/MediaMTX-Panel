"use client";

import { useCallback, useEffect, useState } from "react";
import { apiAll, apiRequest, errorMessage } from "@/lib/api";
import { usePanel } from "@/components/panel-provider";
import type { ApiResponse } from "@/lib/types";

export function useResource<T>(
  path: string | null,
  interval = 0,
  allPages = false,
) {
  const { refreshVersion, session } = usePanel();
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{
    path: string | null;
    response?: ApiResponse<T>;
    loading: boolean;
    error: string | null;
  }>({ path, loading: Boolean(path), error: null });
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!path || !session) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    async function load() {
      if (running || controller.signal.aborted) return;
      running = true;
      clearTimeout(timer);
      setState((current) => ({
        path,
        response: current.path === path ? current.response : undefined,
        loading: true,
        error: current.path === path ? current.error : null,
      }));
      try {
        const response = allPages
          ? ((await apiAll(path!, controller.signal)) as ApiResponse<T>)
          : await apiRequest<T>(path!, { signal: controller.signal });
        if (!controller.signal.aborted)
          setState({ path, response, loading: false, error: null });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((current) => ({
            ...current,
            loading: false,
            error: errorMessage(error),
          }));
      } finally {
        running = false;
        if (!controller.signal.aborted && interval > 0)
          timer = setTimeout(poll, interval);
      }
    }
    function poll() {
      if (document.visibilityState === "hidden")
        timer = setTimeout(poll, interval);
      else void load();
    }
    function visible() {
      if (document.visibilityState === "visible" && interval > 0) void load();
    }
    void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [path, interval, allPages, version, refreshVersion, session]);

  const current =
    state.path === path
      ? state
      : { response: undefined, loading: Boolean(path), error: null };
  return {
    data: path ? current.response?.data : undefined,
    pagination: current.response?.pagination,
    meta: current.response?.meta,
    loading: path ? current.loading : false,
    error: path ? current.error : null,
    reload,
  };
}
