# Messages header icons — design

Decided with the product owner on 2026-11-12. The four buttons at the top right of the
messages tab (circle notifications, select chats, search, quick-add `+`) get new glyphs
**and** a new drawing style. The owner found the current set ugly; it is a 4px-stroke
lucide set (`Blend`, `CheckCheck`, `Search`) plus a hand-built `+`, visibly heavier than the
thin Ionicons used everywhere else (tab bar, contacts header), with mixed sizes (22/22/24/24).

## Goals

- One coherent, in-brand icon family for the four header buttons.
- Lighter weight that sits well next to the 32px bold "消息" title, in light and dark themes.

## Non-goals

- No behaviour change: same four buttons, same order, same handlers, same accessibility
  labels, same circle-notification badge, same `+` → `×` rotation when the quick menu opens.
- No change to the quick-add menu items, the filter tabs, or the selection-mode header.
- No new icon library; lucide stays (the announcement banner still uses it).

## Constraints (from earlier rounds)

- Circle notifications must not be a bell.
- No tiny satellite dots (the earlier `Orbit` attempt smeared at heavy stroke).

## Approaches

Previewed side by side at real size in light and dark headers:

| | Style | Trade-off |
|---|---|---|
| A · 轻线 | Bare 2px rounded line | Matches the Ionicons weight; quietest, least personality |
| **B · 双色 (picked)** | 2px line + a soft same-colour tint on one area per glyph | Mirrors the tab bar's `PlaneLogoIcon` (stroke + ~28% fill); in-brand and still light |
| C · 圆底按钮 | A's glyphs inside 36px grey round chips | Most button-like, but four chips make the title row heavy and wider |

The owner picked **B**.

## Design (B · 双色)

All glyphs on a 24×24 grid, drawn with `react-native-svg`, rendered at 24px, `stroke = color`,
2px stroke, round caps and joins. Tints are the icon colour at low opacity, so both themes
work without extra tokens.

| Button | Glyph | Tint |
|---|---|---|
| Circle notifications | A full ring (r 9, centred) with a small paper plane inside it (1.75 stroke). The 圈子 tab already uses the paper plane. A plane flying out of a gap in the ring was tried on device and rejected: the part poking out looked off. | Plane wings, 30% |
| Select chats | Two list rows: top row a solid dot with a knocked-out check, bottom row an empty ring; a short line after each | Empty ring, 22% |
| Search | Magnifier, lens r 6.5, handle 1.3× stroke, a small highlight arc inside the lens | Lens, 14% |
| Quick add | Bare line `+` with 16px arms, same weight as its neighbours. A tinted disc behind it was tried on device and dropped: it read as a button and made the `+` look a size smaller. The existing 45° rotation still turns it into `×` | None |

- The knocked-out check is drawn in `colors.background` (the header's background).
- The badge stays on the circle-notification button at its current offset.

## Left to the builder

- File layout: the four glyphs live together in `src/features/messages/components/MessagesHeaderIcons.tsx`
  (keeps SVG paths out of the 1.7k-line screen). Each takes `color`, plus `background` for the check.
- The pinned tests (`MessagesScreen.spec.tsx`, `test/messages-screen.test.js`) move from the
  lucide components and 4px stroke to the new components; the "no bell / no Orbit" guard stays.
