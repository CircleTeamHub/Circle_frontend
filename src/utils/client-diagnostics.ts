type DiagnosticDetails = Record<
  string,
  string | number | boolean | null | undefined
>;

export function logClientDiagnostic(
  event: string,
  details: DiagnosticDetails = {},
) {
  const sanitized = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined),
  );

  console.warn(`[client-diagnostic] ${event}`, sanitized);
}
