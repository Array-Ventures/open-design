import type { CheerioAPI } from 'cheerio';
import { documentDateAttributes, readDocumentDate, type DocumentDate } from '@open-design/contracts/runtime/document';
const attributes = new Set<string>(documentDateAttributes);
/** Validate reserved Date atoms before projection. Unmarked HTML TIME retains its prior converter path. */
export function documentSourceDates($: CheerioAPI): Array<{ element: ReturnType<CheerioAPI>; date: DocumentDate }> {
  return $('[data-eve-document-date],[data-eve-date-locale]').toArray().map(element => {
    if (element.type !== 'tag' || element.name !== 'time' || element.namespace !== 'http://www.w3.org/1999/xhtml'
      || element.attribs['data-eve-document-date'] !== '1' || Object.keys(element.attribs).some(name => !attributes.has(name))
      || element.children.some(child => child.type !== 'text') || $(element).children().length || $(element).parents('pre,code').length || !$(element).parents('p,h1,h2,h3,h4,h5,h6,li,td,th').length) throw Error('Document dates could not be preserved.');
    const date = readDocumentDate({ iso: element.attribs.datetime, locale: element.attribs['data-eve-date-locale'], label: $(element).text() });
    if (!date) throw Error('Document dates could not be preserved.');
    return { element: $(element), date };
  });
}
/** Word receives the persisted visible label as ordinary text, never a fake date field. */
export function projectDocumentDatesForWord($: CheerioAPI): void {
  for (const { element, date } of documentSourceDates($)) $(element).replaceWith($('<span></span>').text(date.label));
}
