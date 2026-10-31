import type { Href } from "expo-router";
import type { UserProfileScope } from "@/features/user/utils/routes";
export function getGroupEntryHref(
  scope: UserProfileScope,
  params: {
    groupId?: string;
    admissionId?: string;
    searchedMsgID?: string;
    manage?: string;
  },
): Href {
  switch (scope) {
    case "profile":
      return { pathname: "/(tabs)/profile/group-entry", params };
    case "contacts":
      return { pathname: "/(tabs)/contacts/group-entry", params };
    case "discover":
      return { pathname: "/(tabs)/discover/group-entry", params };
    case "explore":
      return { pathname: "/(tabs)/explore/group-entry", params };
    default:
      return { pathname: "/(tabs)/messages/group-entry", params };
  }
}
