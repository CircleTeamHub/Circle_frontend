import { useCallStore } from '@/features/call/store/use-call-store';
import { type RefObject, useCallback, useRef, useState } from 'react';
import { type CallType } from '@/features/call/types';
import { Alert } from 'react-native';
import { resolveDirectCalleeID } from '@/features/call/resolve-direct-callee';
import { createDirectCall, createGroupCall } from '@/services/api/calls';
import { router } from 'expo-router';
import { fetchChatMembers } from '@/chat-core/api';
import { getApiErrorMessage } from '@/services/api/errors';
import { reportHandledFailure } from '@/observability/report-failure';
import { type TFunction } from 'i18next';
import { type AuthUser } from '@/stores/authStore';

export interface ChatCallParams {
  t: TFunction<"translation", undefined>;
  authUser: AuthUser | null;
  mountedRef: RefObject<boolean>;
  sourceID: string;
  conversationID: string;
  isGroupChat: boolean;
  revalidateMemberViewAccess: () => Promise<boolean>;
  isPreviewMode: boolean;
}

/**
 * 聊天页发起语音/视频通话:选择通话类型、建单聊/群通话、防重复点击。
 */
export function useChatCall({
  t,
  authUser,
  mountedRef,
  sourceID,
  conversationID,
  isGroupChat,
  revalidateMemberViewAccess,
  isPreviewMode,
}: ChatCallParams) {
  const setActiveCall = useCallStore((state) => state.setActiveCall);
  const [callStarting, setCallStarting] = useState(false);
  const callStartingRef = useRef(false);
  const startCallWithType = useCallback(async (callType: CallType) => {
    if (callStartingRef.current) return;

    if (isPreviewMode || !conversationID || !sourceID) {
      Alert.alert(t('chat.call.title'), t('chat.call.groupNotReady'));
      return;
    }

    if (!authUser?.id) {
      Alert.alert(t('chat.call.title'), t('chat.call.notLoggedIn'));
      return;
    }

    callStartingRef.current = true;
    setCallStarting(true);
    try {
      // 1:1（circle_be#113）：正常入口 sourceID 即对方 UUID。推送路由的
      // 兜底是 sourceID || conversationID —— 可能拿到 'direct:a:b' 会话 id，
      // 直接当 calleeID 必失败。统一走 resolveDirectCalleeID：从会话 id 里
      // 剔除自己解出对端，解不出来给可控提示。
      if (!isGroupChat) {
        const calleeID = resolveDirectCalleeID(sourceID, authUser.id);
        if (!calleeID) {
          Alert.alert(t('chat.call.title'), t('chat.call.initiateFailed'));
          return;
        }
        const response = await createDirectCall({
          calleeID,
          callType,
        });
        // round 3 review：呼叫已在服务端创建、对端在响铃 —— 即使本页已
        // unmount（用户先行离开）也要落全局通话态并进通话页（store/router
        // 都是全局对象，unmount 后调用安全），与主页拨打路径一致。
        setActiveCall(response.call, response.livekit);
        router.push('/(chat)/group-call' as never);
        return;
      }

      // review P1：发起群呼要拉全量成员表，执行前 fail-closed 重查角色。
      if (!(await revalidateMemberViewAccess())) {
        Alert.alert(t('chat.call.title'), t('chat.groupMembersRestricted'));
        return;
      }

      const members = await fetchChatMembers(conversationID);
      const inviteeIDs = Array.from(
        new Set(
          members
            .map((member) => member.userId)
            .filter((userID) => userID && userID !== authUser.id),
        ),
      );

      if (inviteeIDs.length === 0) {
        Alert.alert(t('chat.call.title'), t('chat.call.noOtherMembers'));
        return;
      }

      const response = await createGroupCall({
        conversationID,
        callType,
        inviteeIDs,
      });
      // 同上：成功创建的群呼即使页面已 unmount 也要进入通话 UI
      setActiveCall(response.call, response.livekit);
      router.push('/(chat)/group-call' as never);
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert(
          t('chat.call.title'),
          getApiErrorMessage(error, t('chat.call.initiateFailed')),
        );
      }
      reportHandledFailure('call', 'start', error);
    } finally {
      callStartingRef.current = false;
      if (mountedRef.current) {
        setCallStarting(false);
      }
    }
  }, [
    authUser?.id,
    conversationID,
    isGroupChat,
    isPreviewMode,
    revalidateMemberViewAccess,
    setActiveCall,
    sourceID,
    t,
    mountedRef,
  ]);

  // #119：通话入口先选类型（语音 / 视频），再走原发起流程。
  // review P2：选择器打开期间快速连点会叠开多个原生对话框，滞留的选项在首次
  // 呼叫完成后还能再发一次非幂等 POST —— 弹出前置 ref 门，选择/取消时解除。
  const callChooserOpenRef = useRef(false);
  const handleStartCall = useCallback(() => {
    if (callStartingRef.current || callChooserOpenRef.current) return;
    callChooserOpenRef.current = true;
    const choose = (callType: CallType) => {
      callChooserOpenRef.current = false;
      void startCallWithType(callType);
    };
    const dismiss = () => {
      callChooserOpenRef.current = false;
    };
    Alert.alert(
      t('call.chooseType', { defaultValue: '发起通话' }),
      undefined,
      [
        {
          text: t('call.typeVoice', { defaultValue: '语音通话' }),
          onPress: () => choose('AUDIO'),
        },
        {
          text: t('call.typeVideo', { defaultValue: '视频通话' }),
          onPress: () => choose('VIDEO'),
        },
        {
          text: t('common.cancel', { defaultValue: '取消' }),
          style: 'cancel',
          onPress: dismiss,
        },
      ],
      { cancelable: true, onDismiss: dismiss },
    );
  }, [startCallWithType, t]);

  return {
    callStarting,
    handleStartCall,
  };
}
