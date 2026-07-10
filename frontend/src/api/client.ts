/**
 * axios 实例 + 错误拦截。
 *
 * 后端用 `{ error: { code, message } }` 统一格式。拦截器在这里抽出 code，
 * 抛成 Error 让组件用 try/catch 或 TanStack Query 的 error 直接拿到。
 */

import axios, { AxiosError } from "axios";

import type { BackendError } from "./types";

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE as string | undefined)?.trim() ||
  (import.meta.env.DEV ? "http://127.0.0.1:8000/api" : "/api");

export function apiUrl(path: string): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60_000,
  headers: { "content-type": "application/json" },
});

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

api.interceptors.response.use(
  (resp) => resp,
  (err: AxiosError<BackendError>) => {
    const status = err.response?.status ?? 0;
    const body = err.response?.data;
    if (body && typeof body === "object" && "error" in body) {
      const { code, message, details } = body.error;
      return Promise.reject(new ApiError(code, message, status, details ?? {}));
    }
    return Promise.reject(
      new ApiError("NETWORK_ERROR", err.message || "network error", status),
    );
  },
);
