import type { ApiResponse, Session } from "./types.ts";

let csrfToken: string | null = null;
export const sessionExpiredEvent = "mtxui:session-expired";
export function setCsrfToken(value: string | null) {
  csrfToken = value;
}

const messages: Record<string, string> = {
  INVALID_CREDENTIALS: "用户名或密码不正确",
  UNAUTHENTICATED: "登录已过期，请重新登录",
  FORBIDDEN: "当前账号没有执行此操作的权限",
  CSRF_INVALID: "会话验证已失效，请刷新页面后重试",
  ORIGIN_REJECTED: "请求来源未通过验证，请通过面板地址访问",
  RATE_LIMITED: "登录尝试过于频繁，请稍后再试",
  UPSTREAM_UNAVAILABLE: "无法连接 MediaMTX，请检查服务状态后重试",
  NOT_READY: "服务尚未就绪，请稍后重试",
  VALIDATION_ERROR: "填写的内容不符合要求，请检查路径、来源和时长",
  CONFIG_REJECTED: "MediaMTX 未接受此配置，请检查来源和配置参数",
  RESOURCE_CONFLICT: "路径已存在或配置有冲突",
  STREAM_NOT_FOUND: "流已不存在，请刷新列表",
  PATH_NOT_FOUND: "路径配置已不存在，请刷新列表",
  CONNECTION_NOT_FOUND: "连接已结束，请刷新列表",
  PROTOCOL_UNAVAILABLE: "此实例未启用该协议",
  INTERNAL_ERROR: "服务处理失败。操作可能已生效，请刷新状态后确认",
};

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(messages[code] ?? message ?? "请求失败，请稍后重试");
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.name === "TimeoutError")
    return "请求超时，请检查服务连接后重试";
  return "无法连接面板服务，请检查连接后重试";
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<ApiResponse<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && path !== "/auth/login") {
    if (!csrfToken) throw new ApiError(403, "CSRF_INVALID");
    headers["X-CSRF-Token"] = csrfToken;
  }
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.error?.code ?? "REQUEST_FAILED";
    if (response.status === 401 && path !== "/auth/login") {
      setCsrfToken(null);
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event(sessionExpiredEvent));
    }
    throw new ApiError(response.status, code);
  }
  if (!payload || !("data" in payload))
    throw new ApiError(502, "INVALID_RESPONSE", "服务返回了无效响应");
  return payload as ApiResponse<T>;
}

// Filter complete collections: the backend does not provide text search on paths.
export async function apiAll<T>(
  path: string,
  signal?: AbortSignal,
): Promise<ApiResponse<T[]>> {
  const separator = path.includes("?") ? "&" : "?";
  const first = await apiRequest<T[]>(
    `${path}${separator}page=1&pageSize=200`,
    { signal },
  );
  if (!Array.isArray(first.data) || !first.pagination)
    throw new ApiError(502, "INVALID_RESPONSE");
  const items = [...first.data];
  const pages = Math.ceil(first.pagination.total / 200);
  for (let page = 2; page <= pages; page++) {
    const next = await apiRequest<T[]>(
      `${path}${separator}page=${page}&pageSize=200`,
      { signal },
    );
    items.push(...next.data);
  }
  return {
    ...first,
    data: items,
    pagination: { page: 1, pageSize: items.length, total: items.length },
  };
}

export async function restoreSession(signal?: AbortSignal) {
  const { data } = await apiRequest<Session>("/auth/me", { signal });
  setCsrfToken(data.csrfToken);
  return data;
}

export async function login(username: string, password: string) {
  const { data } = await apiRequest<Session>("/auth/login", {
    method: "POST",
    body: { username, password },
  });
  setCsrfToken(data.csrfToken);
  return data;
}
