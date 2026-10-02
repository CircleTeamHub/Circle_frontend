export function getProfileSignature(
  persona?: string | null,
  helloWords?: string | null,
) {
  const nextPersona = persona?.trim();
  const nextHelloWords = helloWords?.trim();
  if (nextPersona) return nextPersona;
  if (nextHelloWords) return nextHelloWords;
  return '';
}
