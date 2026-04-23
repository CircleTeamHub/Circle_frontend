## Goal

Align the chat detail screen UI with the supplied chat mock while preserving the app's existing theme tokens and current OpenIM data path.

## Scope

This change only covers chat-detail visual structure.

In scope:

- tighten the chat header layout to match the supplied hierarchy
- refine message-area spacing, date pill, bubble proportions, and location card styling
- redesign the input bar into a more compact rounded composer
- keep the screen inside the app's existing theme system

Out of scope:

- changing OpenIM load/send behavior
- adding new message types
- redesigning unrelated screens
- introducing a separate chat-only palette

## Recommended Approach

Use the current theme tokens as the only color source and move the fidelity work into spacing, sizing, and hierarchy.

That means:

- keep `colors.background`, `colors.surface`, `colors.sentBubble`, `colors.receivedBubble`, and text tokens
- improve header density, bubble sizing, timestamp placement, and composer shape
- avoid hardcoded screenshot-only colors that would make the screen feel detached from the app

## UI Behavior

### Header

- tighter horizontal spacing
- avatar close to the title block
- title on line one
- green `在线` on line two
- overflow action retained on the right

### Message Area

- more intentional vertical rhythm
- centered date pill with lower visual weight
- received bubbles anchored with avatar and slightly lighter mass
- sent bubbles aligned cleanly right with tighter timestamp/check treatment
- location messages rendered as richer cards

### Input Bar

- circular voice button on the left
- rounded input shell in the center
- emoji affordance inside the shell
- add/send affordance on the right

## Success Criteria

- the screen structure feels close to the supplied mock
- the screen still feels native to the app's existing theme
- no OpenIM behavior changes are required to land the UI polish
