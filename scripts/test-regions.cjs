const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const read=path=>fs.readFileSync(path,'utf8');
const load=path=>{const exports={};vm.runInNewContext(ts.transpileModule(read(path),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require});return exports;};
const api=load('lib/regions.ts');
assert.equal(api.PUBLIC_REGIONS.join(','),'北部,中部,南部,生态园,大朗,寮步,大岭山,东城,南城');
for(const region of api.PUBLIC_REGIONS){assert.equal(api.isRegion(region),true);assert.equal(api.inferRegion({title:'松山湖'+region+'办公室'}),region);}
assert.equal(api.inferRegion({title:'办公室',park:'未确定园区'}),null);
assert.equal(api.inferRegion({title:'松山湖北部办公室',address:'大朗'}),null);
const editor=load('lib/listing-editor.ts');
for(const flag of [undefined,false,true]){
 const item={title:'私密园区 704 精装办公室',description:'私密园区 704，面积167.704平，电话18612347048',park:'私密园区',building:'A栋',room:'704',unit:'A栋704',unit_split:true,address:'私密详细地址',category:'写字楼',region:'北部',images:[],field_visibility:{park:flag,building:flag,room:flag}};
 const publicItem=editor.publicListingPreview(item);
 for(const key of ['park','building','room','unit','address','latitude','longitude'])assert.equal(publicItem[key],null);
 assert.doesNotMatch(publicItem.title,/私密园区|704/);
 assert.doesNotMatch(publicItem.description,/私密园区/);
 assert.match(publicItem.description,/167\.704/);assert.match(publicItem.description,/18612347048/);
 assert.equal(publicItem.region,'北部');
}
const bridge=read('public/experience/bridge.js'),app=read('public/experience/app.js'),component=read('components/region-selector.tsx');
assert.doesNotMatch(bridge,/read\('parks\?|row\.(park|room|building|unit)\b/);
assert.match(bridge,/region:PUBLIC_REGIONS.includes\(row.region\)/);
assert.match(app,/\['全部'\].concat\(PUBLIC_REGIONS\)/);
assert.doesNotMatch(component,/fetch\(|workspaceRequest|DeepSeek|\/functions\//);
assert.match(component,/辅助识别片区/);
console.log('PASS: nine regions, unknown/conflicting facts remain unassigned, local-only suggestions, forced-private fields and redacted text, region-only public filters.');

const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const componentExports={};
vm.runInNewContext(ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:componentExports,require:name=>name==='@/lib/regions'?api:require(name)});
for(const region of api.PUBLIC_REGIONS){
 const markup=renderToStaticMarkup(React.createElement(componentExports.RegionSelector,{listing:{region},onChange:()=>{}}));
 assert.match(markup,new RegExp('<option value="'+region+'" selected="">'+api.REGION_LABELS[region]+'</option>'));
 for(const label of ['松山湖北部','松山湖中部','松山湖南部','松山湖生态园','东城','南城'])assert.ok(markup.includes('>'+label+'</option>'));
}
const publicRegionSource=read('public/experience/data.js').match(/const PUBLIC_REGIONS = (\[[^;]+\]);/)[1];
assert.equal(vm.runInNewContext(publicRegionSource).join(','),api.PUBLIC_REGIONS.join(','));
assert.equal(api.inferRegion({title:'东城带装修890平'}),'东城');
assert.equal(api.inferRegion({title:'南城办公室',address:'东城'}),null);
console.log('PASS: all admin options render full labels and preserve selected values; new districts match frontend allowlist; ambiguous districts stay unassigned.');
