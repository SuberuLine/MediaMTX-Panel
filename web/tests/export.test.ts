import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareExport } from "../scripts/prepare-export.mjs";

test("静态导出外置可执行脚本并保持顺序，适配严格的同源 CSP", async () => {
  const root = await mkdtemp(join(tmpdir(), "mtxui-export-"));
  try {
    const file = join(root, "index.html");
    await writeFile(
      file,
      '<html><script src="/existing.js"></script><script>self.queue=[];</script><script id="payload">self.queue.push("中文");</script><script type="application/json">{"value":1}</script></html>',
    );
    assert.equal(await prepareExport(root), 1);
    const html = await readFile(file, "utf8");
    const scripts = [
      ...html.matchAll(/src="(\/_next\/static\/panel\/[^" ]+)"/g),
    ];
    assert.equal(scripts.length, 2);
    assert.equal(
      await readFile(join(root, scripts[0][1]), "utf8"),
      "self.queue=[];",
    );
    assert.equal(
      await readFile(join(root, scripts[1][1]), "utf8"),
      'self.queue.push("中文");',
    );
    assert.ok(html.includes('<script id="payload" src="'));
    assert.ok(
      html.includes('<script type="application/json">{"value":1}</script>'),
    );
    await prepareExport(root);
    assert.equal(await readFile(file, "utf8"), html);
    assert.equal((await readdir(join(root, "_next/static/panel"))).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
