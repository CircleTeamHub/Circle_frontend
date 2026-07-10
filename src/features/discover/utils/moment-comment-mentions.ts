export type MomentMentionOccurrence = {
  userID: string;
  nickname: string;
  start: number;
  end: number;
};

export type MomentMentionTarget = Pick<
  MomentMentionOccurrence,
  'userID' | 'nickname'
>;

export type MomentTextSelection = { start: number; end: number };

export const MOMENT_MENTION_LIMIT = 20;

export type MomentMentionInsertResult = {
  text: string;
  occurrences: MomentMentionOccurrence[];
  limitReached: boolean;
};

type ResolvedTextEdit = {
  oldStart: number;
  oldEnd: number;
  newEnd: number;
};

function resolveHintedEdit(
  oldText: string,
  newText: string,
  selection: MomentTextSelection,
): ResolvedTextEdit | null {
  let oldStart = selection.start;
  let oldEnd = selection.end;
  if (
    oldStart < 0 ||
    oldEnd < oldStart ||
    oldEnd > oldText.length
  ) {
    return null;
  }

  const lengthDelta = newText.length - oldText.length;
  if (oldStart === oldEnd && lengthDelta < 0) {
    oldStart = Math.max(0, oldStart + lengthDelta);
  }

  const replacementLength =
    newText.length - (oldText.length - (oldEnd - oldStart));
  if (replacementLength < 0) return null;
  const newEnd = oldStart + replacementLength;
  if (newEnd > newText.length) return null;

  const reconstructed =
    oldText.slice(0, oldStart) +
    newText.slice(oldStart, newEnd) +
    oldText.slice(oldEnd);
  return reconstructed === newText ? { oldStart, oldEnd, newEnd } : null;
}

function resolveDiffEdit(oldText: string, newText: string): ResolvedTextEdit {
  let prefixLength = 0;
  const maxPrefixLength = Math.min(oldText.length, newText.length);
  while (
    prefixLength < maxPrefixLength &&
    oldText[prefixLength] === newText[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const maxSuffixLength = Math.min(
    oldText.length - prefixLength,
    newText.length - prefixLength,
  );
  while (
    suffixLength < maxSuffixLength &&
    oldText[oldText.length - 1 - suffixLength] ===
      newText[newText.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    oldStart: prefixLength,
    oldEnd: oldText.length - suffixLength,
    newEnd: newText.length - suffixLength,
  };
}

export function insertMomentMention(
  text: string,
  occurrences: MomentMentionOccurrence[],
  target: MomentMentionTarget,
): MomentMentionInsertResult {
  if (
    !target.userID ||
    !target.nickname.trim() ||
    occurrences.some((occurrence) => occurrence.userID === target.userID)
  ) {
    return { text, occurrences, limitReached: false };
  }
  if (occurrences.length >= MOMENT_MENTION_LIMIT) {
    return { text, occurrences, limitReached: true };
  }

  const prefix = `${text}${text && !text.endsWith(' ') ? ' ' : ''}`;
  const mentionText = `@${target.nickname}`;
  const occurrence: MomentMentionOccurrence = {
    ...target,
    start: prefix.length,
    end: prefix.length + mentionText.length,
  };

  return {
    text: `${prefix}${mentionText} `,
    occurrences: [...occurrences, occurrence],
    limitReached: false,
  };
}

export function reconcileMomentMentionOccurrences(
  oldText: string,
  newText: string,
  occurrences: MomentMentionOccurrence[],
  selection?: MomentTextSelection,
): MomentMentionOccurrence[] {
  if (oldText === newText || occurrences.length === 0) return occurrences;

  const edit =
    (selection && resolveHintedEdit(oldText, newText, selection)) ||
    resolveDiffEdit(oldText, newText);
  const delta = edit.newEnd - edit.oldEnd;

  return occurrences.flatMap((occurrence) => {
    let next = occurrence;
    if (occurrence.end <= edit.oldStart) {
      next = occurrence;
    } else if (occurrence.start >= edit.oldEnd) {
      next = {
        ...occurrence,
        start: occurrence.start + delta,
        end: occurrence.end + delta,
      };
    } else {
      return [];
    }

    return newText.slice(next.start, next.end) === `@${next.nickname}`
      ? [next]
      : [];
  });
}

export function getMomentMentionedUserIds(
  occurrences: MomentMentionOccurrence[],
): string[] {
  return occurrences.map((occurrence) => occurrence.userID);
}
