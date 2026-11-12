const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const read = name => fs.readFileSync(name, 'utf8');
const html = read('public/experience/index.html');
assert.doesNotMatch(html, /data-v="map"|view-map|amap\.(js|css)/);
const app = read('public/experience/app.js');
assert.doesNotMatch(app, /https:\/\/(webapi|restapi)\.amap\.com|map\.qq\.com\/api/);
const detail = app.slice(app.indexOf('function renderDetail('), app.indexOf('function renderMessage('));
assert.doesNotMatch(detail, /l\.address|l\.lat\b|l\.lng\b|detailMap|copy:address/);
assert.match(app, /const TAB_VIEWS = \['home', 'message', 'mine'\]/);
assert.match(app, /if \(name === 'map'\) name = 'home'/);
assert.match(read('public/experience/tab-navigation.css'), /repeat\(3,minmax/);
assert.doesNotMatch(read('public/experience/tab-navigation.js'), /items\[3\]/);
assert.doesNotMatch(read('scripts/generate-config.mjs'), /AMAP|amap/);
const bridge = read('public/experience/bridge.js');
assert.doesNotMatch(bridge, /read\('parks\?/);
assert.doesNotMatch(bridge, /row\.(address|latitude|longitude|park|building|room|unit)\b|park\.(address|latitude|longitude)/);
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(read('lib/listing-editor.ts'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject,require});
for (const value of [undefined, false, true]) {
  const preview = exportsObject.publicListingPreview({title:'测试',category:'写字楼',images:[],address:'私密地址',latitude:22.9,longitude:113.8,field_visibility:{address:value,coordinates:value}});
  assert.equal(preview.address,null);assert.equal(preview.latitude,null);assert.equal(preview.longitude,null);
}
const proxy = read('supabase/functions/amap-proxy/index.ts');
assert.match(proxy,/status: 410/);assert.doesNotMatch(proxy,/fetch\(|Deno\.env/);
console.log('PASS: map entries removed, 3-tab navigation, no SDK loading, address-free detail/bridge, forced-private preview, disabled proxy.');
