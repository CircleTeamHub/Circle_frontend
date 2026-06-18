// 统一的 LiveKit globals 注册入口：保证 registerGlobals 在整个 App 生命周期内只执行一次，
// 避免启动时（app/_layout.tsx）与进入通话页时（GroupCallScreen）重复注册 WebRTC globals。

let registered = false;

export function ensureLiveKitGlobals(registerGlobals: () => void): void {
  if (registered) {
    return;
  }
  registerGlobals();
  registered = true;
}
