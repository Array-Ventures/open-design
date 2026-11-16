import { expect, it } from 'vitest';
import { imageArtifactFormats, imageInputFormat } from '../src/runtime/image-export.js';

it.each([['logo.png', 'png'], ['photo.JPG', 'jpeg'], ['a/photo.jpeg', 'jpeg'], ['图像.webp', 'webp']])('advertises bounded raster output for %s', (fileName, format) => {
  expect(imageInputFormat(fileName!)).toBe(format);
  expect(imageArtifactFormats(fileName!, 'image')).toEqual(['image']);
  expect(imageArtifactFormats(fileName!, 'app')).toEqual([]);
});
it.each(['logo.svg', 'animated.gif', 'photo.avif', 'index.html', 'png', '.png', 'file.__proto__', 'directory.png/file', 'image.png?url=https://outside.invalid'])('does not advertise a raster conversion for %s', fileName => {
  expect(imageInputFormat(fileName)).toBeUndefined(); expect(imageArtifactFormats(fileName, 'image')).toEqual([]);
});
