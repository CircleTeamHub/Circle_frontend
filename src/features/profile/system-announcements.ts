export const SYSTEM_ANNOUNCEMENTS = [
  {
    id: 'latestAppInfo',
    titleKey: 'systemAnnouncements.latestAppInfo.title',
    metaKey: 'systemAnnouncements.latestAppInfo.meta',
    bodyKey: 'systemAnnouncements.latestAppInfo.body',
  },
  {
    id: 'updates',
    titleKey: 'systemAnnouncements.updates.title',
    metaKey: 'systemAnnouncements.updates.meta',
    bodyKey: 'systemAnnouncements.updates.body',
  },
  {
    id: 'patches',
    titleKey: 'systemAnnouncements.patches.title',
    metaKey: 'systemAnnouncements.patches.meta',
    bodyKey: 'systemAnnouncements.patches.body',
  },
] as const;

export function getSystemAnnouncement(id: string | undefined) {
  return SYSTEM_ANNOUNCEMENTS.find((announcement) => announcement.id === id);
}
