"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Radio, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { validateLogin, type LoginFormErrors } from "@/lib/auth";
import { errorMessage, login } from "@/lib/api";
import { routes } from "@/lib/routes";
import { usePanel } from "@/components/panel-provider";
import { ErrorNotice } from "@/components/dashboard/panel-ui";

export default function LoginPage() {
  const router = useRouter();
  const { session, sessionLoading, acceptSession } = usePanel();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<LoginFormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (session) router.replace(routes.dashboard);
  }, [session, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const nextErrors = validateLogin({ username, password });
    setErrors(nextErrors);
    setError(null);
    if (Object.keys(nextErrors).length) return;
    setIsSubmitting(true);
    try {
      acceptSession(await login(username.trim(), password));
      router.replace(routes.dashboard);
    } catch (failure) {
      setError(errorMessage(failure));
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#faf8f5] px-6 text-gray-800 sm:px-10">
      <div className="flex flex-1 items-center justify-center py-12">
        <section className="w-full max-w-md" aria-labelledby="login-title">
          <div className="mb-6 flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#4a9d9a] shadow-lg shadow-[#4a9d9a]/20">
              <Radio className="h-6 w-6 text-white" />
            </div>
          </div>
          <h1
            id="login-title"
            className="text-center text-2xl font-semibold tracking-tight text-gray-800"
          >
            登录工作台
          </h1>
          <p className="mb-10 mt-3 text-center text-sm text-gray-400">
            连接您的 MediaMTX，掌握每一路流
          </p>
          <ErrorNotice message={error} />
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            <div>
              <label
                htmlFor="username"
                className="mb-2.5 block text-sm font-medium text-gray-700"
              >
                用户名
              </label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setErrors((current) => ({ ...current, username: undefined }));
                }}
                placeholder="输入管理员或成员用户名"
                aria-invalid={Boolean(errors.username)}
                aria-describedby={
                  errors.username ? "username-error" : undefined
                }
                className="login-input"
              />
              {errors.username && (
                <p
                  id="username-error"
                  className="mt-2 text-xs text-[#b45f50]"
                  role="alert"
                >
                  {errors.username}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="password"
                className="mb-2.5 block text-sm font-medium text-gray-700"
              >
                登录密码
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setErrors((current) => ({
                      ...current,
                      password: undefined,
                    }));
                  }}
                  placeholder="输入您的密码"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={
                    errors.password ? "password-error" : undefined
                  }
                  className="login-input pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-[#faf8f5] hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a9d9a]/40"
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p
                  id="password-error"
                  className="mt-2 text-xs text-[#b45f50]"
                  role="alert"
                >
                  {errors.password}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={isSubmitting || sessionLoading || Boolean(session)}
              className="group flex w-full items-center justify-center gap-2 rounded-xl bg-[#4a9d9a] px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#4a9d9a]/15 transition-colors hover:bg-[#438e8b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a9d9a]/50 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
            >
              {sessionLoading
                ? "正在检查会话…"
                : isSubmitting
                  ? "正在登录…"
                  : "登录工作台"}
              {!isSubmitting && !sessionLoading && (
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </form>
          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-400">
            <ShieldCheck
              className="h-4 w-4 text-[#4a9d9a]"
              aria-hidden="true"
            />
            使用您的面板账号安全登录
          </div>
        </section>
      </div>
      <footer className="pb-8 text-center text-xs text-gray-400">
        MediaMTX Panel · 每一路连接，清晰可见
      </footer>
    </main>
  );
}
