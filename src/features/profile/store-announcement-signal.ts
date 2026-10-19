import { create } from 'zustand';

// Content stays behind authenticated APIs; realtime only invalidates local views.
export const useAnnouncementSignalStore = create<{version:number;bump:()=>void}>(set=>({
  version:0,
  bump:()=>set(state=>({version:state.version+1})),
}));
