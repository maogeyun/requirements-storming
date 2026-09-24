/** User-facing lobby copy when the server rejects a join for Steam auth. */
export function multiplayerAuthErrorCopy(code: string): string | null {
  if (code === "AUTH_REQUIRED") {
    return "联机需要 Steam 会话票据。请先启动 Steam 客户端并登录。人机对局不需要 Steam。";
  }
  if (code === "AUTH_FAILED") {
    return "Steam 会话票据校验失败。请重新打开 Steam 后再试。人机对局不需要 Steam。";
  }
  return null;
}
