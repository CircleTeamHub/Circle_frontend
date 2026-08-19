function dynamicTestId(prefix: string, identifier: string): string {
  const normalized = identifier.trim();
  if (!normalized) throw new Error(`Cannot build ${prefix} testID without an identifier.`);
  return `${prefix}.${normalized}`;
}

export const E2E_TEST_IDS = Object.freeze({
  authLoginScreen: 'windnote.auth.login.screen',
  authPasswordMode: 'windnote.auth.login.mode.password',
  authCodeMode: 'windnote.auth.login.mode.code',
  authEmailInput: 'windnote.auth.login.email-input',
  authPasswordInput: 'windnote.auth.login.password-input',
  authCodeInput: 'windnote.auth.login.code-input',
  authSendCode: 'windnote.auth.login.send-code',
  authSubmit: 'windnote.auth.login.submit',
  tabsMessages: 'windnote.tabs.messages',
  tabsContacts: 'windnote.tabs.contacts',
  tabsDiscover: 'windnote.tabs.discover',
  tabsProfile: 'windnote.tabs.profile',
  messagesScreen: 'windnote.messages.screen',
  messagesList: 'windnote.messages.conversation-list',
  messagesConversation: (id: string) =>
    dynamicTestId('windnote.messages.conversation', id),
  chatScreen: 'windnote.chat.screen',
  chatBack: 'windnote.chat.back',
  chatMessageList: 'windnote.chat.message-list',
  chatInput: 'windnote.chat.composer.input',
  chatSend: 'windnote.chat.composer.send',
  contactsScreen: 'windnote.contacts.screen',
  contactsAddFriend: 'windnote.contacts.add-friend',
  discoverScreen: 'windnote.discover.screen',
  discoverFilterTab: (index: string) =>
    dynamicTestId('windnote.discover.filter-tab', index),
  discoverCirclesAction: 'windnote.discover.circles-action',
  discoverFab: 'windnote.discover.fab',
  momentCreateScreen: 'windnote.moment.create.screen',
  momentContentInput: 'windnote.moment.create.content-input',
  momentPublish: 'windnote.moment.create.publish',
  momentDetailScreen: 'windnote.moment.detail.screen',
  momentDelete: 'windnote.moment.detail.delete',
  momentOwnRow: (id: string) => dynamicTestId('windnote.moment.own-row', id),
  profileScreen: 'windnote.profile.screen',
  profileSettings: 'windnote.profile.settings',
  settingsScreen: 'windnote.settings.screen',
  settingsRow: (id: string) => dynamicTestId('windnote.settings.row', id),
  settingsLogout: 'windnote.settings.logout',
  profileEditScreen: 'windnote.profile.edit.screen',
  profileEditInput: 'windnote.profile.edit.input',
  profileEditSave: 'windnote.profile.edit.save',
  settingsDetailScreen: (name: string) =>
    dynamicTestId('windnote.settings-detail.screen', name),
  settingsDetailRow: (id: string) =>
    dynamicTestId('windnote.settings-detail.row', id),
  addFriendScreen: 'windnote.friend-search.screen',
  addFriendInput: 'windnote.friend-search.input',
  addFriendResult: (id: string) => dynamicTestId('windnote.friend-search.result', id),
  userProfileScreen: 'windnote.user-profile.screen',
  circleSearchScreen: 'windnote.circle-search.screen',
  circleSearchInput: 'windnote.circle-search.input',
  circleSearchResult: (id: string) => dynamicTestId('windnote.circle-search.result', id),
  circleDetailScreen: 'windnote.circle-detail.screen',
  circleChatEntry: 'windnote.circle-detail.chat-entry',
});
