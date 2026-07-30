export type AuthSessionIdentity = {
  sessionEpoch: number;
  userId: string;
};

type AuthSessionState = {
  sessionEpoch: number;
  user: { id: string } | null;
};

export function captureAuthSessionIdentity(
  state: AuthSessionState,
): AuthSessionIdentity | null {
  if (!state.user?.id) return null;
  return {
    sessionEpoch: state.sessionEpoch,
    userId: state.user.id,
  };
}

export function isAuthSessionIdentityCurrent(
  identity: AuthSessionIdentity | null,
  state: AuthSessionState,
): identity is AuthSessionIdentity {
  return (
    identity !== null &&
    state.sessionEpoch === identity.sessionEpoch &&
    state.user?.id === identity.userId
  );
}
