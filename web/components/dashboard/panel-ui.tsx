"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { errorMessage } from "@/lib/api";

export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string | null;
  onRetry?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#c17767]/20 bg-[#c17767]/[0.07] px-4 py-3 text-sm text-[#a45c4e]"
    >
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="text-[#a45c4e]"
        >
          重试
        </Button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  loading = false,
}: {
  title?: string;
  description?: string;
  loading?: boolean;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#faf8f5] text-[#6b8e8e]">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Inbox className="h-5 w-5" />
        )}
      </div>
      <p className="text-sm font-medium text-gray-600">
        {loading ? "正在加载…" : (title ?? "暂无数据")}
      </p>
      {!loading && description && (
        <p className="max-w-md text-xs leading-6 text-gray-400">
          {description}
        </p>
      )}
    </div>
  );
}
export function StatusBadge({
  online,
  children,
}: {
  online: boolean;
  children?: ReactNode;
}) {
  return (
    <Badge
      className={
        online ? "bg-[#4a9d9a]/10 text-[#438e8b]" : "bg-gray-100 text-gray-500"
      }
    >
      <span
        className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${online ? "bg-[#4a9d9a]" : "bg-gray-400"}`}
      />
      {children ?? (online ? "在线" : "离线")}
    </Badge>
  );
}
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
      <p className="text-xs text-gray-400">
        共 {total.toLocaleString("zh-CN")} 条
        {total > 0 &&
          ` · 第 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} 条`}
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-xs text-gray-500">
          {page} / {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="下一页"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  description,
  onClose,
  busy = false,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      aria-describedby={description ? `${id}-description` : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            onClose();
        }
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-2xl border-0 bg-white p-0 text-gray-800 shadow-2xl backdrop:bg-gray-900/25 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
        <div>
          <h2 id={id} className="break-all text-lg font-semibold">
            {title}
          </h2>
          {description && (
            <p
              id={`${id}-description`}
              className="mt-1 text-xs leading-5 text-gray-400"
            >
              {description}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="关闭对话框"
          disabled={busy}
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  );
}
export function ConfirmDialog({
  title,
  description,
  label,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  label: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      busy={busy}
    >
      <ErrorNotice message={error} />
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={busy}
          data-autofocus
        >
          取消
        </Button>
        <Button
          className="bg-[#c17767] hover:bg-[#aa6657]"
          onClick={confirm}
          disabled={busy}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {busy ? "正在处理…" : label}
        </Button>
      </div>
    </Modal>
  );
}
export const selectClassName =
  "h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-600 outline-none focus:border-[#4a9d9a] focus:ring-2 focus:ring-[#4a9d9a]/20";
