const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=path=>fs.readFileSync(path,'utf8');
const exportsObject={};
vm.runInNewContext(ts.transpileModule(read('lib/listing-editor.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:exportsObject,require});
const editor=exportsObject;
const item={id:'fixture',title:'办公室',category:'写字楼',park:'内部园区',area:100,images:['fixture.jpg'],videos:[],contact_name:'公开顾问',contact_phone:'18600000001',owner_contact_name:'内部对接人',owner_contact_phone:'18600000002'};
for(const flags of [undefined,{}, {owner_contact_name:true,owner_contact_phone:true}]){
  const preview=editor.publicListingPreview({...item,field_visibility:flags});
  for(const key of ['owner_contact_name','owner_contact_phone'])assert.equal(Object.hasOwn(preview,key),false);
  assert.doesNotMatch(JSON.stringify(preview),/内部对接人|18600000002/);
  assert.equal(preview.contact_name,item.contact_name);
  assert.equal(preview.contact_phone,item.contact_phone);
}
assert.deepEqual(JSON.parse(JSON.stringify(editor.listingErrors({...item,owner_contact_name:null,owner_contact_phone:null},true))),{});
const form=read('components/listing-fields.tsx'),admin=read('app/admin/page.tsx'),backend=read('lib/backend.ts');
assert.match(form,/招商顾问 · 对外公开/);assert.match(form,/房源联系人 · 仅后台可见/);
assert.match(backend,/PublicListing = Omit<LiveListing,[^;]*"owner_contact_name"[^;]*"owner_contact_phone"/);
const selectPark=admin.slice(admin.indexOf('function selectPark'),admin.indexOf('function selectPark')+400);
assert.doesNotMatch(selectPark,/park\.contact_name|park\.contact_phone/);
const migration=read('supabase/listing_owner_contacts.sql');
assert.doesNotMatch(migration,/create or replace view|update public\.listings|grant .* to anon/i);
for(const file of ['public/experience/app.js','public/experience/bridge.js','supabase/functions/ai-search/index.ts'])assert.doesNotMatch(read(file),/owner_contact_(name|phone)/);
console.log('PASS: separate contacts, optional private fields, public preview/type exclusion, no park-to-public autofill, unchanged public/AI projections.');
