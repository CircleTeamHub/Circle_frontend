# Profile Edit Flow

## Goal

Restore editable profile fields in account settings using a single reusable edit screen.

## Scope

- Keep account settings UI unchanged except for row tap behavior.
- Add one reusable editor for supported text fields.
- Save through the existing profile PATCH API.
- Update `authStore` immediately after a successful save.
- Keep unsupported rows non-functional but explicit with alerts.

## Editable fields

- 昵称
- 性别
- 生日
- 个人简介
- 绑定微信
- 绑定手机号
- 绑定QQ号

## Unsupported for now

- 头像
- 头像框
- 修改登录密码
- 登录安全码

## Files

- `src/features/profile/profile-edit-config.ts`
- `src/features/profile/screens/EditProfileFieldScreen.tsx`
- `src/features/profile/screens/SettingsScreen.tsx`
- `src/features/profile/index.ts`
- `app/(tabs)/profile/edit/[field].tsx`
- `test/profile-edit-config.test.js`
