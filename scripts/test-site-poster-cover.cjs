const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/experience/app.js', 'utf8');
const start = source.indexOf('function buildPoster(');
const end = source.indexOf('\nfunction posterCanShareFile()', start);
assert.ok(start >= 0 && end > start);
const images = [];
class ImageStub { set src(value) { images.push(value); } }
const context = {
  document: { createElement: () => ({ getContext: () => ({ fillRect() {}, fill() {} }) }) },
  roundRect() {}, Image: ImageStub,
  shareLink: value => JSON.stringify(value),
  photoURL: value => 'photo:' + value,
  photoURI: () => 'fallback-listing-photo',
  Api: { db: { settings: { share: { img: 'legacy-site-cover' } } } }
};
vm.runInNewContext(source.slice(start, end), context);
context.buildPoster('site', null, () => {});
assert.equal(images.pop(), 'assets/site-poster-cover-20261025.jpg');
context.buildPoster('listing', { id: 'a', photos: ['listing-photo.jpg'] }, () => {});
assert.equal(images.pop(), 'photo:listing-photo.jpg');
context.buildPoster('listing', { id: 'b', photos: [] }, () => {});
assert.equal(images.pop(), 'photo:fallback-listing-photo');
const image = fs.readFileSync('public/experience/assets/site-poster-cover-20261025.jpg');
assert.equal(image.readUInt16BE(0), 0xffd8);
assert.match(fs.readFileSync('public/experience/index.html', 'utf8'), /app\.js\?v=20261025a/);
console.log('PASS: site poster uses supplied cover; listing images and fallback are unchanged.');
