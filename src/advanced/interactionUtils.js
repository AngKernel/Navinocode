// A stable default avoids retriggering effects on every selection change.
export const EMPTY_RESULTS = Object.freeze([]);

export const isComposingEvent = (event) => Boolean(
  event?.isComposing || event?.nativeEvent?.isComposing
  || event?.keyCode === 229 || event?.nativeEvent?.keyCode === 229
);

export const parseTimerMinutes = (input) => {
  const text = String(input ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  const minutes = Number(text);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 180 ? minutes : null;
};
