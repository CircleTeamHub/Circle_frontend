import { useAnnouncementSignalStore } from '../store-announcement-signal';
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import SystemAnnouncementDetailScreen from './SystemAnnouncementDetailScreen';
import {
  fetchProfileNotificationDetail,
  markNotificationRead,
} from '@/services/api/notifications';
import { reportHandledFailure } from '@/observability/report-failure';
import type { NotificationItem } from '@/types';
let mockOwner='user-a';
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({id:'notice-id'})}));
jest.mock('@/stores/authStore',()=>({useAuthStore:(selector:(state:unknown)=>unknown)=>selector({user:{id:mockOwner},sessionEpoch:1})}));
jest.mock('@/services/api/notifications',()=>({
  fetchProfileNotificationDetail:jest.fn(),
  markNotificationRead:jest.fn(),
}));
jest.mock('@/observability/report-failure',()=>({reportHandledFailure:jest.fn()}));
jest.mock('react-i18next',()=>({useTranslation:()=>({t:(key:string)=>key})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0})}));
jest.mock('@/components/ui/nav-header',()=>({NavHeader:()=>null}));
jest.mock('@/theme',()=>({Spacing:{lg:20,xl:24,md:12},useTheme:()=>({colors:{}})}));
const item={id:'notice-id',title:'维护通知',content:'完整正文\n'.repeat(200),createdAt:'2026-10-17T00:00:00Z',read:false} as NotificationItem;
beforeEach(()=>{
 jest.clearAllMocks();mockOwner='user-a';
 jest.mocked(markNotificationRead).mockResolvedValue();
});
test('loads full content and does not truncate the detail body',async()=>{
 jest.mocked(fetchProfileNotificationDetail).mockResolvedValue(item);render(<SystemAnnouncementDetailScreen />);
 const body=await screen.findByText(item.content);expect(body.props.numberOfLines).toBeUndefined();expect(screen.getByText(item.title!)).toBeTruthy();
 expect(fetchProfileNotificationDetail).toHaveBeenCalledWith('notice-id');
});
test('marks an unread direct detail once and reports failure without hiding content',async()=>{
 const failure=new Error('mark failed');
 jest.mocked(fetchProfileNotificationDetail).mockResolvedValue({...item,read:false});
 jest.mocked(markNotificationRead).mockRejectedValue(failure);
 render(<SystemAnnouncementDetailScreen />);

 expect(await screen.findByText(item.content)).toBeTruthy();
 await waitFor(()=>expect(markNotificationRead).toHaveBeenCalledTimes(1));
 expect(markNotificationRead).toHaveBeenCalledWith('notice-id');
 await waitFor(()=>expect(reportHandledFailure).toHaveBeenCalledWith('profile','announcementMarkRead',failure));
 expect(screen.getByText(item.content)).toBeTruthy();
});
test('does not mark an already-read direct detail',async()=>{
 jest.mocked(fetchProfileNotificationDetail).mockResolvedValue({...item,read:true});
 render(<SystemAnnouncementDetailScreen />);

 expect(await screen.findByText(item.content)).toBeTruthy();
 expect(markNotificationRead).not.toHaveBeenCalled();
});
test('offers retry if the detail cannot be loaded',async()=>{
 jest.mocked(fetchProfileNotificationDetail).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(item);render(<SystemAnnouncementDetailScreen />);
 fireEvent.press(await screen.findByText('common.retry'));expect(await screen.findByText(item.title!)).toBeTruthy();
});
test('does not display an old account response after account switching',async()=>{
 let resolve!: (value:NotificationItem)=>void;
 jest.mocked(fetchProfileNotificationDetail).mockReturnValueOnce(new Promise(r=>{resolve=r;})).mockRejectedValueOnce(new Error('not owned'));
 const view=render(<SystemAnnouncementDetailScreen />);mockOwner='user-b';view.rerender(<SystemAnnouncementDetailScreen />);
 await act(async()=>{resolve({...item,read:false});});expect(screen.queryByText(item.content)).toBeNull();
 expect(markNotificationRead).not.toHaveBeenCalled();
});

test('does not report an old mark-read rejection after account switching',async()=>{
 let rejectMark!: (reason:unknown)=>void;
 jest.mocked(fetchProfileNotificationDetail)
   .mockResolvedValueOnce({...item,read:false})
   .mockResolvedValueOnce({...item,read:true});
 jest.mocked(markNotificationRead).mockReturnValueOnce(new Promise((_,reject)=>{rejectMark=reject;}));
 const view=render(<SystemAnnouncementDetailScreen />);
 expect(await screen.findByText(item.content)).toBeTruthy();
 await waitFor(()=>expect(markNotificationRead).toHaveBeenCalledTimes(1));

 mockOwner='user-b';
 view.rerender(<SystemAnnouncementDetailScreen />);
 await act(async()=>{rejectMark(new Error('old session'));});

 expect(reportHandledFailure).not.toHaveBeenCalled();
});


test('replaces an open detail after a realtime edit without showing its stale body',async()=>{
 let resolve!: (value:NotificationItem)=>void;
 jest.mocked(fetchProfileNotificationDetail).mockResolvedValueOnce(item).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
 render(<SystemAnnouncementDetailScreen />);await screen.findByText(item.content);
 act(()=>useAnnouncementSignalStore.getState().bump());expect(screen.queryByText(item.content)).toBeNull();
 await act(async()=>{resolve({...item,title:'更新后的标题',content:'更新后的正文',read:false});});expect(screen.getByText('更新后的正文')).toBeTruthy();
});
