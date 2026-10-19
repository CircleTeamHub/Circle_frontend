import { decryptText } from './client';
import type { EncryptedContent } from '@circle/e2ee/relay-client.mjs';
let mockEpoch = 0;
const mockResolve = jest.fn();
const mockDecrypt = jest.fn();
const mockMessage = jest.fn();
const mockDevice = {deviceId:'local', purgeMessages:jest.fn().mockResolvedValue(undefined), message:mockMessage, messagePage:jest.fn().mockResolvedValue([])};
jest.mock('@circle/e2ee', () => ({ ProtocolDevice: {open: async () => mockDevice} }));
jest.mock('@circle/e2ee/relay-client.mjs', () => ({EncryptionClient: class {
  device = mockDevice;
  run = (work: () => unknown) => work();
  resolveMessages = mockResolve;
  decrypt = mockDecrypt;
}}));
jest.mock('./journal', () => ({openDeviceJournal: async () => ({deviceId:'local',close:jest.fn()})}));
jest.mock('@/services/api/client', () => ({apiClient:jest.fn()}));
jest.mock('@/services/auth/session', () => ({registerLogoutHandler:jest.fn()}));
jest.mock('@/stores/authStore', () => ({useAuthStore:{getState:()=>({user:{id:'alice'},sessionEpoch:mockEpoch})}}));
const content = (id:string) => ({envelope:{conversationId:'room',senderDeviceId:'local',clientMessageId:id,ciphertext:id},signature:'proof'}) as EncryptedContent;
beforeEach(()=>{
 mockEpoch++;
 jest.clearAllMocks();
 mockMessage.mockResolvedValue(undefined);
 mockResolve.mockImplementation(async refs => refs.map((ref:unknown)=>({ref,expiresAt:null})));
 mockDecrypt.mockImplementation(async (value:EncryptedContent) => ({text:value.envelope.clientMessageId}));
});
it('resolves a mounted page of encrypted bubbles in one request',async()=>{
 const result=await Promise.all(Array.from({length:10},(_,i)=>decryptText(content(String(i)))));
 expect(mockResolve).toHaveBeenCalledTimes(1);
 expect(mockResolve.mock.calls[0][0]).toHaveLength(10);
 expect(result[9]).toEqual({text:'9'});
});
it('keeps locally authored pending or failed messages readable without server lookup',async()=>{
 mockMessage.mockResolvedValue({ciphertext:'pending',body:{text:'local text'}});
 await expect(decryptText(content('pending'),true)).resolves.toEqual({text:'local text'});
 expect(mockResolve).not.toHaveBeenCalled();
});
it('limits visibility batches to the endpoint maximum',async()=>{
 await Promise.all(Array.from({length:21},(_,i)=>decryptText(content(String(i)))));
 expect(mockResolve.mock.calls.map(call=>call[0].length)).toEqual([20,1]);
});
