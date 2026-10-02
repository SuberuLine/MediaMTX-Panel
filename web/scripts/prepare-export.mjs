import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Keep the Go server's script-src 'self' policy: Next's static hydration payloads
// become content-addressed same-origin scripts, preserving document order.
export async function prepareExport(directory) {
  let pages = 0;
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.name.endsWith(".html")) continue;
      let html = await readFile(path, "utf8");
      const replacements = [];
      for (const match of html.matchAll(
        /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      )) {
        const [, attributes, source] = match;
        if (
          /\bsrc\s*=/.test(attributes) ||
          !source.trim() ||
          /\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attributes)
        )
          continue;
        const name = createHash("sha256").update(source).digest("hex") + ".js";
        const scriptPath = join(directory, "_next", "static", "panel", name);
        await mkdir(dirname(scriptPath), { recursive: true });
        await writeFile(scriptPath, source);
        replacements.push([
          match[0],
          "<script" +
            attributes +
            ' src="/_next/static/panel/' +
            name +
            '"></script>',
        ]);
      }
      for (const [before, after] of replacements)
        html = html.replace(before, after);
      await writeFile(path, html);
      pages++;
    }
  }
  await visit(resolve(directory));
  return pages;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pages = await prepareExport(process.argv[2] ?? "out");
  console.log("Prepared " + pages + " static pages for the panel CSP.");
}
