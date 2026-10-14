import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { GroupChatAvatar } from "@/components/ui/group-chat-avatar";
import {
  CompactCardBubble,
  MessageAvatar,
} from "@/features/chat/components/bubbles/shared";
import {
  fetchGroupAdmission,
  type GroupAdmissionStatus,
} from "@/services/api/group-admissions";
import { fetchInvitation } from "@/services/api/circles";
import { useAuthStore } from "@/stores/authStore";
import type { ChatMessage } from "@/types";
export function GroupInvitationBubble({
  message,
  senderName,
  senderAvatarUri,
  selfName,
  selfAvatarUri,
  onPress,
}: {
  message: ChatMessage;
  senderName?: string;
  senderAvatarUri?: string;
  selfName?: string;
  selfAvatarUri?: string;
  onPress: (id: string, circle?: boolean) => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GroupAdmissionStatus | null>(null);
  const user = useAuthStore((s) => s.user?.id);
  const circleId = message.groupInvitation?.circleInvitationId ?? "";
  const id = circleId || message.groupInvitation?.admissionId || "";
  const name =
    typeof message.groupInvitation?.groupName === "string"
      ? message.groupInvitation.groupName
      : "";
  const uri =
    typeof message.groupInvitation?.avatarUrl === "string"
      ? message.groupInvitation.avatarUrl
      : null;
  useFocusEffect(
    useCallback(() => {
      let live = true;
      setStatus(null);
      if (id)
        void (
          circleId
            ? fetchInvitation(id).then((record) => ({
                status: (record.status === "APPROVED" ||
                record.status === "ADMIN_APPROVED"
                  ? "JOINED"
                  : record.status === "CANCELLED"
                    ? "DECLINED"
                    : record.status) as GroupAdmissionStatus,
              }))
            : fetchGroupAdmission(id)
        )
          .then((record) => {
            if (live && useAuthStore.getState().user?.id === user)
              setStatus(record.status);
          })
          .catch(() => {
            /* Opening detail provides an actionable retry. */
          });
      return () => {
        live = false;
      };
    }, [circleId, id, user]),
  );
  if (!id) return null;
  return (
    <CompactCardBubble
      message={message}
      outgoing={Boolean(message.outgoing)}
      avatarNode={
        <MessageAvatar
          message={message}
          outgoing={Boolean(message.outgoing)}
          senderName={senderName}
          senderAvatarUri={senderAvatarUri}
          selfName={selfName}
          selfAvatarUri={selfAvatarUri}
        />
      }
      leading={<GroupChatAvatar name={name} uri={uri} size={48} />}
      title={name}
      subtitle={t("groupAdmission.invitedBy", {
        name: senderName ?? selfName ?? "",
      })}
      footer={
        status
          ? t(`groupAdmission.status.${status}`)
          : t("groupAdmission.viewInvitation")
      }
      onPress={() => onPress(id, Boolean(circleId))}
    />
  );
}
