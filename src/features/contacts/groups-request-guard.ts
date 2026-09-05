export type GroupsRequestToken = {
  requestId: number;
  sessionEpoch: number;
};

export function createGroupsRequestGuard() {
  let latestRequestId = 0;

  return {
    begin(sessionEpoch: number): GroupsRequestToken {
      return { requestId: ++latestRequestId, sessionEpoch };
    },
    isActive(token: GroupsRequestToken, currentSessionEpoch: number) {
      return (
        token.requestId === latestRequestId &&
        token.sessionEpoch === currentSessionEpoch
      );
    },
    invalidate() {
      latestRequestId += 1;
    },
  };
}
