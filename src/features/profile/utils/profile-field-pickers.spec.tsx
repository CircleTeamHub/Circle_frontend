import {
  formatBirthdayDraft,
  getBirthdayYears,
  parseBirthdayValue,
  updateBirthdayDraft,
} from './profile-field-pickers';

test('parses a stored birthday and falls back to today for malformed values', () => {
  expect(parseBirthdayValue('1998-07-03')).toEqual({ year: 1998, month: 7, day: 3 });
  expect(parseBirthdayValue('', new Date(2026, 9, 13))).toEqual({ year: 2026, month: 10, day: 13 });
});

test('clamps the day when switching to a shorter month or a non-leap year', () => {
  expect(updateBirthdayDraft({ year: 2024, month: 1, day: 31 }, { month: 2 })).toEqual({
    year: 2024,
    month: 2,
    day: 29,
  });
  expect(updateBirthdayDraft({ year: 2024, month: 2, day: 29 }, { year: 2023 })).toEqual({
    year: 2023,
    month: 2,
    day: 28,
  });
});

test('formats with zero padding and lists years from this year back to 1950', () => {
  expect(formatBirthdayDraft({ year: 2001, month: 3, day: 9 })).toBe('2001-03-09');
  const years = getBirthdayYears(2026);
  expect(years[0]).toBe(2026);
  expect(years[years.length - 1]).toBe(1950);
});
