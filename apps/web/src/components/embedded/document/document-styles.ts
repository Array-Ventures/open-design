import { documentFontSizePattern } from '@open-design/document-style';
/** Inline text styling that Lexical stores verbatim and can export again. No URLs or CSS variables. */
export const documentTextStyles = new Map<string, RegExp>([
  ['color', /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i],
  ['background-color', /^(?:#[\da-f]{3,8}|[a-z]+|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i],
  ['font-size', documentFontSizePattern],
  ['font-family', /^[\w\s,"'-]+$/],
]);
export const documentImportStyles = new Map<string, RegExp>([
  ...documentTextStyles,
  ['aspect-ratio', /^\d{1,5}\s*\/\s*\d{1,5}$/],
  ['width', /^(?:[1-9][0-9]{0,3}(?:\.[0-9]+)?px|(?:[1-9][0-9]?|100)(?:\.[0-9]+)?%)$/],
  ['height', /^\d+(?:\.\d+)?px$/],
  ['text-align', /^(left|right|center|justify|start|end)$/],
  ['font-weight', /^(normal|bold|400|700)$/],
  ['font-style', /^(normal|italic)$/],
  ['text-decoration', /^(none|underline|line-through|underline line-through)$/],
  ['vertical-align', /^(top|middle|bottom)$/],
  ['padding-inline-start', /^(?:0|[1-9]\d*)px$/],
]);
