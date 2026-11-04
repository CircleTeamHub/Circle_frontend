import { useFriendRemarkStore } from './friendRemarkStore';
import type { FriendProfile } from '@/services/api/friends';

const friend = (remark: string | null) => ({ id: 'peer', nickname: 'Original name', remark }) as FriendProfile;

beforeEach(() => useFriendRemarkStore.getState().reset());

test('server sync restores saved remarks and skips new empty entries', () => {
  const snapshot = useFriendRemarkStore.getState().remarks;
  useFriendRemarkStore.getState().syncServerRemarks([friend('  Saved name  '), { ...friend(null), id: 'other' }], snapshot);
  expect(useFriendRemarkStore.getState().remarks.peer).toEqual({ remark: 'Saved name', fallbackName: 'Original name' });
  expect(useFriendRemarkStore.getState().remarks.other).toBeUndefined();
});

test('an older server response cannot overwrite a remark saved while it was loading', () => {
  const snapshot = useFriendRemarkStore.getState().remarks;
  useFriendRemarkStore.getState().setRemark('peer', 'New local name', 'Original name');
  useFriendRemarkStore.getState().syncServerRemarks([friend('Old server name')], snapshot);
  expect(useFriendRemarkStore.getState().remarks.peer?.remark).toBe('New local name');
});

test('an older response cannot restore a remark cleared while it was loading', () => {
  useFriendRemarkStore.getState().setRemark('peer', 'Old name', 'Original name');
  const snapshot = useFriendRemarkStore.getState().remarks;
  useFriendRemarkStore.getState().setRemark('peer', null, 'Original name');
  useFriendRemarkStore.getState().syncServerRemarks([friend('Old name')], snapshot);
  expect(useFriendRemarkStore.getState().remarks.peer?.remark).toBeNull();
});

test('server refresh can update or clear an unchanged remark and preserve its fallback', () => {
  useFriendRemarkStore.getState().setRemark('peer', 'Old name', 'Original name');
  useFriendRemarkStore.getState().syncServerRemarks([friend('Remote name')], useFriendRemarkStore.getState().remarks);
  expect(useFriendRemarkStore.getState().remarks.peer?.remark).toBe('Remote name');
  useFriendRemarkStore.getState().syncServerRemarks([friend(null)], useFriendRemarkStore.getState().remarks);
  expect(useFriendRemarkStore.getState().remarks.peer).toEqual({ remark: null, fallbackName: 'Original name' });
});
