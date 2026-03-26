import { create } from 'zustand';
import type { Conversation, CustomConversationGroup } from '@/types';

const INITIAL_CONVERSATIONS: Conversation[] = [
  {
    id: '1',
    name: '陈思琪',
    message: '嘿！今晚还是一起吃饭吗？',
    time: '下午 3:34',
    unreadCount: 3,
    conversationType: 'private',
  },
  {
    id: '2',
    name: '张明远',
    message: '昨日文件已经上传了 :)',
    time: '下午 1:15',
    unreadCount: 0,
    conversationType: 'private',
  },
  {
    id: '3',
    name: '李晓婷',
    message: '你觉得这个设计怎么样？',
    time: '中午 12:02',
    unreadCount: 1,
    conversationType: 'private',
  },
  {
    id: '4',
    name: '北京户外搭子群',
    message: '周末去香山的报名接龙开了',
    time: '上午 11:20',
    unreadCount: 4,
    conversationType: 'group',
    customGroupIds: ['beijing-group'],
  },
  {
    id: '5',
    name: '北京美食探店群',
    message: '朝阳这家新店今晚有空位',
    time: '上午 10:45',
    unreadCount: 5,
    conversationType: 'group',
    customGroupIds: ['beijing-group'],
  },
  {
    id: '6',
    name: '赵天宇',
    message: '哈哈太搞笑了',
    time: '昨天',
    unreadCount: 0,
    conversationType: 'private',
  },
  {
    id: '7',
    name: '林美琪',
    message: '有空的时候帮我打个电话',
    time: '昨天',
    unreadCount: 0,
    conversationType: 'private',
  },
  {
    id: '8',
    name: '上海同城活动群',
    message: '周末 citywalk 路线更新了',
    time: '昨天',
    unreadCount: 2,
    conversationType: 'group',
    customGroupIds: ['shanghai-group'],
  },
  {
    id: '9',
    name: '吴佳怡',
    message: '收到，我马上处理',
    time: '周三',
    unreadCount: 0,
    conversationType: 'private',
  },
  {
    id: '10',
    name: '产品共创群',
    message: '最新原型图已同步到群文件',
    time: '周三',
    unreadCount: 3,
    conversationType: 'group',
  },
  {
    id: '11',
    name: '郑小雨',
    message: '生日快乐！',
    time: '周二',
    unreadCount: 0,
    conversationType: 'private',
  },
  {
    id: '12',
    name: '黄丽华',
    message: '明天的会议记得参加',
    time: '周二',
    unreadCount: 1,
    conversationType: 'private',
  },
  {
    id: '13',
    name: '杭州交流群',
    message: '有新同学加入了群聊',
    time: '周一',
    unreadCount: 2,
    conversationType: 'group',
    customGroupIds: ['hangzhou-group'],
  },
  {
    id: '14',
    name: '罗敏',
    message: '好的没问题',
    time: '周一',
    unreadCount: 0,
    conversationType: 'private',
  },
  {
    id: '15',
    name: '谢欣然',
    message: '[图片]',
    time: '上周',
    unreadCount: 0,
    conversationType: 'private',
  },
];

const INITIAL_CUSTOM_GROUPS: CustomConversationGroup[] = [
  { id: 'beijing-group', name: '北京群' },
  { id: 'shanghai-group', name: '上海群' },
  { id: 'hangzhou-group', name: '杭州群' },
];

interface MessageGroupsState {
  conversations: Conversation[];
  customGroups: CustomConversationGroup[];
  addCustomGroup: (name: string) => string | null;
  toggleConversationInCustomGroup: (
    customGroupId: string,
    conversationId: string,
  ) => void;
  clearUnreadByFilter: (filterId: string) => void;
}

export const useMessageGroupsStore = create<MessageGroupsState>((set) => ({
  conversations: INITIAL_CONVERSATIONS,
  customGroups: INITIAL_CUSTOM_GROUPS,
  addCustomGroup: (name) => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      return null;
    }

    const id = `custom-group-${Date.now()}`;

    set((state) => ({
      customGroups: [...state.customGroups, { id, name: trimmedName }],
    }));

    return id;
  },
  toggleConversationInCustomGroup: (customGroupId, conversationId) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        if (
          conversation.id !== conversationId ||
          conversation.conversationType !== 'group'
        ) {
          return conversation;
        }

        const currentIds = conversation.customGroupIds ?? [];
        const exists = currentIds.includes(customGroupId);

        return {
          ...conversation,
          customGroupIds: exists
            ? currentIds.filter((id) => id !== customGroupId)
            : [...currentIds, customGroupId],
        };
      }),
    }));
  },
  clearUnreadByFilter: (filterId) => {
    set((state) => ({
      conversations: state.conversations.map((conversation) => {
        const matches =
          filterId === 'all' ||
          filterId === 'unread' ||
          (filterId === 'group' && conversation.conversationType === 'group') ||
          (filterId === 'private' &&
            conversation.conversationType === 'private') ||
          (conversation.conversationType === 'group' &&
            (conversation.customGroupIds ?? []).includes(filterId));

        return matches ? { ...conversation, unreadCount: 0 } : conversation;
      }),
    }));
  },
}));
