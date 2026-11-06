import { create } from 'zustand';
import { useAuthStore } from '@/stores/authStore';
import { removePageSnapshot } from '@/storage/page-snapshots';

// Content stays behind authenticated APIs; realtime only invalidates local views.
export const useAnnouncementSignalStore = create<{version:number;bump:()=>void}>(set=>({
  version:0,
  bump:()=>{
    removePageSnapshot(useAuthStore.getState().user?.id, 'announcements:scrolling');
    set(state=>({version:state.version+1}));
  },
}));
