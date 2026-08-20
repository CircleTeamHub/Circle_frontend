import type {
  NoteChatMediaImportItem,
  NoteChatMediaSection,
  NoteLocationSection,
  NoteSummary,
} from '../../notes/types';

/**
 * 批量发笔记的「发什么」选项（选择器 sheet 的五个勾选项；「全部发送」
 * 是派生态 = 四项全开，不单独落字段）。
 */
export interface NoteSendOptions {
  /** 笔记卡片本体 */
  card: boolean;
  /** 「图片 · 视频」区的媒体，逐条转成 image/video 消息 */
  media: boolean;
  /** 「展示」区的媒体（用户口中的「验证」） */
  showcase: boolean;
  /** 「地址」区，转成 location 消息 */
  location: boolean;
}

export type { NoteChatMediaSection } from '../../notes/types';

/** 服务端拷贝返回的单条（wire 类型收在 notes/types，这里只是习惯性别名）。 */
export type ImportedNoteChatMedia = NoteChatMediaImportItem;

export interface SendableNoteLocation {
  latitude: number;
  longitude: number;
  title?: string;
  address?: string;
}

export type NoteSendTask =
  | { kind: 'note-card'; note: NoteSummary }
  | {
      kind: 'image';
      noteId: string;
      key: string;
      width?: number;
      height?: number;
    }
  | {
      kind: 'video';
      noteId: string;
      key: string;
      width?: number;
      height?: number;
      /** 秒（消息契约与拍摄上传路径一致：ms 上取整、至少 1s） */
      duration?: number;
      size?: number;
    }
  | {
      kind: 'location';
      noteId: string;
      latitude: number;
      longitude: number;
      title?: string;
      address?: string;
    };

/** 一次最多勾选的笔记数（对齐常见 IM 转发上限，也约束批量消息总量）。 */
export const MAX_NOTE_BATCH_SELECTION = 9;

/**
 * 服务端 send 桶是 20 条/10s（按用户，手动消息与批量共用）。批量最多占 17
 * 个槽位，始终给用户自己发送保留 3 个；时间戳由屏幕级 ref 跨批保存。
 */
export const NOTE_BATCH_SEND_WINDOW_LIMIT = 17;
export const NOTE_BATCH_SEND_WINDOW_MS = 10_000;

export function hasAnyNoteSendOption(options: NoteSendOptions): boolean {
  return options.card || options.media || options.showcase || options.location;
}

export function isAllNoteSendOptions(options: NoteSendOptions): boolean {
  return options.card && options.media && options.showcase && options.location;
}

export function withAllNoteSendOptions(
  options: NoteSendOptions,
  value: boolean,
): NoteSendOptions {
  return { ...options, card: value, media: value, showcase: value, location: value };
}

/** 需要向服务端申请拷贝的分区（只有媒体类分区需要）。 */
export function sectionsToImport(options: NoteSendOptions): NoteChatMediaSection[] {
  const sections: NoteChatMediaSection[] = [];
  if (options.media) sections.push('media');
  if (options.showcase) sections.push('showcase');
  return sections;
}

function trimmedLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * 笔记地址区 → 可发送的位置消息参数。经纬度必须都是范围内的有限数,
 * 缺一个都不发(发出去会渲染成指向 (0,0) 的废卡片)。
 */
export function resolveSendableNoteLocation(
  section: NoteLocationSection | null | undefined,
): SendableNoteLocation | null {
  if (!section) return null;
  const { latitude, longitude } = section;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) return null;
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  const title = trimmedLabel(section.title);
  const address = trimmedLabel(section.address);
  return {
    latitude,
    longitude,
    ...(title ? { title } : {}),
    ...(address ? { address } : {}),
  };
}

function finitePositive(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/**
 * 单条笔记按选项展开成有序发送任务:卡片 → 媒体(服务端拷贝返回的顺序,
 * 按 key 去重 —— 同一对象可能同时躺在「图片·视频」和「展示」两个分区) → 地址。
 */
export function buildNoteSendTasks(
  note: NoteSummary,
  options: NoteSendOptions,
  imported: ImportedNoteChatMedia[],
  location: NoteLocationSection | null | undefined,
): NoteSendTask[] {
  const tasks: NoteSendTask[] = [];
  if (options.card) {
    tasks.push({ kind: 'note-card', note });
  }

  const seenKeys = new Set<string>();
  for (const item of imported) {
    if (!item.key || seenKeys.has(item.key)) continue;
    seenKeys.add(item.key);
    if (item.type === 'VIDEO') {
      const durationMs = finitePositive(item.durationMs);
      tasks.push({
        kind: 'video',
        noteId: note.id,
        key: item.key,
        width: finitePositive(item.width),
        height: finitePositive(item.height),
        duration: durationMs ? Math.max(1, Math.ceil(durationMs / 1000)) : undefined,
        size: finitePositive(item.size),
      });
    } else {
      tasks.push({
        kind: 'image',
        noteId: note.id,
        key: item.key,
        width: finitePositive(item.width),
        height: finitePositive(item.height),
      });
    }
  }

  if (options.location) {
    const sendable = resolveSendableNoteLocation(location);
    if (sendable) {
      tasks.push({ kind: 'location', noteId: note.id, ...sendable });
    }
  }

  return tasks;
}

function recentNoteSendAttempts(
  attempts: readonly number[],
  now: number,
): number[] {
  const cutoff = now - NOTE_BATCH_SEND_WINDOW_MS;
  return attempts
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > cutoff)
    .sort((left, right) => left - right);
}

/** 当前滚动窗口没有批量发送槽位时，还需等待多少毫秒。 */
export function noteSendWindowDelayMs(
  attempts: readonly number[],
  now: number,
): number {
  const recent = recentNoteSendAttempts(attempts, now);
  if (recent.length < NOTE_BATCH_SEND_WINDOW_LIMIT) return 0;
  const blockingAttempt = recent[recent.length - NOTE_BATCH_SEND_WINDOW_LIMIT];
  return Math.max(0, Math.ceil(blockingAttempt + NOTE_BATCH_SEND_WINDOW_MS - now));
}

/** 在拿到槽位后记录本次尝试，同时丢弃窗口外的旧时间戳。 */
export function recordNoteSendAttempt(
  attempts: readonly number[],
  now: number,
): number[] {
  return [...recentNoteSendAttempts(attempts, now), now];
}
