// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { normalizeDocumentPresentationOwners } from '../src/browser.js';
const attribute = 'data-eve-docx-color-image-fixture';
const css = 'body{color:black;background:white}h1{font:40px/50px serif;margin-top:0}img,span{font:inherit;display:inline;vertical-align:baseline;position:static;float:none;transform:none;margin:0;border:0;padding:0;box-shadow:none}';
function fixture(content = `<img ${attribute}-image="heading" src="pixel.png" width="24" height="24">`, blockHeight = 50, imageHeight = 24) {
  document.documentElement.setAttribute('data-eve-document','1');
  document.head.innerHTML = `<style>${css}</style>`;
  document.body.innerHTML = `<main><h1 ${attribute}="heading">${content}</h1></main>`;
  // Pinned jsdom reports an unset text-shadow as a bare transparent color.
  // The real contained Chromium proof reports `none`; model that serialization
  // only for fixture nodes without an authored shadow, keeping paint guards real.
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window,'getComputedStyle').mockImplementation((element,pseudo) => {
    const style = computed(element,pseudo);
    if (['IMG','SPAN'].includes(element.tagName) && !(element as HTMLElement).style.getPropertyValue('text-shadow') && style.textShadow === 'rgba(0, 0, 0, 0)') {
      Object.defineProperty(style,'textShadow',{value:'none'});
    }
    return style;
  });
  const heading = document.querySelector('h1')!, image = document.querySelector('img')!;
  vi.spyOn(heading,'getBoundingClientRect').mockReturnValue(new DOMRect(0,0,720,blockHeight));
  vi.spyOn(image,'getBoundingClientRect').mockReturnValue(new DOMRect(0,15,24,imageHeight));
}
const normalize = () => normalizeDocumentPresentationOwners(document,[{id:'heading',kind:'heading'}],attribute,[css],()=>[255,255,255,1],672)[0]!.presentation;
afterEach(() => { vi.restoreAllMocks(); document.head.replaceChildren(); document.body.replaceChildren(); document.documentElement.removeAttribute('data-eve-document'); });
it('preserves the measured line of a single baseline image independently of first-heading margins', () => {
  fixture();
  expect(normalize()).toMatchObject({headingLevel:1,headingImageLineHeightPt:37.5,headingImageWidthPt:18,headingImageHeightPt:18,headingImageSource:'single-baseline-image'});
});
it('does not assign an exact line to overflowing images, mixed text, multiple images or authored vertical alignment', () => {
  for (const [content,height,imageHeight] of [
    [`<img ${attribute}-image="heading" src="pixel.png" width="24" height="24">`,91,80],
    [`Text<img ${attribute}-image="heading" src="pixel.png" width="24" height="24">`,50,24],
    [`<img ${attribute}-image="heading" src="pixel.png" width="24" height="24"><img src="pixel.png" width="24" height="24">`,50,24],
    [`<img ${attribute}-image="heading" src="pixel.png" width="24" height="24" style="vertical-align:middle">`,50,24],
  ] as const) {
    fixture(content,height,imageHeight);
    expect(normalize()).not.toHaveProperty('headingImageSource');
    vi.restoreAllMocks();
  }
});

it('keeps no-wrap, changed image identity and changed inherited image font outside exact-line projection', () => {
  for (const change of [
    () => document.querySelector('h1')!.style.whiteSpace = 'nowrap',
    () => document.querySelector('img')!.setAttribute(`${attribute}-image`,'other'),
    () => { const image = document.querySelector('img')!, span = document.createElement('span'); image.replaceWith(span); span.append(image); span.style.fontSize = '20px'; },
  ]) {
    fixture(); change();
    expect(normalize()).not.toHaveProperty('headingImageSource');
    vi.restoreAllMocks();
  }
});

it('allows one Chromium layout quantum, but not a second line or larger height drift', () => {
  fixture(undefined,50-1/64);
  expect(normalize()).toHaveProperty('headingImageLineHeightPt',37.5);
  vi.restoreAllMocks();
  fixture(undefined,50-2/64);
  expect(normalize()).not.toHaveProperty('headingImageSource');
});

