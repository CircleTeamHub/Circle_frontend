import {apiClient} from '@/services/api/client';
export interface AppOpenMetadata {
  platform:'android'|'ios'|'web';
  appVersion:string;
  build:number;
  channel:'stable'|'beta';
  eventID:string;
}
export function recordAppOpen(body:AppOpenMetadata) {
  return apiClient<{recorded:boolean}>('/app-operations/open',{method:'POST',body});
}
export function getManagedUpdate(query:URLSearchParams) {
  return apiClient<unknown>(`/app-operations/update?${query}`,{auth:false});
}
