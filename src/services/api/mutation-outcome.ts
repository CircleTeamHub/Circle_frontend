/**
 * A failed mutation may still have reached the server when the response is
 * missing or the server failed after committing. Callers should guide users
 * to reconcile the result instead of blindly retrying those failures.
 */
export function isAmbiguousMutationFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true;

  const status = (error as { status?: unknown }).status;
  return typeof status !== 'number' || status === 0 || status >= 500;
}