it('does not assume a responsive image wider than the physical print content fits', () => {
  fixture();
  document.querySelector('img')!.setAttribute('width','700');
  vi.mocked(document.querySelector('img')!.getBoundingClientRect).mockReturnValue(new DOMRect(0,15,700,24));
  expect(normalize()).not.toHaveProperty('headingImageSource');
});
it('keeps non-breaking and other visible Unicode spaces in their existing text flow', () => {
  fixture(`&nbsp;<img ${attribute}-image="heading" src="pixel.png" width="24" height="24">`);
  expect(normalize()).not.toHaveProperty('headingImageSource');
});
it('requires measured collapse before normalizing outside-image whitespace', () => {
  fixture(`\n <span>\n <img ${attribute}-image="heading" src="pixel.png" width="24" height="24">\n </span>\n`);
  const range = {selectNodeContents:vi.fn(),getClientRects:()=>[new DOMRect(0,0,0,50)]};
  vi.spyOn(document,'createRange').mockReturnValue(range as unknown as Range);
  expect(normalize()).toHaveProperty('headingImageSource');
  range.getClientRects = () => [new DOMRect(0,0,4,50)];
  expect(normalize()).not.toHaveProperty('headingImageSource');
});
it.each(['background-color:red','border-bottom:1px solid red'])('does not normalize whitespace inside an authored painted span: %s', style => {
  fixture(`\n <span style="${style}">\n <img ${attribute}-image="heading" src="pixel.png" width="24" height="24">\n </span>\n`);
  vi.spyOn(document,'createRange').mockReturnValue({selectNodeContents:vi.fn(),getClientRects:()=>[new DOMRect(0,0,0,50)]} as unknown as Range);
  expect(normalize()).not.toHaveProperty('headingImageSource');
});
it('declines unproved source sizing while retaining an explicit numeric HTML dimension control', () => {
  fixture(`<img ${attribute}-image="heading" src="pixel.png" width="336" height="24">`);
  vi.mocked(document.querySelector('img')!.getBoundingClientRect).mockReturnValue(new DOMRect(0,15,336,24));
  expect(normalize()).toHaveProperty('headingImageWidthPt',252);
  vi.restoreAllMocks();
  for (const content of [
    `<img ${attribute}-image="heading" src="pixel.png" style="width:50%;height:24px">`,
    `<img ${attribute}-image="heading" src="pixel.png" style="width:336px;height:24px">`,
    `<img ${attribute}-image="heading" src="pixel.png" width="360" height="24" style="width:50%">`,
    `<img ${attribute}-image="heading" src="pixel.png" width="360" height="24" style="width:calc(50% + 0px)">`,
    `<img ${attribute}-image="heading" src="pixel.png">`,
  ]) {
    fixture(content);
    vi.mocked(document.querySelector('img')!.getBoundingClientRect).mockReturnValue(new DOMRect(0,15,360,24));
    expect(normalize()).not.toHaveProperty('headingImageSource');
    vi.restoreAllMocks();
  }
});
it('declines authored container sizing and a measured size that disagrees with the HTML dimensions', () => {
  fixture(`<img ${attribute}-image="heading" src="pixel.png" width="360" height="24">`);
  document.querySelector('h1')!.style.width = '50%';
  vi.mocked(document.querySelector('h1')!.getBoundingClientRect).mockReturnValue(new DOMRect(0,0,360,50));
  vi.mocked(document.querySelector('img')!.getBoundingClientRect).mockReturnValue(new DOMRect(0,15,360,24));
  expect(normalize()).not.toHaveProperty('headingImageSource');
  vi.restoreAllMocks();
  fixture(`<img ${attribute}-image="heading" src="pixel.png" width="24" height="24" style="width:336px">`);
  vi.mocked(document.querySelector('img')!.getBoundingClientRect).mockReturnValue(new DOMRect(0,15,336,24));
  expect(normalize()).not.toHaveProperty('headingImageSource');
});
