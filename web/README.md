# Static UI integration

Set `MTXUI_STATIC_DIR` to your compiled UI directory. The backend serves its files
and falls back to `index.html` for extensionless SPA routes. Directory listing and
dotfiles are blocked; symlinks cannot escape the configured root.

This MVP contains the backend only. Web clients call `/api/v1`, never the MediaMTX
Control API. Login with JSON, keep the HttpOnly cookie, and send the returned
`csrfToken` in `X-CSRF-Token` on POST/PATCH/DELETE. After refresh, retrieve a fresh
view of the session using `/api/v1/auth/me`. Do not store session IDs in localStorage.

Static content must work with the default same-origin CSP (no inline scripts).
Use a same-origin reverse proxy in development; cross-origin API access is disabled.
