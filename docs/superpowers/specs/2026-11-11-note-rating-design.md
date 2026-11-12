# Note rating (好评 / 差评) — design

Decided with the product owner on 2026-11-11. Every note shows two cumulative counters,
**好评 N** and **差评 M**. Ratings are events: the same person may rate the same note again
after the cooldown, and each rating adds to a counter.

**The counters reset every calendar month** (Asia/Shanghai): the numbers shown are the
counted ratings of the current month. Rating rows are kept for history, appeals and audit;
only the displayed counters start again from 0 on the 1st.

## 1. Where ratings live

"Adding" a note means collecting it from a chat, which creates the collector's own copy
(`collectedFrom.sourceNoteId` / `sourceOwnerId`). Ratings are always recorded against the
**source note**. Every copy displays the source note's counters.

## 2. Who can rate (checked server-side at rating time)

All of:

- Not the source note's owner.
- Currently holds a collected copy of the note.
- Currently a member of at least one group attached to the source note (its group cards,
  `sections.groups`). A note with no group cards **cannot be rated** and shows no rating UI.
- `creditScore >= 90`. New users start at 100, so this gate mainly removes people who were
  penalised (see §7).
- Account registered at least 7 days ago (blocks freshly created accounts).

## 3. Frequency limits

- Per rater: **one rating per day across all notes** (Asia/Shanghai calendar day).
- Per rater and note: at most one rating per **rolling 72 hours**.
- Per note per day (Asia/Shanghai): at most **5 good and 5 bad** counted ratings. Further
  attempts are rejected with a "today's quota is full" code.

## 4. Rating content

- `value`: `GOOD` | `BAD`.
- `BAD` requires a reason: `INACCURATE` 信息不实 / `EXPIRED` 已失效 /
  `BAD_EXPERIENCE` 体验差 / `OTHER` 其他 (text required, ≤ 200 chars).
- `GOOD` carries no text.

## 5. Persistence

- Leaving the group or removing the collected copy does **not** revoke past ratings
  (otherwise an owner could erase bad ratings by kicking the rater out).
- Editing the note does **not** reset the counters.
- Ratings stay attached to the note row for audit if the note is deleted.

## 6. Visibility

- Everyone sees the two counters.
- The owner sees each bad rating's reason, text and time, **not** who left it.
- Admins see the rater (for review and appeals).

## 7. Rating status and anti-abuse

Each rating has a status. Only `COUNTED` contributes to the displayed counters.

| Status | Meaning |
|---|---|
| `COUNTED` | Normal |
| `HELD` | Paused by burst detection, waiting for review |
| `VOID` | Removed by an admin decision |

Confirmed abuse deducts **15 credit points** from each offending rater. A rater whose credit
drops below 90 loses rating rights automatically (§2).

### 7.1 Burst detection (集中刷分)

On every insert: if, within the last 10 minutes, the same note **or** the same owner has
received ≥ 3 ratings of the same value (including this one), mark those ratings `HELD` and
open a `BURST` review case.

- `HELD` ratings do not consume the note's daily 5 + 5 slots, so a midnight rush by
  throwaway accounts cannot lock out real raters. They do consume the rater's own daily quota.
- Admin "release" → `COUNTED`. Admin "void" → `VOID` plus the credit deduction.

### 7.2 Collusion detection (互刷) — deferred

Not part of this build (owner decision, 2026-11-11). Keep `owner_id` denormalised on each
rating so a later mutual-pair / ring check can be added without a backfill.

### 7.3 Appeals (差评申诉)

- The owner may appeal each `BAD` rating once, with a written reason. Quota: 5 appeals per
  owner per calendar month.
- The rating stays `COUNTED` while the appeal is pending (so appealing everything cannot
  hide bad ratings).
- Admin "uphold" → unchanged. "Revoke" → `VOID` plus the credit deduction for the rater.
- The owner is notified of the result.

## 8. Backend (circle_be)

### Data

- `note_rating`: `id`, `note_id` (source), `owner_id` (denormalised), `rater_id`, `value`,
  `reason`, `comment`, `status`, `rated_day` (date, Asia/Shanghai), `created_at`.
  Indexes: `(rater_id, created_at)`, `(rater_id, note_id, created_at)`,
  `(note_id, created_at)`, `(owner_id, created_at)`, `(rater_id, owner_id, value, created_at)`.
- `note_rating_daily`: PK `(note_id, day)`, `good_count`, `bad_count`. The cap is enforced
  with a conditional increment (`... SET good_count = good_count + 1 WHERE good_count < 5`).
- `note_rating_monthly`: PK `(note_id, month)` (`YYYY-MM`, Asia/Shanghai), `good_count`,
  `bad_count` — the displayed counters. Readers take the current month's row and show 0 when
  there is none, so the reset needs no scheduled job. Status changes (release, void) adjust the
  row of the month the rating was made in.
- `note_rating_case`: `id`, `kind` (`BURST` | `APPEAL`), `status`,
  `owner_reason` (appeals), `resolution`, `resolved_by`, timestamps; plus a join table to the
  ratings involved.
- Inserts run in one transaction holding `pg_advisory_xact_lock` on the rater, so the
  per-rater daily check cannot race.
- This needs a new migration, which goes through the server approval step.

### API

- `POST /note/:id/ratings` `{ value, reason?, comment? }` → counters plus `nextRatableAt`.
  Error codes: `OWNER`, `NOT_COLLECTED`, `NOT_IN_GROUP`, `NO_GROUP`, `LOW_CREDIT`,
  `ACCOUNT_TOO_NEW`, `RATER_DAILY_LIMIT`, `COOLDOWN`, `NOTE_GOOD_FULL`, `NOTE_BAD_FULL`.
- `GET /note/:id/ratings/summary` → counters plus `{ canRate, reason, nextRatableAt }`.
- `GET /note/:id/ratings/bad` (owner only) → bad ratings with reason, text, time, appeal state.
- `POST /note/ratings/:ratingId/appeal` `{ reason }`.
- Note summary and detail DTOs gain `goodCount` and `badCount` (current month).
- Admin endpoints to list and resolve cases.

## 9. App (Circle_frontend)

- Note detail (own note, collected copy, opened from a chat card): a rating bar
  "👍 好评 N · 👎 差评 M", labelled as this month's counts (本月). 👍 rates immediately. 👎 opens a sheet with the reasons (text box
  for 其他). When the user can't rate, the buttons are greyed out and tapping explains why
  (需要加入笔记里的群 / 3 天后可再评 / 今天已经打过分 / 今日好评名额已满 / 信用分不足 …).
- Notes list cards and chat note cards show small counters.
- Owner view: "查看差评" list with an 申诉 button per entry and the appeal result.
- Strings in zh / en / es / ja / ko.

## 10. Admin (circle_admin_web)

A rating review queue listing burst and appeal cases with the evidence
(who rated whom, when) and the actions above.

## 11. Phasing

- **Now:** everything above (eligibility, limits, reasons, monthly counters, burst detection,
  appeals, credit deduction, App and admin screens).
- **Later:** collusion detection (§7.2), one-account-per-device deduplication, owner-level
  reputation that survives deleting and reposting a note.

## 12. To confirm while implementing

- How a group card maps to a membership check (circle id vs. chat conversation id); see
  `NoteGroupCard` and `NoteCardPeer.circleId` / `conversationID`.
- Whether notes are soft-deleted, so ratings can stay attached.
