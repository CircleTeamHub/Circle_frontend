import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchChatAbnormalMembers, fetchChatMembers } from '@/chat-core/api';
import type {
  AbnormalInactiveDays,
  ChatAbnormalMemberDto,
  ChatMemberDto,
} from '@/chat-core/protocol';
import {
  type GroupRole,
  resolveStandaloneSelfRole,
} from '@/features/chat/group-admin-permissions';
import { fetchCircleDetail } from '@/services/api/circles';
import { reportHandledFailure } from '@/observability/report-failure';

export interface AbnormalMemberRow {
  member: ChatMemberDto;
  flag: ChatAbnormalMemberDto;
}

interface Params {
  conversationID: string;
  /** 圈子 id;独立群聊为空串。 */
  groupID: string;
  currentUserID: string | null | undefined;
  ownerId: string | null;
  inactiveDays: AbnormalInactiveDays;
}

interface State {
  rows: AbnormalMemberRow[];
  creditThreshold: number | null;
  selfRole: GroupRole | null;
  loading: boolean;
  error: boolean;
}

/**
 * 异常成员页的数据:成员目录(昵称/头像/角色)× 服务端判定(只回 userId + 原因)。
 * 服务端只列本人有权移出的成员;目录里已经找不到的人(刚退群)直接丢掉。
 * 切换天数会重拉,旧请求晚到的结果按序号丢弃。
 */
export function useGroupAbnormalMembers(params: Params) {
  const { conversationID, groupID, currentUserID, ownerId, inactiveDays } = params;
  const [state, setState] = useState<State>({
    rows: [],
    creditThreshold: null,
    selfRole: null,
    loading: true,
    error: false,
  });
  const requestRef = useRef(0);
  const rowsDaysRef = useRef(inactiveDays);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    // 切了天数,旧行的判定条件已经不对(标签会按新天数显示),先清掉走中间转圈,
    // 免得对着旧行批量移出;同一天数的重拉(移出后)保留旧行。
    const daysChanged = rowsDaysRef.current !== inactiveDays;
    rowsDaysRef.current = inactiveDays;
    setState((current) => ({
      ...current,
      rows: daysChanged ? [] : current.rows,
      loading: true,
      error: false,
    }));
    try {
      const [directory, abnormal, detail] = await Promise.all([
        fetchChatMembers(conversationID),
        fetchChatAbnormalMembers(conversationID, inactiveDays),
        groupID ? fetchCircleDetail(groupID) : Promise.resolve(null),
      ]);
      if (request !== requestRef.current) return;
      const byId = new Map(directory.map((member) => [member.userId, member]));
      const rows = abnormal.members.flatMap((flag) => {
        const member = byId.get(flag.userId);
        return member ? [{ member, flag }] : [];
      });
      const selfRole = groupID
        ? detail && detail.myStatus === 'ACTIVE'
          ? detail.myRole
          : null
        : resolveStandaloneSelfRole({ members: directory, currentUserID, ownerId });
      setState({
        rows,
        creditThreshold: abnormal.creditThreshold,
        selfRole,
        loading: false,
        error: false,
      });
    } catch (err) {
      if (request !== requestRef.current) return;
      reportHandledFailure('groupAbnormalMembers', 'load', err);
      setState((current) => ({ ...current, loading: false, error: true }));
    }
  }, [conversationID, currentUserID, groupID, inactiveDays, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeRow = useCallback((userId: string) => {
    setState((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.member.userId !== userId),
    }));
  }, []);

  return { ...state, reload: load, removeRow };
}
