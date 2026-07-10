import { useCallback, useEffect, useState } from "react";

/**
 * 输入输出格式偏好。
 *
 * - `leetcode`：编辑器预填「可见 ACM 外壳 + 函数 stub」，用户只写函数体（该题需有授权模板）。
 * - `acm`：编辑器留空，用户自行读 stdin / print。
 *
 * 纯前端偏好（只影响编辑器起始内容），存 localStorage。后端执行始终按 ACM（stdin→stdout）。
 * 全局默认在设置页选择；开题时可按次覆盖。
 */
export type IoFormat = "leetcode" | "acm";

const KEY = "easycode:io-format";

export function getIoFormatDefault(): IoFormat {
  if (typeof window === "undefined") return "leetcode";
  const stored = window.localStorage.getItem(KEY);
  return stored === "acm" || stored === "leetcode" ? stored : "leetcode";
}

export function useIoFormat() {
  const [ioFormat, setIoFormat] = useState<IoFormat>(getIoFormatDefault);

  useEffect(() => {
    window.localStorage.setItem(KEY, ioFormat);
  }, [ioFormat]);

  const set = useCallback((value: IoFormat) => setIoFormat(value), []);

  return { ioFormat, setIoFormat: set };
}
