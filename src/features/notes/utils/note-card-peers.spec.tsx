import { buildNoteSectionsWithCards, resolveNoteCardButtons } from './note-card-peers';

const collectedFrom = {
  conversationType: 'group' as const,
  conversationID: 'source-chat',
  clientMsgID: 'source-message',
  sender: { id: 'sender', name: 'Sender', faceURL: 'sender.jpg' },
  group: { id: 'source-circle', name: 'Source group', faceURL: 'group.jpg' },
};

test('collection defaults become real card sections with the same names, avatars and destinations as list buttons', () => {
  const note = { collectedFrom, cardPreview: null };
  const sections = buildNoteSectionsWithCards(note);
  expect(sections.contacts.items).toEqual([collectedFrom.sender]);
  expect(sections.groups.items).toEqual([{ ...collectedFrom.group, conversationID: 'source-chat' }]);
  expect(resolveNoteCardButtons({ ...note, sections })).toEqual(resolveNoteCardButtons(note));
});

test('saved card sections win over stale summaries and collection defaults', () => {
  const contact = { id: 'configured-person', name: 'Configured person', faceURL: 'person.jpg' };
  const group = { id: 'configured-chat', name: 'Configured group', faceURL: 'configured.jpg', conversationID: 'configured-chat' };
  const note = { collectedFrom, cardPreview: { contacts: [collectedFrom.sender], groups: [collectedFrom.group] },
    sections: { contacts: { items: [contact] }, groups: { items: [group] } } };
  const sections = buildNoteSectionsWithCards(note);
  expect(sections.contacts.items).toEqual([contact]);
  expect(sections.groups.items).toEqual([group]);
  expect(resolveNoteCardButtons({ ...note, sections })).toMatchObject({ contact, group });
});

test('an empty saved card section uses collection defaults instead of a stale preview', () => {
  const note = { collectedFrom, cardPreview: { contacts: [{ id: 'old', name: 'Old' }], groups: [] },
    sections: { contacts: { items: [] }, groups: { items: [] } } };
  expect(buildNoteSectionsWithCards(note).contacts.items).toEqual([collectedFrom.sender]);
});

test('a standalone group keeps its server conversation ID and a note with no cards or source stays empty', () => {
  const group = { id: 'chat', conversationID: 'chat', name: 'Standalone' };
  expect(buildNoteSectionsWithCards({ cardPreview: { contacts: [], groups: [group] } }).groups.items).toEqual([expect.objectContaining(group)]);
  const sections = buildNoteSectionsWithCards({});
  expect(sections.contacts.items).toEqual([]);
  expect(sections.groups.items).toEqual([]);
});

test('a legacy group card uses the canonical circle ID in its section and list button', () => {
  const legacy = { id: 'old-group-id', circleId: 'canonical-circle', name: 'Legacy group' };
  const note = { sections: { groups: { items: [legacy] } } };
  expect(buildNoteSectionsWithCards(note).groups.items[0].id).toBe(resolveNoteCardButtons(note).group?.id);
});
