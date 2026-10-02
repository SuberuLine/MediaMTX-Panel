import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPathPatch,
  defaultPathValues,
  durationSeconds,
  validatePath,
} from "../lib/path-config.ts";
import type { PathConfig } from "../lib/types.ts";
import { csvCell } from "../lib/format.ts";

const original: PathConfig = {
  ...defaultPathValues,
  name: "live/camera",
  source: "rtsp://camera/live",
  sourceHasCredentials: true,
  record: true,
  maxReaders: 10,
};

test("编辑普通字段时不回写脱敏的来源，同时保留 false 和 0", () => {
  assert.deepEqual(
    buildPathPatch(
      original,
      { ...original, record: false, maxReaders: 0 },
      false,
    ),
    { record: false, maxReaders: 0 },
  );
  assert.deepEqual(buildPathPatch(original, original, false), {});
  assert.deepEqual(
    buildPathPatch(
      original,
      { ...original, source: "rtsp://user:secret@camera/live?token=new" },
      true,
    ),
    { source: "rtsp://user:secret@camera/live?token=new" },
  );
});
test("路径校验支持嵌套名称并拒绝空段、保留字符与过长字节", () => {
  assert.deepEqual(
    validatePath({ ...defaultPathValues, name: "live/camera" }),
    {},
  );
  for (const name of [
    "live//camera",
    "../camera",
    "live%2Fcamera",
    "live?camera",
    "相".repeat(100),
  ])
    assert.ok(validatePath({ ...defaultPathValues, name }).name);
});
test("时长使用 Go 的单位与组合，不将天数输入误认为有效", () => {
  assert.equal(durationSeconds("1h30m"), 5400);
  assert.equal(durationSeconds("0.5s"), 0.5);
  assert.equal(durationSeconds("0"), 0);
  for (const value of ["1d", "-1h", "1h ", "infinity", ""])
    assert.equal(durationSeconds(value), null);
  assert.ok(
    validatePath({
      ...defaultPathValues,
      name: "live",
      recordSegmentDuration: "0",
    }).recordSegmentDuration,
  );
  assert.deepEqual(
    validatePath({
      ...defaultPathValues,
      name: "live",
      recordDeleteAfter: "0",
    }),
    {},
  );
});
test("保留现有来源时无需对脱敏的空地址进行验证", () => {
  assert.deepEqual(
    validatePath({ ...defaultPathValues, name: "live", source: "" }, false),
    {},
  );
  assert.ok(
    validatePath({
      ...defaultPathValues,
      name: "live",
      source: "javascript:alert(1)",
    }).source,
  );
});
test("CSV 导出正确转义引号并阻止单元格公式执行", () => {
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("=HYPERLINK(1)"), '"\'=HYPERLINK(1)"');
  assert.equal(csvCell("  +SUM(1)"), '"\'  +SUM(1)"');
});
