import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import GroupEntryScreen from "./GroupEntryScreen";
import {
  fetchGroupAdmission,
  fetchGroupPreview,
  actOnGroupAdmission,
  applyToGroup,
} from "@/services/api/group-admissions";
const mockRouter = { replace: jest.fn(), setParams: jest.fn() };
let mockAuth = { user: { id: "u" }, sessionEpoch: 0 };
let mockParams: Record<string, string> = { groupId: "g" };
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => mockRouter,
  useSegments: () => ["(tabs)", "profile"],
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = jest.requireActual("react");
    useEffect(callback, [callback]);
  },
}));
jest.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock("@/components/ui/nav-header", () => ({ NavHeader: () => null }));
jest.mock("@/components/ui/group-chat-avatar", () => ({
  GroupChatAvatar: () => null,
}));
jest.mock("@/features/groups/GroupAdmissionsList", () => ({
  GroupAdmissionsList: () => null,
}));
jest.mock(
  "@/features/notifications/store/use-notification-center-store",
  () => ({
    useNotificationCenterStore: (select: (s: unknown) => unknown) =>
      select({ interactive: [] }),
  }),
);
jest.mock("@/stores/authStore", () => ({
  useAuthStore: Object.assign(
    (select: (s: unknown) => unknown) => select(mockAuth),
    { getState: () => mockAuth },
  ),
}));
jest.mock("@/services/api/group-admissions", () => ({
  fetchGroupAdmission: jest.fn(),
  fetchGroupPreview: jest.fn(),
  actOnGroupAdmission: jest.fn(),
  applyToGroup: jest.fn(),
  markGroupAdmissionSeen: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/services/api/errors", () => ({
  getApiErrorMessage: (_: unknown, fallback: string) => fallback,
}));
jest.mock("@/observability/report-failure", () => ({
  reportHandledFailure: jest.fn(),
}));
jest.mock("@/theme", () => ({
  Radius: { md: 8, xl: 16 },
  Spacing: { md: 8, lg: 16 },
  useTheme: () => ({
    colors: {
      background: "#fff",
      surface: "#fff",
      text: "#111",
      textSecondary: "#555",
      primary: "#00f",
      white: "#fff",
      surfaceBorder: "#ccc",
    },
  }),
}));
const group = {
  id: "g",
  name: "Group",
  avatarUrl: null,
  memberCount: 2,
  isMember: false,
  canManage: false,
  cardJoinEnabled: true,
  joinApprovalRequired: true,
  admission: null,
};
const invitation = {
  id: "i",
  conversationId: "g",
  applicantId: "u",
  inviterId: "v",
  kind: "INVITE" as const,
  status: "INVITED" as const,
  reason: "",
  expiresAt: "",
  acceptedAt: null,
  createdAt: "",
  group,
  applicantName: "U",
  inviterName: "V",
  isApplicant: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { groupId: "g" };
  mockAuth = { user: { id: "u" }, sessionEpoch: 0 };
  jest.mocked(fetchGroupPreview).mockResolvedValue(group);
  jest.mocked(fetchGroupAdmission).mockResolvedValue(invitation);
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
it("a manager invitation explains acceptance without review and enters chat after acceptance", async () => {
  mockParams = { admissionId: "i" };
  jest.mocked(fetchGroupAdmission).mockResolvedValue({
    ...invitation, requiresApproval: false,
  });
  render(<GroupEntryScreen />);
  await screen.findByText("groupAdmission.acceptRequired");
  expect(screen.queryByText("groupAdmission.reviewRequired")).toBeNull();
  expect(actOnGroupAdmission).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  const joined = {
    ...invitation, requiresApproval: false, status: "JOINED" as const,
    acceptedAt: "now", group: { ...group, isMember: true },
  };
  jest.mocked(actOnGroupAdmission).mockResolvedValue(joined);
  jest.mocked(fetchGroupAdmission).mockResolvedValue(joined);
  fireEvent.press(screen.getByLabelText("groupAdmission.accept"));
  const enter = await screen.findByLabelText("groupAdmission.enter");
  expect(screen.queryByText("groupAdmission.status.PENDING")).toBeNull();
  fireEvent.press(enter);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  expect(actOnGroupAdmission).toHaveBeenCalledWith("i", "accept");
});
it("opening a non-member group only previews it; explicit application remains outside chat", async () => {
  render(<GroupEntryScreen />);
  const button = await screen.findByLabelText("groupAdmission.apply");
  expect(applyToGroup).not.toHaveBeenCalled();
  expect(mockRouter.replace).not.toHaveBeenCalled();
  jest.mocked(applyToGroup).mockResolvedValue({ status: "PENDING" });
  jest.mocked(fetchGroupPreview).mockResolvedValue({
    ...group,
    admission: { ...invitation, status: "PENDING" },
  });
  fireEvent.press(button);
  await screen.findByText("groupAdmission.status.PENDING");
  expect(applyToGroup).toHaveBeenCalledWith("g", "");
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
it("only an explicit accept sends an action; a pending result never navigates to chat", async () => {
  mockParams = { admissionId: "i" };
  render(<GroupEntryScreen />);
  const button = await screen.findByLabelText("groupAdmission.accept");
  expect(actOnGroupAdmission).not.toHaveBeenCalled();
  const pending = {
    ...invitation,
    status: "PENDING" as const,
    acceptedAt: "now",
  };
  jest.mocked(actOnGroupAdmission).mockResolvedValue(pending);
  jest.mocked(fetchGroupAdmission).mockResolvedValue(pending);
  fireEvent.press(button);
  await screen.findByText("groupAdmission.status.PENDING");
  expect(actOnGroupAdmission).toHaveBeenCalledWith("i", "accept");
  expect(mockRouter.replace).not.toHaveBeenCalled();
});
it("a group member enters chat in the original tab after authoritative membership lookup", async () => {
  jest
    .mocked(fetchGroupPreview)
    .mockResolvedValue({ ...group, isMember: true });
  render(<GroupEntryScreen />);
  await waitFor(() =>
    expect(mockRouter.replace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/(tabs)/profile/chat-detail" }),
    ),
  );
});
it("a submission failure refreshes the status instead of retrying the mutation", async () => {
  render(<GroupEntryScreen />);
  const button = await screen.findByLabelText("groupAdmission.apply");
  jest.mocked(applyToGroup).mockRejectedValue(new Error("lost response"));
  fireEvent.press(button);
  await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
  expect(applyToGroup).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(fetchGroupPreview).toHaveBeenCalledTimes(2));
});

it("switching accounts during submission clears busy state and ignores the old completion", async () => {
  let finishOld!: (value: unknown) => void;
  let finishNew!: (value: unknown) => void;
  jest.mocked(applyToGroup).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const view = render(<GroupEntryScreen />);
  fireEvent.press(await screen.findByLabelText("groupAdmission.apply"));
  mockAuth = { user: { id: "other" }, sessionEpoch: 1 };
  view.rerender(<GroupEntryScreen />);
  const newButton = await screen.findByLabelText("groupAdmission.apply");
  jest.mocked(applyToGroup).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNew = resolve;
      }),
  );
  fireEvent.press(newButton);
  await act(async () => finishOld({ status: "PENDING" }));
  fireEvent.press(screen.getByLabelText("groupAdmission.apply"));
  expect(applyToGroup).toHaveBeenCalledTimes(2);
  await act(async () => finishNew({ status: "PENDING" }));
});


it("a departed applicant can submit a new application from an old invitation detail", async () => {
  mockParams = { admissionId: "i" };
  jest.mocked(fetchGroupAdmission).mockResolvedValue({ ...invitation, status: "LEFT" });
  jest.mocked(applyToGroup).mockResolvedValue({ id: "new-application", status: "PENDING" });
  render(<GroupEntryScreen />);
  const apply = await screen.findByLabelText("groupAdmission.apply");
  expect(screen.queryByLabelText("groupAdmission.enter")).toBeNull();
  fireEvent.press(apply);
  await waitFor(() => expect(mockRouter.setParams).toHaveBeenCalledWith({ admissionId: "new-application" }));
});


it('circle member navigation keeps circle source ID and chat conversation ID distinct', async () => {
  jest.mocked(fetchGroupPreview).mockResolvedValue({ ...group, id: 'chat-id', circleId: 'circle-id', isMember: true });
  render(<GroupEntryScreen />);
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ sourceID: 'circle-id', conversationID: 'chat-id' }) })));
});
