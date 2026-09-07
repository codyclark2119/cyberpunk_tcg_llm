export type DomainError = { code: string; message: string; path?: string };
export type Result<T> = { ok: true; value: T } | { ok: false; errors: DomainError[] };
export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (code: string, message: string): Result<never> => ({ ok: false, errors: [{ code, message }] });
