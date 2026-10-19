import { useAnnouncementSignalStore } from '../store-announcement-signal';
import React from 'react';
import { Animated, AppState, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollingAnnouncements } from './ScrollingAnnouncements';
import { fetchScrollingAnnouncements } from '@/services/api/notifications';
const mockPush = jest.fn();
let mockOwner = 'user-a';
let mockReduceMotion = true;
jest.mock('expo-router', () => ({ useRouter:()=>({push:mockPush}), useFocusEffect: (cb: () => void) => { const React = jest.requireActual<typeof import('react')>('react'); React.useEffect(cb, [cb]); } }));
jest.mock('@/stores/authStore', () => ({useAuthStore: (select: (state: unknown) => unknown) => select({user:{id:mockOwner},sessionEpoch:1})}));
jest.mock('@/services/api/notifications', () => ({fetchScrollingAnnouncements:jest.fn()}));
jest.mock('@/hooks/use-reduce-motion', () => ({useReduceMotion:()=>mockReduceMotion}));
jest.mock('@/observability/report-failure', () => ({reportHandledFailure:jest.fn()}));
jest.mock('react-i18next', () => ({useTranslation:()=>({t:(key:string)=>key})}));
jest.mock('react-native-safe-area-context', () => ({useSafeAreaInsets:()=>({top:0,bottom:0})}));
jest.mock('@expo/vector-icons',()=>({Ionicons:()=>null}));
jest.mock('@/theme',()=>({useTheme:()=>({colors:{primary:'#6855ee'}}),withAlpha:()=> '#eee'}));
const notice={id:'1',notificationID:'notification-1',title:'第一条公告',content:'完整公告正文',createdAt:'2026-10-17T00:00:00Z'};
beforeEach(()=>{jest.clearAllMocks();mockOwner='user-a';mockReduceMotion=true;AppState.currentState='active';});
test('hides the banner when no announcement is selected',async()=>{
 jest.mocked(fetchScrollingAnnouncements).mockResolvedValue([]);
 const view=render(<ScrollingAnnouncements />);await act(async()=>{});expect(view.toJSON()).toBeNull();
});
test('shows title and body together and opens the shared detail page',async()=>{
 jest.mocked(fetchScrollingAnnouncements).mockResolvedValue([notice]);
 render(<ScrollingAnnouncements />);
 const label='第一条公告：完整公告正文';
 await screen.findByText(label);
 fireEvent.press(screen.getByRole('button',{name:label}));
 expect(mockPush).toHaveBeenCalledWith({pathname:'/(tabs)/profile/system-announcements/[id]',params:{id:'notification-1'}});
});
test('discards a late response from the previous account',async()=>{
 let resolve!: (value: typeof notice[])=>void;
 jest.mocked(fetchScrollingAnnouncements).mockReturnValueOnce(new Promise(r=>{resolve=r;})).mockResolvedValueOnce([]);
 const view=render(<ScrollingAnnouncements />);mockOwner='user-b';view.rerender(<ScrollingAnnouncements />);
 await act(async()=>{resolve([notice]);});expect(screen.queryByText('第一条公告：完整公告正文')).toBeNull();
});

test('scrolls overflowing text horizontally and stops the animation on unmount',async()=>{
 mockReduceMotion=false;
 const animation={start:jest.fn(),stop:jest.fn(),reset:jest.fn()};
 const loop=jest.spyOn(Animated,'loop').mockReturnValue(animation);
 jest.mocked(fetchScrollingAnnouncements).mockResolvedValue([notice]);
 const view=render(<ScrollingAnnouncements />);
 try {
  await screen.findByText('第一条公告：完整公告正文');
  const viewport=screen.UNSAFE_getAllByType(View).find(node=>node.props.onLayout);
  fireEvent(viewport!,'layout',{nativeEvent:{layout:{width:100,height:30,x:0,y:0}}});
  const measurement=screen.getByText('第一条公告：完整公告正文');
  fireEvent(measurement,'layout',{nativeEvent:{layout:{width:600,height:20,x:0,y:0}}});
  expect(animation.start).toHaveBeenCalled();
  view.unmount();expect(animation.stop).toHaveBeenCalled();
 } finally {loop.mockRestore();}
});

test('does not animate when the full text already fits',async()=>{
 mockReduceMotion=false;
 const loop=jest.spyOn(Animated,'loop');
 jest.mocked(fetchScrollingAnnouncements).mockResolvedValue([notice]);
 const view=render(<ScrollingAnnouncements />);
 try {
  const label=await screen.findByText('第一条公告：完整公告正文');
  const viewport=screen.UNSAFE_getAllByType(View).find(node=>node.props.onLayout);
  fireEvent(viewport!,'layout',{nativeEvent:{layout:{width:300,height:30,x:0,y:0}}});
  fireEvent(label,'layout',{nativeEvent:{layout:{width:100,height:20,x:0,y:0}}});
  expect(loop).not.toHaveBeenCalled();
 } finally {view.unmount();loop.mockRestore();}
});


test('immediately removes the old banner on a realtime invalidation',async()=>{
 let resolve!: (value:typeof notice[])=>void;
 jest.mocked(fetchScrollingAnnouncements).mockResolvedValueOnce([notice]).mockReturnValueOnce(new Promise(r=>{resolve=r;}));
 render(<ScrollingAnnouncements />);await screen.findByText('第一条公告：完整公告正文');
 act(()=>useAnnouncementSignalStore.getState().bump());expect(screen.queryByText('第一条公告：完整公告正文')).toBeNull();
 await act(async()=>{resolve([]);});expect(fetchScrollingAnnouncements).toHaveBeenCalledTimes(2);
});
