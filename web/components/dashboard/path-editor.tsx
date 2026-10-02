"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiRequest, errorMessage } from "@/lib/api";
import {
  buildPathPatch,
  defaultPathValues,
  validatePath,
  type PathValues,
} from "@/lib/path-config";
import { useResource } from "@/lib/use-resource";
import type { PathConfig } from "@/lib/types";
import { usePanel } from "@/components/panel-provider";
import { EmptyState, ErrorNotice, Modal, selectClassName } from "./panel-ui";

export function PathEditor({
  name,
  endpoint = "/streams",
  onClose,
}: {
  name: string | null;
  endpoint?: "/streams" | "/config/paths";
  onClose: () => void;
}) {
  const { data, error, loading, reload } = useResource<PathConfig>(
    name ? "/config/paths/" + encodeURIComponent(name) : null,
  );
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={name ? "编辑路径配置" : "新建流路径"}
      description={name ?? "配置媒体来源、读取限制与录像选项"}
      busy={busy}
      onClose={onClose}
    >
      <ErrorNotice message={error} onRetry={reload} />
      {name && !data ? (
        <EmptyState loading={loading} title="无法读取路径配置" />
      ) : (
        <PathForm
          original={data ?? null}
          endpoint={endpoint}
          onClose={onClose}
          busy={busy}
          onBusyChange={setBusy}
        />
      )}
    </Modal>
  );
}

function Field({
  name,
  label,
  hint,
  error,
  children,
}: {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={"path-" + name}
        className="mb-2 block text-sm font-medium text-gray-700"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p
          id={"path-" + name + "-error"}
          role="alert"
          className="mt-2 text-xs text-[#a45c4e]"
        >
          {error}
        </p>
      ) : (
        hint && <p className="mt-2 text-xs leading-5 text-gray-400">{hint}</p>
      )}
    </div>
  );
}

