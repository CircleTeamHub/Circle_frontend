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
 * 服务端 send 限流 20 条/10s(按用户,与手动打字发送共用同一个桶)。
 * 计划消息数超过安全突发量后,每条之间停 600ms(≈1.6 条/s),把长批次压在
 * 限流之下 —— 触发限流的消息会被直接拒收,比慢一点糟得多。突发量取 12
 * 而不是贴着 20:同一个 10s 窗口里用户自己还可能在打字,给手动消息留余量。
 */
const NOTE_BATCH_SAFE_BURST = 12;
const NOTE_BATCH_PACED_DELAY_MS = 600;

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

/** 计划总量决定发送节奏：小批次全速，大批次匀速压在服务端限流之下。 */
export function notePacingDelayMs(totalTasks: number): number {
  return totalTasks > NOTE_BATCH_SAFE_BURST ? NOTE_BATCH_PACED_DELAY_MS : 0;
}
