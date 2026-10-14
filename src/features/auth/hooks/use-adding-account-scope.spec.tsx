import React from 'react';
import { render, renderHook } from '@testing-library/react-native';
import { useAccountSwitcherStore } from '@/stores/accountSwitcherStore';
import { useAddingAccountScope } from './use-adding-account-scope';

beforeEach(() => {
  useAccountSwitcherStore.setState({ addingAccount: false });
});

test('the add-account flag outlives screens pushed over the login page and ends when (auth) leaves the stack', () => {
  useAccountSwitcherStore.getState().setAddingAccount(true);
  const { rerender, unmount } = renderHook(() => useAddingAccountScope());

  // 登录页上叠了来电、横幅跳转等页面又返回:(auth) 一直在栈里,标记不能丢,
  // 否则守卫会把登录页换走、再挂一份 tabs。
  rerender({});
  expect(useAccountSwitcherStore.getState().addingAccount).toBe(true);

  // 登录成功退回 tabs 或用户返回放弃:(auth) 布局卸载,标记收回。
  unmount();
  expect(useAccountSwitcherStore.getState().addingAccount).toBe(false);
});

function AuthLayoutProbe() {
  useAddingAccountScope();
  return null;
}

test('a StrictMode effect replay does not drop the add-account flag', () => {
  useAccountSwitcherStore.getState().setAddingAccount(true);
  // renderHook 包 StrictMode 不会重放 effect;要用 render + 并发根才有「挂载→卸载→挂载」。
  render(
    <React.StrictMode>
      <AuthLayoutProbe />
    </React.StrictMode>,
    { concurrentRoot: true },
  );

  expect(useAccountSwitcherStore.getState().addingAccount).toBe(true);
});

test('a signed-out visit to the login page leaves the flag off', () => {
  const { unmount } = renderHook(() => useAddingAccountScope());
  expect(useAccountSwitcherStore.getState().addingAccount).toBe(false);
  unmount();
  expect(useAccountSwitcherStore.getState().addingAccount).toBe(false);
});
