import type { NoteCardPeer, NoteSummary } from '@/features/notes/types';
import { buildNoteSections, type StructuredNoteInput } from './note-sections';

/** 卡片底部按钮的跳转目标：个人名片 → 私聊，群名片 → 群聊。 */
export interface NoteCardButton {
  id: string;
  name: string;
  faceURL: string | null;
  /** 与收藏来源是同一个人/群时带上原会话，进聊天可直接落到那条会话。 */
  conversationID?: string;
  /** 与收藏来源群一致时带上原消息 id，进群直接定位到笔记原消息。 */
  clientMsgID?: string;
  /**
   * 群按钮去哪：收藏来源群和独立群（服务端标注了会话 id）直接进群聊；其余圈子群
   * 进圈子详情，与详情页群名片同一口径 —— 收藏者未必是那个圈子的成员，直接进群聊
   * 只会卡在预览。个人名片恒为 chat。
   */
  target: 'chat' | 'circle';
}

export interface NoteCardButtons {
  contact: NoteCardButton | null;
  group: NoteCardButton | null;
}

type CardSource = Pick<NoteSummary, 'cardPreview' | 'collectedFrom'> & Pick<StructuredNoteInput, 'sections'>;
type CardPeer = NoteCardPeer & { avatarUrl?: string | null };

function firstValid(peers: readonly CardPeer[] | undefined): CardPeer | null {
  return peers?.find((peer) => Boolean(peer?.id && peer.name)) ?? null;
}

/**
 * 笔记卡片底部的两个按钮只展示笔记里的「个人名片」和「群名片」，两个按钮各自判断：
 * - 笔记里有这张名片 → 展示名片；
 * - 没有、但笔记是从聊天收藏来的 → 默认用来源发送方 / 来源群；
 * - 自己写的笔记没有 → 不展示。
 * 名片与收藏来源是同一个人/群时带上原会话（群还带原消息，进群直接定位）。
 * 缺 id 或名称的历史坏数据不渲染。
 */
export function resolveNoteCardButtons(note: CardSource): NoteCardButtons {
  const from = note.collectedFrom ?? null;
  const sourceSender = from?.sender?.id && from.sender.name ? from.sender : null;
  const sourceGroup =
    from?.conversationType === 'group' && from.group?.id && from.group.name ? from.group : null;

  const contact: CardPeer | null = firstValid(note.sections?.contacts?.items ?? note.cardPreview?.contacts) ?? sourceSender;
  const group: CardPeer | null = firstValid(note.sections?.groups?.items ?? note.cardPreview?.groups) ?? sourceGroup;
  const contactIsSource =
    contact !== null && from?.conversationType === 'private' && sourceSender?.id === contact.id;
  const groupConversationID =
    group && 'conversationID' in group && typeof group.conversationID === 'string' && group.conversationID
      ? group.conversationID
      : null;
  // 旧版圈子卡片的 id 是 OpenIM groupID，路由要用服务端给的规范圈子 UUID。
  const groupCircleId =
    group && 'circleId' in group && typeof group.circleId === 'string' && group.circleId
      ? group.circleId
      : null;
  const groupIsSource =
    group !== null &&
    sourceGroup !== null &&
    (sourceGroup.id === group.id || sourceGroup.id === groupCircleId);

  return {
    contact: contact
      ? {
          id: contact.id,
          name: contact.name,
          faceURL: contact.faceURL || contact.avatarUrl || null,
          target: 'chat',
          ...(contactIsSource && from ? { conversationID: from.conversationID } : {}),
        }
      : null,
    group: group
      ? {
          id: groupCircleId ?? group.id,
          name: group.name,
          faceURL: group.faceURL || group.avatarUrl || null,
          target: groupIsSource || groupConversationID ? 'chat' : 'circle',
          // 独立群名片由服务端标注会话 id（卡片 id 不是圈子 id），必须按会话进群；
          // 与收藏来源是同一个群时还带原消息 id，进群直接定位。
          ...(groupIsSource && from
            ? { conversationID: from.conversationID, clientMsgID: from.clientMsgID }
            : groupConversationID
              ? { conversationID: groupConversationID }
              : {}),
        }
      : null,
  };
}

/** 编辑器、浏览页和列表使用同一名片来源；缺省名片随编辑保存到真实分区。 */
export function buildNoteSectionsWithCards(note: CardSource & StructuredNoteInput) {
  const sections = buildNoteSections(note);
  const { contact, group } = resolveNoteCardButtons(note);
  return {
    ...sections,
    contacts: { items: sections.contacts.items.length ? sections.contacts.items : contact
      ? [{ id: contact.id, name: contact.name, faceURL: contact.faceURL }]
      : [] },
    groups: { items: group ? [
      {
        ...(sections.groups.items[0] ?? { id: group.id, name: group.name, faceURL: group.faceURL }),
        id: group.id,
        ...(group.conversationID ? { conversationID: group.conversationID } : {}),
      },
      ...sections.groups.items.slice(1),
    ] : [] },
  };
}
