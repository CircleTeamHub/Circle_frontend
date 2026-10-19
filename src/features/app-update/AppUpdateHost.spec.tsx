import { Alert } from "react-native";
import { act, render, waitFor } from "@testing-library/react-native";
import { AppUpdateHost } from "./AppUpdateHost";
import { checkForManagedUpdate } from "./managed-update-service";
import { downloadAndInstallAndroidUpdate } from "./app-update-service";
jest.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock("./managed-update-service", () => ({
  checkForManagedUpdate: jest.fn(),
}));
jest.mock("./app-update-service", () => ({
  downloadAndInstallAndroidUpdate: jest.fn(),
}));
const manifest = {
  schemaVersion: 1 as const,
  version: "1.0.1",
  versionCode: 1000001,
  apkUrl:
    "https://github.com/CircleTeamHub/windnote-releases/releases/download/v1.0.1/windnote.apk",
  sha256: "a".repeat(64),
  sizeBytes: 100,
};
afterEach(() => jest.restoreAllMocks());
it("offers optional updates through the existing verified installer", async () => {
  jest
    .mocked(checkForManagedUpdate)
    .mockResolvedValue({
      platform: "android",
      mandatory: false,
      version: manifest.version,
      url: manifest.apkUrl,
      manifest,
    });
  jest.mocked(downloadAndInstallAndroidUpdate).mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  render(<AppUpdateHost />);
  await waitFor(() => expect(alert).toHaveBeenCalled());
  const button = alert.mock.calls[0][2]?.find((b) => b.onPress);
  await act(async () => {
    await button?.onPress?.();
  });
  expect(downloadAndInstallAndroidUpdate).toHaveBeenCalledWith(manifest);
});
it("blocks ordinary navigation for a required update and offers no cancel action", async () => {
  jest
    .mocked(checkForManagedUpdate)
    .mockResolvedValue({
      platform: "android",
      mandatory: true,
      version: manifest.version,
      url: manifest.apkUrl,
      manifest,
    });
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const view = render(<AppUpdateHost />);
  await waitFor(() =>
    expect(view.getByText("appUpdate.requiredTitle")).toBeTruthy(),
  );
  expect(view.queryByText("common.cancel")).toBeNull();
  expect(alert).not.toHaveBeenCalled();
});
