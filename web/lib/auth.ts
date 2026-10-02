export type LoginFormValues = {
  username: string;
  password: string;
};

export type LoginFormErrors = Partial<Record<keyof LoginFormValues, string>>;

/**
 * 前端校验只负责尽早反馈格式问题；真实身份校验仍应由服务端完成。
 */
export function validateLogin(values: LoginFormValues): LoginFormErrors {
  const errors: LoginFormErrors = {};
  const username = values.username.trim();

  if (!username) {
    errors.username = "请输入用户名";
  } else if (!/^[a-zA-Z0-9_.-]{3,64}$/.test(username)) {
    errors.username = "用户名需为 3–64 个字母、数字、下划线、点或短横线";
  }

  if (!values.password) {
    errors.password = "请输入密码";
  } else if (new TextEncoder().encode(values.password).length > 1024) {
    errors.password = "密码不能超过 1024 字节";
  }

  return errors;
}
