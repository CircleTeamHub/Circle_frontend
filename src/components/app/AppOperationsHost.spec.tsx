import { act, render, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import { AppOperationsHost } from "./AppOperationsHost";
import { apiClient } from "@/services/api/client";
import { getDeviceId } from "@/services/auth/device-id";
const mockState = { isAuthenticated: true, isLoading:false,accessToken:"local-test-token" as string|null, sessionEpoch: 1 };
jest.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: typeof mockState) => unknown) => selector(mockState),
    { getState: () => mockState },
  ),
}));
jest.mock("@/services/api/client", () => ({ apiClient: jest.fn() }));
jest.mock("@/services/auth/device-id", () => ({ getDeviceId: jest.fn() }));
jest.mock("expo-application", () => ({
  nativeBuildVersion: "1000000",
  nativeApplicationVersion: "1.0.0",
}));
jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { version: "1.0.0", extra: {} } },
}));
beforeEach(() => {
  jest.mocked(apiClient).mockReset();
  jest.mocked(getDeviceId).mockReset();
  mockState.isAuthenticated = true;
  mockState.isLoading=false;mockState.accessToken="local-test-token";
  mockState.sessionEpoch = 1;
  jest.mocked(getDeviceId).mockResolvedValue("local-device-identifier");
  jest.mocked(apiClient).mockResolvedValue({ recorded: true });
});
afterEach(() => jest.restoreAllMocks());
it("records coarse metadata and removes the lifecycle subscription on unmount", async () => {
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove });
  const view = render(<AppOperationsHost />);
  await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
  const options = jest.mocked(apiClient).mock.calls[0][1];
  expect(options?.body).toMatchObject({
    eventID: expect.any(String),
    appVersion: "1.0.0",
    build: 1000000,
  });
  expect(options?.body).not.toHaveProperty("userID");
  expect(JSON.stringify(options)).not.toContain("local-device-identifier");
  view.unmount();
  expect(remove).toHaveBeenCalled();
});
it("does not report an old account after an asynchronous device read crosses account switching", async () => {
  let resolveDevice!: (value: string) => void;
  jest.mocked(getDeviceId).mockReturnValue(
    new Promise((resolve) => {
      resolveDevice = resolve;
    }),
  );
  render(<AppOperationsHost />);
  mockState.sessionEpoch = 2;
  await act(async () => resolveDevice("old-device-identifier"));
  expect(apiClient).not.toHaveBeenCalled();
});
it("reuses the same event ID when a network failure is retried on foreground", async () => {
  let foreground!: (state: import("react-native").AppStateStatus) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
  jest
    .mocked(apiClient)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ recorded: true });
  render(<AppOperationsHost />);
  await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(1));
  await act(async () => foreground("active"));
  await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
  expect(jest.mocked(apiClient).mock.calls[0][1]?.body).toEqual(
    jest.mocked(apiClient).mock.calls[1][1]?.body,
  );
});

it('waits for session bootstrap and secure tokens before reporting',async()=>{
  mockState.isLoading=true;mockState.accessToken=null;
  const view=render(<AppOperationsHost/>);expect(getDeviceId).not.toHaveBeenCalled();expect(apiClient).not.toHaveBeenCalled();
  mockState.isLoading=false;view.rerender(<AppOperationsHost/>);expect(apiClient).not.toHaveBeenCalled();
  mockState.accessToken='local-test-token';view.rerender(<AppOperationsHost/>);await waitFor(()=>expect(apiClient).toHaveBeenCalledTimes(1));
});
