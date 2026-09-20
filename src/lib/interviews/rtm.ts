/**
 * Backwards-compatible re-export.
 *
 * RTM payload parsing is Agora protocol work, not interview work, so it now lives in
 * `@/lib/agora/rtm` where the signed-in task composer can use it without importing anything from the
 * interview feature. This shim keeps the interview call sites unchanged.
 */
export * from "@/lib/agora/rtm";
