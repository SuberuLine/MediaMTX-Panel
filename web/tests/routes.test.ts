import assert from "node:assert/strict";
import test from "node:test";

import { validateLogin } from "../lib/auth.ts";
import { isDashboardSection, routes } from "../lib/routes.ts";

test("面板路由为概览生成短路径，并为子页面生成稳定路径", () => {
  assert.equal(routes.dashboardSection("overview"), "/dashboard");
  assert.equal(routes.dashboardSection("analytics"), "/dashboard/analytics");
});

test("只接受已规划的面板分区", () => {
  assert.equal(isDashboardSection("streams"), true);
  assert.equal(isDashboardSection("connections"), true);
  assert.equal(isDashboardSection("unknown"), false);
});

test("登录校验拒绝非法用户名与空密码", () => {
  assert.deepEqual(
    validateLogin({ username: "admin@example.com", password: "" }),
    {
      username: "用户名需为 3–64 个字母、数字、下划线、点或短横线",
      password: "请输入密码",
    },
  );
});

test("登录校验接受规范输入", () => {
  assert.deepEqual(
    validateLogin({ username: " admin ", password: "password123" }),
    {},
  );
});

test("登录允许服务器校验密码，不强加新密码长度规则", () => {
  assert.deepEqual(
    validateLogin({ username: "operator_1", password: "short" }),
    {},
  );
  assert.ok(
    validateLogin({ username: "admin", password: "密".repeat(400) }).password,
  );
});
