import { parseManagedUpdate } from "./managed-update-policy";
const update = {
  schemaVersion: 1,
  platform: "android",
  version: "1.2.3",
  versionCode: 1002003,
  apkUrl:
    "https://github.com/CircleTeamHub/windnote-releases/releases/download/v1.2.3/windnote.apk",
  sha256: "a".repeat(64),
  sizeBytes: 100,
};
describe("managed release policy", () => {
  it("returns no update for a server decision outside the rollout", () => {
    expect(
      parseManagedUpdate(
        { update: null, mandatory: false },
        "android",
        1000000,
      ),
    ).toBeNull();
  });
  it("preserves mandatory decisions and the validated installer manifest", () => {
    expect(
      parseManagedUpdate({ update, mandatory: true }, "android", 1000000),
    ).toMatchObject({
      mandatory: true,
      platform: "android",
      manifest: { versionCode: 1002003 },
    });
  });
  it("rejects downgrade, platform substitution, arbitrary hosts and malformed decisions", () => {
    for (const decision of [
      { update, mandatory: "yes" },
      {
        update: { ...update, apkUrl: "https://evil.example/app.apk" },
        mandatory: true,
      },
      { update: { ...update, platform: "ios" }, mandatory: false },
    ])
      expect(() => parseManagedUpdate(decision, "android", 1000000)).toThrow();
    expect(() =>
      parseManagedUpdate({ update, mandatory: true }, "android", 1002003),
    ).toThrow();
  });
  it("allows iOS App Store links and rejects redirect or credential URLs", () => {
    const ios = {
      ...update,
      platform: "ios",
      apkUrl: "https://apps.apple.com/cn/app/example/id12345",
    };
    expect(
      parseManagedUpdate({ update: ios, mandatory: false }, "ios", 100),
    ).toMatchObject({ platform: "ios", url: ios.apkUrl });
    for (const apkUrl of [
      "https://evil.example/id12345",
      ios.apkUrl + "?redirect=evil",
      "https://user:password@apps.apple.com/id12345",
    ])
      expect(() =>
        parseManagedUpdate(
          { update: { ...ios, apkUrl }, mandatory: false },
          "ios",
          100,
        ),
      ).toThrow();
  });
});
