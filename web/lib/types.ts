export type User = {
  id: number;
  username: string;
  role: "admin" | "operator" | "viewer";
};
export type Session = {
  user: User;
  permissions: string[];
  csrfToken: string;
  expiresAt: string;
};
export type Pagination = { page: number; pageSize: number; total: number };
export type ApiResponse<T> = {
  data: T;
  pagination?: Pagination;
  meta?: { unavailableProtocols?: string[] };
};
export type Instance = { online: boolean; version: string; uptime: number };
export type Metrics = {
  inBitrate: number;
  outBitrate: number;
  bytesReceived: number;
  bytesSent: number;
  readers: number;
  sessions: number;
  errors: number;
  sampledAt: string | null;
  stale: boolean;
  scope: string;
};
export type Dashboard = {
  instance: Instance;
  streams: { total: number; online: number };
  connections: {
    publishers: number;
    viewers: number;
    idle: number;
    unavailableProtocols: string[];
  };
  traffic: Metrics;
};
export type Stream = {
  name: string;
  online: boolean;
  sourceType: string;
  tracks: { type: string; codec: string }[];
  readers: number;
  configured: boolean;
};
export type Connection = {
  id: string;
  protocol: string;
  path: string;
  remoteAddr: string;
  createdAt: string;
  state: string;
  bytesReceived: number;
  bytesSent: number;
};
export type PathConfig = {
  name: string;
  source: string;
  sourceHasCredentials: boolean;
  sourceOnDemand: boolean;
  maxReaders: number;
  record: boolean;
  recordFormat: "fmp4" | "mpegts";
  recordSegmentDuration: string;
  recordDeleteAfter: string;
  overridePublisher: boolean;
};
export type PathPatch = Partial<
  Omit<PathConfig, "name" | "sourceHasCredentials">
>;
export type Audit = {
  id: number;
  user: string;
  action: string;
  resource: string;
  time: string;
  ip: string;
  outcome: string;
};
export type TrafficPoint = {
  at: string;
  inBitrate: number | null;
  outBitrate: number | null;
};
