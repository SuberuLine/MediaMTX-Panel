"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, X } from "lucide-react";
import {
  ApiError,
  apiRequest,
  errorMessage,
  restoreSession,
  sessionExpiredEvent,
  setCsrfToken,
} from "@/lib/api";
import type { Metrics, Session, TrafficPoint } from "@/lib/types";

type Preferences = { refreshInterval: number; pageSize: number };
type PanelContext = {
  session: Session | null;
  sessionLoading: boolean;
  sessionError: string | null;
  acceptSession: (session: Session) => void;
  reloadSession: () => void;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  preferences: Preferences;
  savePreferences: (value: Preferences) => boolean;
  refreshVersion: number;
  refresh: () => void;
  toast: (message: string) => void;
  history: TrafficPoint[];
  recordTraffic: (metrics: Metrics) => void;
};
const Context = createContext<PanelContext | null>(null);
const defaults: Preferences = { refreshInterval: 5000, pageSize: 20 };

export function PanelProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const [preferences, setPreferences] = useState(defaults);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [notification, setNotification] = useState<string | null>(null);
  const [history, setHistory] = useState<TrafficPoint[]>([]);
  const lastTrafficKey = useRef("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    const controller = new AbortController();
    setSessionLoading(true);
    setSessionError(null);
    restoreSession(controller.signal)
      .then(setSession)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) setSession(null);
        else setSessionError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionLoading(false);
      });
    return () => controller.abort();
  }, [sessionVersion]);

  useEffect(() => {
    function expire() {
      setSession(null);
      setCsrfToken(null);
      setHistory([]);
      lastTrafficKey.current = "";
    }
    window.addEventListener(sessionExpiredEvent, expire);
    return () => window.removeEventListener(sessionExpiredEvent, expire);
  }, []);

  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    function scheduleExpiry() {
      const remaining = Date.parse(session!.expiresAt) - Date.now();
      if (remaining <= 0) window.dispatchEvent(new Event(sessionExpiredEvent));
      else timer = setTimeout(scheduleExpiry, Math.min(remaining, 2147483647));
    }
    scheduleExpiry();
    return () => clearTimeout(timer);
  }, [session]);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("mtxui:preferences") ?? "null",
      );
      if (
        saved &&
        [0, 5000, 10000, 30000].includes(saved.refreshInterval) &&
        [20, 50, 100].includes(saved.pageSize)
      )
        setPreferences(saved);
    } catch {
      /* Use defaults when browser storage is unavailable. */
    }
    return () => clearTimeout(toastTimer.current);
  }, []);

  const refresh = useCallback(
    () => setRefreshVersion((version) => version + 1),
    [],
  );
  const toast = useCallback((message: string) => {
    clearTimeout(toastTimer.current);
    setNotification(message);
    toastTimer.current = setTimeout(() => setNotification(null), 4500);
  }, []);
  const recordTraffic = useCallback((metrics: Metrics) => {
    if (!metrics.sampledAt) return;
    const key = `${metrics.sampledAt}:${metrics.stale}`;
    if (key === lastTrafficKey.current) return;
    lastTrafficKey.current = key;
    const point: TrafficPoint = {
      at: metrics.stale ? new Date().toISOString() : metrics.sampledAt,
      inBitrate: metrics.stale ? null : metrics.inBitrate,
      outBitrate: metrics.stale ? null : metrics.outBitrate,
    };
    setHistory((points) => {
      if (
        points.length &&
        Date.parse(points[points.length - 1].at) >= Date.parse(point.at)
      )
        return points;
      return [...points, point].slice(-180);
    });
  }, []);

  function acceptSession(value: Session) {
    setCsrfToken(value.csrfToken);
    setSession(value);
    setSessionLoading(false);
    setSessionError(null);
    setHistory([]);
    lastTrafficKey.current = "";
  }
  async function logout() {
    await apiRequest("/auth/logout", { method: "POST" });
    setCsrfToken(null);
    setSession(null);
    setHistory([]);
    lastTrafficKey.current = "";
  }
  function savePreferences(value: Preferences) {
    setPreferences(value);
    try {
      localStorage.setItem("mtxui:preferences", JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  return (
    <Context.Provider
      value={{
        session,
        sessionLoading,
        sessionError,
        acceptSession,
        reloadSession: () => setSessionVersion((version) => version + 1),
        logout,
        can: (permission) => Boolean(session?.permissions.includes(permission)),
        preferences,
        savePreferences,
        refreshVersion,
        refresh,
        toast,
        history,
        recordTraffic,
      }}
    >
      {children}
      {notification && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-[80] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-[#4a9d9a]/20 bg-white px-5 py-4 text-sm text-gray-700 shadow-2xl shadow-black/10"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[#4a9d9a]" />
          <span>{notification}</span>
          <button
            aria-label="关闭提示"
            onClick={() => setNotification(null)}
            className="rounded-lg p-1 text-gray-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}

export function usePanel() {
  const context = useContext(Context);
  if (!context) throw new Error("PanelProvider is required");
  return context;
}
