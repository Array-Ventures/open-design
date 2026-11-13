import {describe,expect,it} from 'vitest';
import {insertionImageSourceForAsset} from '../../src/edit-mode/insertion';
const asset='_studio-image-assets/receipt.png';
describe('portable image receipt paths',() => {
  it.each([
    ['index.html',null,asset],
    ['slides/index.html',null,`../${asset}`],
    ['slides/index.html','../images/',`../${asset}`],
    ['slides/index.html','assets/',`../../${asset}`],
    ['a folder/index.html',null,`../${asset}`],
    ['slides/index.html','./nested/owner.html',`../../${asset}`],
  ])('resolves from %s and authored base %s',(owner,base,expected) => {
    const src=insertionImageSourceForAsset(asset,owner,base);
    expect(src).toBe(expected);
    const root='https://project.invalid/';
    expect(new URL(src!,base ? new URL(base,new URL(owner,root)) : new URL(owner,root)).pathname).toBe(`/${asset}`);
  });
  it('encodes actual filename spaces without changing the uploaded path',() => {
    expect(insertionImageSourceForAsset('images/my photo.png','slides/index.html')).toBe('../images/my%20photo.png');
  });
  it.each(['../outside.png','/outside.png','.eve/private.png','.file-versions/file.png','a%20b.png','a\\b.png','x.png?token=x'])('refuses an unsafe or ambiguous receipt %s',path => {
    expect(insertionImageSourceForAsset(path,'index.html')).toBeNull();
  });
  it.each(['https://other.test/','/assets/','../../'])('refuses an outside base %s',base => {
    expect(insertionImageSourceForAsset(asset,'index.html',base)).toBeNull();
  });
});
