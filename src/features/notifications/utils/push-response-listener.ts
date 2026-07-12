type Subscription = { remove: () => void };

type NotificationsResponseSource<T> = {
  addNotificationResponseReceivedListener: (
    listener: (response: T) => void,
  ) => Subscription;
  getLastNotificationResponse: () => T | null;
  clearLastNotificationResponse: () => void;
};

export function initializePushResponseListener<T>(
  notifications: NotificationsResponseSource<T>,
  handleResponse: (response: T | null) => void,
  reportInitializationFailure: (error: unknown) => void = () => {},
) {
  const subscription =
    notifications.addNotificationResponseReceivedListener(handleResponse);
  try {
    handleResponse(notifications.getLastNotificationResponse());
    notifications.clearLastNotificationResponse();
  } catch (error) {
    reportInitializationFailure(error);
  }
  return subscription;
}
