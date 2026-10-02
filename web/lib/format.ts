export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index =
    value < 1
      ? 0
      : Math.min(
          Math.floor(Math.log(value) / Math.log(1024)),
          units.length - 1,
        );
  return `${(value / 1024 ** index).toLocaleString("zh-CN", { maximumFractionDigits: index ? 2 : 0 })} ${units[index]}`;
}
export function formatBitrate(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  const index =
    value < 1 ? 0 : Math.min(Math.floor(Math.log(value) / Math.log(1000)), 3);
  return `${(value / 1000 ** index).toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${units[index]}`;
}
export function formatDate(value: string | null | undefined) {
  if (
    !value ||
    !Number.isFinite(Date.parse(value)) ||
    value.startsWith("0001-")
  )
    return "—";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
export function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days
    ? `${days} 天 ${hours} 小时`
    : hours
      ? `${hours} 小时 ${minutes} 分钟`
      : `${minutes} 分钟`;
}
export const roleLabels: Record<string, string> = {
  admin: "管理员",
  operator: "操作员",
  viewer: "观察者",
};
export const actionLabels: Record<string, string> = {
  login: "登录",
  logout: "退出登录",
  "stream.create": "创建路径",
  "stream.update": "更新路径",
  "stream.delete": "删除路径",
  "connection.kick": "断开连接",
  "user.create": "创建用户",
};
export function csvCell(value: string | number) {
  let text = String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const url = URL.createObjectURL(
    new Blob(
      ["\uFEFF", rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
