import assert from "node:assert/strict";
import test from "node:test";

import { cn } from "../lib/utils.ts";

test("shadcn/ui 类名工具保留条件类并消解 Tailwind 冲突", () => {
  assert.equal(
    cn("rounded-lg bg-white", false, "bg-[#4a9d9a]"),
    "rounded-lg bg-[#4a9d9a]",
  );
});