function PathForm({
  original,
  endpoint,
  onClose,
  busy,
  onBusyChange,
}: {
  original: PathConfig | null;
  endpoint: string;
  onClose: () => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { toast, refresh } = usePanel();
  const [values, setValues] = useState<PathValues>(
    original ?? defaultPathValues,
  );
  const [replaceSource, setReplaceSource] = useState(!original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const patch = buildPathPatch(original, values, replaceSource);
  function set<K extends keyof PathValues>(key: K, value: PathValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const invalid = validatePath(values, replaceSource);
    // Existing upstream values can exceed our write limits. Validate only the
    // fields being submitted, so unrelated edits preserve those settings.
    if (original)
      for (const key of Object.keys(invalid))
        if (!(key in patch)) delete invalid[key];
    setErrors(invalid);
    setError(null);
    if (Object.keys(invalid).length || !Object.keys(patch).length) return;
    onBusyChange(true);
    try {
      await apiRequest(
        original
          ? endpoint + "/" + encodeURIComponent(original.name)
          : endpoint,
        {
          method: original ? "PATCH" : "POST",
          body: original ? patch : { name: values.name, ...patch },
        },
      );
      toast(original ? "路径配置已保存" : "流路径已创建");
      refresh();
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      onBusyChange(false);
    }
  }
  function inputProps(name: keyof PathValues) {
    return {
      id: "path-" + name,
      "aria-invalid": Boolean(errors[name]),
      "aria-describedby": errors[name] ? "path-" + name + "-error" : undefined,
    };
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <ErrorNotice message={error} />
      <fieldset disabled={busy} className="space-y-5">
        <Field
          name="name"
          label="路径名称"
          hint="支持嵌套路径，例如 live/camera。创建后名称不可修改。"
          error={errors.name}
        >
          <Input
            {...inputProps("name")}
            value={values.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="live/camera"
            disabled={Boolean(original)}
            data-autofocus={!original ? true : undefined}
          />
        </Field>
        <Field
          name="source"
          label="媒体来源"
          hint="publisher 接受推流；也可填写 RTSP、RTMP、HLS、SRT 等完整来源地址。"
          error={errors.source}
        >
          {original && (
            <label className="mb-3 flex items-center gap-3 text-xs text-gray-500">
              <Switch
                checked={replaceSource}
                onCheckedChange={(enabled) => {
                  setReplaceSource(enabled);
                  if (enabled && original.sourceHasCredentials)
                    set("source", "");
                  else set("source", original.source);
                }}
              />
              更换媒体来源
            </label>
          )}
          <Input
            {...inputProps("source")}
            value={values.source}
            onChange={(event) => set("source", event.target.value)}
            disabled={!replaceSource}
            autoComplete="off"
            placeholder="publisher 或 rtsp://host/live"
          />
          {original?.sourceHasCredentials && (
            <p className="mt-2 rounded-lg bg-[#e8b86d]/10 px-3 py-2 text-xs leading-5 text-[#9b7840]">
              当前来源的凭据已隐藏。保留来源无需输入；更换时请填写完整地址。
            </p>
          )}
        </Field>
        <Field
          name="maxReaders"
          label="最大读取者数"
          hint="0 表示不限制。路径读取者可能包含 HLS 转封装器。"
          error={errors.maxReaders}
        >
          <Input
            {...inputProps("maxReaders")}
            type="number"
            min={0}
            max={1000000}
            step={1}
            value={Number.isNaN(values.maxReaders) ? "" : values.maxReaders}
            onChange={(event) =>
              set(
                "maxReaders",
                event.target.value === "" ? NaN : Number(event.target.value),
              )
            }
          />
        </Field>
        <div className="space-y-4 rounded-xl bg-[#faf8f5] p-4">
          {(
            [
              ["sourceOnDemand", "按需拉取", "出现读取者时才连接外部媒体来源"],
              [
                "overridePublisher",
                "允许覆盖发布者",
                "新的发布连接可以替换已有发布者",
              ],
              ["record", "启用录像", "按下方选项录制此路径的媒体"],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <label
                  htmlFor={"path-" + key}
                  className="text-sm font-medium text-gray-700"
                >
                  {label}
                </label>
                <p className="mt-1 text-xs text-gray-400">{hint}</p>
              </div>
              <Switch
                id={"path-" + key}
                checked={values[key]}
                onCheckedChange={(value) => set(key, value)}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            name="recordFormat"
            label="录像格式"
            error={errors.recordFormat}
          >
            <select
              {...inputProps("recordFormat")}
              value={values.recordFormat}
              onChange={(event) =>
                set(
                  "recordFormat",
                  event.target.value as PathValues["recordFormat"],
                )
              }
              className={selectClassName + " w-full"}
            >
              <option value="fmp4">Fragmented MP4</option>
              <option value="mpegts">MPEG-TS</option>
            </select>
          </Field>
          <Field
            name="recordSegmentDuration"
            label="分段时长"
            hint="例如 30s、1h、1h30m"
            error={errors.recordSegmentDuration}
          >
            <Input
              {...inputProps("recordSegmentDuration")}
              value={values.recordSegmentDuration}
              onChange={(event) =>
                set("recordSegmentDuration", event.target.value)
              }
            />
          </Field>
          <Field
            name="recordDeleteAfter"
            label="录像保留时长"
            hint="例如 24h、168h；0 表示不自动删除"
            error={errors.recordDeleteAfter}
          >
            <Input
              {...inputProps("recordDeleteAfter")}
              value={values.recordDeleteAfter}
              onChange={(event) => set("recordDeleteAfter", event.target.value)}
            />
          </Field>
        </div>
      </fieldset>
      <p className="text-xs leading-5 text-gray-400">
        配置立即作用于当前实例。MediaMTX 重启后将重新加载部署配置。
      </p>
      <div className="flex justify-end gap-3 border-t border-gray-100 pt-5">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={busy}
        >
          取消
        </Button>
        <Button type="submit" disabled={busy || !Object.keys(patch).length}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "正在保存…" : original ? "保存配置" : "创建路径"}
        </Button>
      </div>
    </form>
  );
}
