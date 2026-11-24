// Estimates how wide a line of text is drawn, using Arial's character widths.
// The system prompt requires font-family="Arial, Helvetica, sans-serif", and Helvetica and
// Liberation Sans use the same widths, so this matches what browsers draw much better than a
// single width for every character (which flagged labels that were visibly inside the viewBox).

import { BOLD_WIDTH_FACTOR, UNKNOWN_CHAR_WIDTH_EM } from "../config";

// Arial's advance widths in em (the font's units ÷ 1000), grouped by width.
const WIDTH_GROUPS: [characters: string, widthEm: number][] = [
  ["'", 0.191],
  ["|", 0.26],
  ["ijl", 0.222],
  [" !,./:;I[\\]ft", 0.278],
  ["()-`r²³", 0.333],
  ["{}", 0.334],
  ['"', 0.355],
  ["*", 0.389],
  ["^", 0.469],
  ["Jcksvxyz", 0.5],
  ["0123456789#$?_Labdeghnopqu", 0.556],
  ["+<=>~×÷±−", 0.584],
  ["FTZ", 0.611],
  ["&ABEKPSVXY", 0.667],
  ["CDHNRUw", 0.722],
  ["GOQ", 0.778],
  ["Mm", 0.833],
  ["%", 0.889],
  ["W", 0.944],
  ["→←↑↓@", 1.015],
];

const CHARACTER_WIDTHS = new Map<string, number>(
  WIDTH_GROUPS.flatMap(([characters, width]) => Array.from(characters, (character): [string, number] => [character, width])),
);

// Width in user units. Characters Arial doesn't cover well (subscripts, Greek, ...) use
// UNKNOWN_CHAR_WIDTH_EM. Bold text is widened by BOLD_WIDTH_FACTOR instead of a second table.
export function textWidth(text: string, fontSize: number, isBold: boolean): number {
  const widthEm = Array.from(text).reduce((sum, character) => sum + (CHARACTER_WIDTHS.get(character) ?? UNKNOWN_CHAR_WIDTH_EM), 0);
  return widthEm * fontSize * (isBold ? BOLD_WIDTH_FACTOR : 1);
}
