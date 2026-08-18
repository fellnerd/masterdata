// Shared result shape for the service layer (src/lib/services/*): services
// contain pure business logic and never touch NextResponse, so both the
// internal session-authenticated routes and the token-authenticated v1
// routes can call the same function and map the result to their own
// response envelope. Unexpected DB errors are left to throw - callers'
// try/catch turns those into a generic 500, matching prior route behavior.
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string }
