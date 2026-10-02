import type { PathConfig, PathPatch } from "./types.ts";

export type PathValues = Omit<PathConfig, "sourceHasCredentials">;
export const defaultPathValues: PathValues = {
  name: "",
  source: "publisher",
  sourceOnDemand: false,
  maxReaders: 0,
  record: false,
  recordFormat: "fmp4",
  recordSegmentDuration: "1h",
  recordDeleteAfter: "24h",
  overridePublisher: true,
};

export function durationSeconds(value: string): number | null {
  if (value === "0") return 0;
  const units: Record<string, number> = {
    ns: 1e-9,
    us: 1e-6,
    µs: 1e-6,
    μs: 1e-6,
    ms: 1e-3,
    s: 1,
    m: 60,
    h: 3600,
  };
  const tokens = [
    ...value.matchAll(/(\d+(?:\.\d*)?|\.\d+)(ns|us|µs|μs|ms|s|m|h)/g),
  ];
  if (!tokens.length || tokens.map((token) => token[0]).join("") !== value)
    return null;
  const seconds = tokens.reduce(
    (total, token) => total + Number(token[1]) * units[token[2]],
    0,
  );
  return Number.isFinite(seconds) ? seconds : null;
}

export function validatePath(
  values: PathValues,
  validateSource = true,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.name;
  if (
    !name ||
    new TextEncoder().encode(name).length > 256 ||
    name.trim() !== name ||
    /[\\?#%\u0000-\u001f\u007f]/.test(name) ||
    (name.startsWith("~")
      ? name.length === 1
      : name.split("/").some((part) => !part || part === "." || part === ".."))
  ) {
    errors.name =
      "请输入有效路径，例如 live/camera；不能包含空段、控制字符或保留字符";
  }
  if (validateSource && values.source !== "publisher") {
    try {
      const url = new URL(values.source);
      if (
        !url.hostname ||
        url.hash ||
        values.source.length > 2048 ||
        ![
          "rtsp:",
          "rtsps:",
          "rtmp:",
          "rtmps:",
          "http:",
          "https:",
          "srt:",
          "udp:",
          "whep:",
          "wheps:",
        ].includes(url.protocol)
      )
        throw new Error();
    } catch {
      errors.source = "来源需为 publisher 或受支持协议的完整地址";
    }
  }
  if (
    !Number.isInteger(values.maxReaders) ||
    values.maxReaders < 0 ||
    values.maxReaders > 1000000
  )
    errors.maxReaders = "请输入 0–1000000 的整数";
  if (!["fmp4", "mpegts"].includes(values.recordFormat))
    errors.recordFormat = "请选择有效录像格式";
  for (const key of ["recordSegmentDuration", "recordDeleteAfter"] as const) {
    const seconds = durationSeconds(values[key]);
    if (
      seconds === null ||
      seconds > 365 * 86400 ||
      (key === "recordSegmentDuration" && seconds <= 0)
    ) {
      errors[key] =
        key === "recordSegmentDuration"
          ? "请输入大于零的时长，例如 30s、1h，最多 8760h"
          : "请输入时长，例如 24h；0 表示不自动删除，最多 8760h";
    }
  }
  return errors;
}

// Preserve redacted sources unless the user explicitly supplies a replacement.
export function buildPathPatch(
  original: PathConfig | null,
  values: PathValues,
  replaceSource: boolean,
): PathPatch {
  const patch: PathPatch = {};
  const fields = [
    "sourceOnDemand",
    "maxReaders",
    "record",
    "recordFormat",
    "recordSegmentDuration",
    "recordDeleteAfter",
    "overridePublisher",
  ] as const;
  for (const key of fields) {
    if (!original || values[key] !== original[key])
      Object.assign(patch, { [key]: values[key] });
  }
  if (!original || replaceSource) patch.source = values.source;
  return patch;
}
