import { useEffect, useRef } from 'react';
import { useAccountSwitcherStore } from '@/stores/accountSwitcherStore';

/**
 * 「添加账号」标记的生命周期 = (auth) 分组在导航栈里的这段时间。由 (auth) 布局调用。
 *
 * 不按「当前聚焦的是不是 (auth)」收回:登录页上叠了来电、横幅跳转等页面再返回时,
 * (auth) 一直在栈里,提前收回会让守卫把登录页换走、再挂一份 tabs。布局卸载才说明
 * (auth) 真的离开了栈(登录成功退回 tabs,或用户返回放弃)。
 */
export function useAddingAccountScope(): void {
  // 记下挂载那一刻的标记:StrictMode 的「卸载→重挂」重放会先跑一次清理,重挂时恢复它。
  const addingAtMountRef = useRef(useAccountSwitcherStore.getState().addingAccount);

  useEffect(() => {
    const { setAddingAccount } = useAccountSwitcherStore.getState();
    if (addingAtMountRef.current) setAddingAccount(true);
    return () => setAddingAccount(false);
  }, []);
}
