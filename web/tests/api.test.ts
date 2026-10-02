import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  apiAll,
  apiRequest,
  login,
  setCsrfToken,
} from "../lib/api.ts";

test("登录使用用户名建立服务端会话，写请求带 Cookie 与 CSRF", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({
      data: {
        user: { username: "admin" },
        csrfToken: "test-csrf",
        permissions: [],
        expiresAt: "2026-10-04T00:00:00Z",
      },
    });
  };
  try {
    setCsrfToken(null);
    await login("admin", "test-password");
    await apiRequest("/streams/live%2Fcamera", {
      method: "PATCH",
      body: { record: false, maxReaders: 0 },
    });
    assert.deepEqual(JSON.parse(String(calls[0].options?.body)), {
      username: "admin",
      password: "test-password",
    });
    assert.equal(calls[0].options?.credentials, "same-origin");
    assert.equal(
      (calls[1].options?.headers as Record<string, string>)["X-CSRF-Token"],
      "test-csrf",
    );
    assert.deepEqual(JSON.parse(String(calls[1].options?.body)), {
      record: false,
      maxReaders: 0,
    });
    assert.equal(calls[1].url, "/api/v1/streams/live%2Fcamera");
    setCsrfToken(null);
    await assert.rejects(
      apiRequest("/streams/live", { method: "DELETE" }),
      (error: unknown) =>
        error instanceof ApiError && error.code === "CSRF_INVALID",
    );
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    setCsrfToken(null);
  }
});
test("完整列表跨页请求保留协议过滤并合并元数据", async () => {
  const urls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({
      data:
        urls.length === 1
          ? Array.from({ length: 200 }, (_, id) => ({ id }))
          : [{ id: 200 }],
      pagination: { page: urls.length, pageSize: 200, total: 201 },
      meta: { unavailableProtocols: ["hls"] },
    });
  };
  try {
    const response = await apiAll<{ id: number }>("/connections?protocol=rtsp");
    assert.equal(response.data.length, 201);
    assert.equal(response.data[200].id, 200);
    assert.deepEqual(response.meta?.unavailableProtocols, ["hls"]);
    assert.equal(
      urls[1],
      "/api/v1/connections?protocol=rtsp&page=2&pageSize=200",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("上游故障与登录错误保留服务端错误码，不伪造成功响应", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: "UPSTREAM_UNAVAILABLE", message: "internal details" } },
      { status: 502 },
    );
  try {
    await assert.rejects(
      apiRequest("/streams"),
      (error: unknown) =>
        error instanceof ApiError &&
        error.status === 502 &&
        error.message.includes("MediaMTX"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
