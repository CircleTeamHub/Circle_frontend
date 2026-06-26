export type ShareCircleCardListState = 'loading' | 'error' | 'empty' | 'ready';

export function getShareCircleCardListState(input: {
  loading: boolean;
  error: boolean;
  conversationCount: number;
}): ShareCircleCardListState {
  if (input.loading) {
    return 'loading';
  }

  if (input.conversationCount > 0) {
    return 'ready';
  }

  return input.error ? 'error' : 'empty';
}
