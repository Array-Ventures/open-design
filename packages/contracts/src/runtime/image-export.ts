/** Prepared raster conversion is distinct from HTML capture and original-file
 * download. Decoder, animation, pixel and byte admission remain worker checks. */
export function imageInputFormat(fileName: string): 'png' | 'jpeg' | 'webp' | undefined {
  const name = fileName.split('/').at(-1) ?? '', dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return extension === 'png' ? 'png' : extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension === 'webp' ? 'webp' : undefined;
}
export const isImageSource = (fileName: string): boolean => /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(fileName);
export function imageArtifactFormats(fileName: string, kind: string): 'image'[] {
  return kind === 'image' && imageInputFormat(fileName) ? ['image'] : [];
}
