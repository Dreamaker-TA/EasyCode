/**
 * api 包入口：re-export client + 所有领域函数。
 */

export { api, ApiError } from "./client";
export * from "./types";
export * from "./problems";
export * from "./submissions";
export * from "./tutor";
export * from "./mastery";
export * from "./execution";
export * from "./training";
