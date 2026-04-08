export function getProfileSignature(
  persona?: string | null,
  helloWords?: string | null,
) {
  const nextPersona = persona?.trim();
  const nextHelloWords = helloWords?.trim();

  return nextPersona || nextHelloWords || '完善资料后会在这里展示你的介绍。';
}
