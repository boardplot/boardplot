/**
 * Catalog: version/engineRev/commit, widths/themes/locales, types[].variants[].
 * A variant has a CLI-ready one-chart document spec, settings, droppedSettings and defaultRender.
 * A setting has dotted key, explicit values, default and defaultSource.
 * null + engineDefault is a separate button that removes the key.
 * Only Zod-declared defaults are defaults. Renders are used only for pruning.
 * Enum/boolean leaves in objects, records and union branches are included.
 * Arrays are authored data structures, not independent scalar settings.
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createContext, runInContext } from 'node:vm';
import { performance } from 'node:perf_hooks';
import { getFixtures } from '../../src/fixtures/index.ts';
import { listCharts, getChartSchemas } from '../../src/core/registry.ts';
import { themes } from '../../src/core/theme.ts';
import { LABEL_KINDS } from '../../src/core/schema/capability.ts';
import { ENGINE_REV } from '../../src/core/engine.ts';
import * as source from './entry.ts';
import { createHash as browserHash } from './shims/crypto.mjs';
import { excluded, variants } from './variants.mjs';
import { set, makeSpec, parseId, chartId } from './cardspec.mjs';

const start = performance.now();
const args=process.argv.slice(2), specMode=args[0]==='--spec';
const log=specMode?console.error:console.log;
let reviewIds=[];
if(specMode){
  reviewIds=args.slice(1);
  if(reviewIds.length===1 && reviewIds[0]==='-') reviewIds=readFileSync(0,'utf8').split(/\r?\n/).map(line=>line.trim()).filter(line=>line && !/^Boardplot review round: \d+ cards$/.test(line));
  if(!reviewIds.length || reviewIds.includes('-')){
    console.error('Use --spec <id> [<id> ...] or --spec - with IDs on stdin');process.exit(1);
  }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'artifacts/explorer');
const shim = name => resolve(root, `scripts/explorer/shims/${name}.mjs`);
function plugins(trimLocales) { return [{ name: 'explorer-browser', setup(builder) {
  builder.onResolve({filter: /^node:(fs|path)$/}, () => ({path:shim('node')}));
  builder.onResolve({filter: /^node:util$/}, () => ({path:shim('util')}));
  builder.onResolve({filter: /^node:crypto$/}, () => ({path:shim('crypto')}));
  builder.onResolve({filter: /^\.\/raster$/}, args => args.importer.endsWith('/cli/render.ts') ? {path:shim('raster')} : undefined);
  if(trimLocales) builder.onResolve({filter: /locales\/index\.js$/}, args => args.importer.includes('/zod/') ? {path:shim('locales')} : undefined);
} }]; }
const config = { absWorkingDir:root, entryPoints:['scripts/explorer/entry.ts'], bundle:true,
  format:'iife', globalName:'Boardplot', platform:'browser', minify:true, write:false, metafile:true,
  define:{'process.env.NODE_ENV':'"production"','process.env.BOARDPLOT_DEBUG_STACK':'"0"','process.env':'{}'}, logLevel:'silent' };
for(const value of ['', 'abc', 'Boardplot — Größe 日本語 🐓', 'x'.repeat(1000), JSON.stringify({values:[0,-1,null],label:'\ud800'})]) {
  if(browserHash('sha256').update(value).digest('hex') !== createHash('sha256').update(value).digest('hex')) throw new Error('SHA-256 shim differs from Node');
}
const before = await build({...config, plugins:plugins(false)});
const localesBefore = Object.keys(before.metafile.inputs).filter(p=>/zod\/v4\/locales\//.test(p));
const built = await build({...config, plugins:plugins(true)});
const localesAfter = Object.keys(built.metafile.inputs).filter(p=>/zod\/v4\/locales\//.test(p));
if(localesAfter.some(p=>!p.endsWith('/en.js'))) throw new Error(`Unused Zod locales remain: ${localesAfter}`);
const bundle = built.outputFiles[0].contents;
const context = createContext({console, TextEncoder, TextDecoder, atob, btoa, performance, structuredClone, setTimeout, clearTimeout});
runInContext(new TextDecoder().decode(bundle), context);
const browser = context.Boardplot;
if(browser.version !== source.version) throw new Error('Bundle version differs from source');

export function get(object, key) { return key.split('.').reduce((value, part) => value?.[part], object); }
function unwrap(schema) {
  const d=schema._zod.def;
  if(d.innerType) return unwrap(d.innerType);
  if(d.type==='pipe') return unwrap(d.in._zod.def.type==='transform'?d.out:d.in);
  return schema;
}
function recordKeys(key, options, data, type) {
  if(key==='labels') return LABEL_KINDS[type]??[];
  if(!data) return ['*']; // Schema-name validation before a fixture is selected.
  let found;
  if(key==='encodings') found=(data.columns??[]).filter(c=>c.kind==='value'||c.kind==='computed').map(c=>c.id);
  else if(key==='columnVisibility') found=(data.columnToggles??[]).map(c=>c.id);
  else if(key==='inlineVisibility') {
    found=[];
    const visit=rows=>{for(const row of rows??[]){if(row.inlineGroup)found.push(row.inlineGroup);visit(row.children);}};
    visit(data.rows);
  } else found=ids(data);
  return [...new Set([...found,...Object.keys(get(options,key)??{})])].filter(id=>typeof id==='string').slice(0,3);
}
function leaves(schema, key='', result=new Map(), options={}, data, type) {
  const s=unwrap(schema), d=s._zod.def;
  if(d.type==='object') for(const [part,child] of Object.entries(s.shape)) leaves(child,key?`${key}.${part}`:part,result,options,data,type);
  else if(d.type==='union') for(const child of d.options) leaves(child,key,result,options,data,type);
  else if(d.type==='record') for(const id of recordKeys(key,options,data,type)) {
    if(!data||d.keyType.safeParse(id).success) leaves(d.valueType,`${key}.${id}`,result,options,data,type);
  }
  else if(key) {
    const item=result.get(key) ?? {schemas:[], values:[]}; item.schemas.push(schema);
    if(d.type==='enum') item.values.push(...Object.values(d.entries));
    if(d.type==='boolean') item.values.push(false,true);
    if(d.type==='literal') item.values.push(...(d.values??[d.value]).filter(v=>typeof v==='string'||typeof v==='boolean'));
    item.values=[...new Set(item.values)]; result.set(key,item);
  }
  return result;
}
function keysOfPatch(object, prefix='') {
  return Object.entries(object).flatMap(([key,value]) => {
    const path=prefix?`${prefix}.${key}`:key;
    return value && typeof value==='object' && !Array.isArray(value) ? keysOfPatch(value,path) : [path];
  });
}
function merge(base, patch) {
  for(const [key,value] of Object.entries(patch ?? {})) {
    if(value && typeof value==='object' && !Array.isArray(value)) {
      if(!base[key] || typeof base[key]!=='object' || Array.isArray(base[key])) base[key]={}; merge(base[key],value);
    } else base[key]=structuredClone(value);
  } return base;
}
function ids(data, preferred) {
  // Series ids are the common highlight key. Non-series forms use their own marks.
  const fields = preferred ? [preferred] : data?.series?.length===1 && Array.isArray(data.categories) ? ['categories','series'] : ['series','points','slices','items','regions','rows','groups','categories','nodes','panels'];
  for(const field of fields) {
    const list=data?.[field]; if(Array.isArray(list)) { const found=list.map(x=>x?.id).filter(x=>typeof x==='string'); if(found.length) return found.slice(0,3); }
  }
  return [];
}
function normalized(svg) {
  const scope=/id="bp-(?:title|desc)-([a-f0-9]{10})"/.exec(svg)?.[1];
  return scope ? svg.replaceAll(`-${scope}`, '-explorer-scope') : svg;
}
const registered=listCharts().sort((a,b)=>a.type.localeCompare(b.type));
for(const {type} of registered) if(!variants[type]) throw new Error(`Variant map has no entry for registered type '${type}'`);
for(const type of Object.keys(variants)) if(!registered.some(x=>x.type===type)) throw new Error(`Variant map names unknown type '${type}'`);
let renders=0, kept=0, dropped=0, valuesCount=0, recordSettings=0;
const catalog={ version:source.version, engineRev:ENGINE_REV,
  commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  widths:[320,400,480,720,960], themes:['authored',...Object.keys(themes)], locales:['en','de'], types:[] };
for(const {type} of registered) {
  const hints=variants[type], optionsSchema=getChartSchemas(type).optionsSchema, schemaLeaves=leaves(optionsSchema,'',new Map(),{},undefined,type);
  const known=key=>[...schemaLeaves.keys()].some(path=>{
    const parts=path.split('.'),candidate=key.split('.');
    return candidate.every((part,index)=>parts[index]===part||parts[index]==='*');
  });
  for(const key of [...(hints.axis??[]),...(hints.exclude??[]),...(hints.dataSettings??[]),...Object.keys(hints.idFields??{})]) if(!known(key)) throw new Error(`${type}: unknown option key '${key}'`);
  const typeRow={type,title:type,variants:[]}; const seen=new Set();
  for(const variant of hints.variants) {
    if(seen.has(variant.id)) throw new Error(`${type}: duplicate variant '${variant.id}'`); seen.add(variant.id);
    const fixture=getFixtures(type).find(f=>f.id===variant.fixture);
    if(!fixture) throw new Error(`${type}/${variant.id}: unknown fixture '${variant.fixture}'`);
    for(const key of keysOfPatch(variant.options??{})) if(!known(key)) throw new Error(`${type}/${variant.id}: unknown option key '${key}'`);
    let spec={type,data:structuredClone(fixture.data),options:merge(structuredClone(fixture.options??{}),variant.options),
      ...(fixture.annotations?{annotations:structuredClone(fixture.annotations)}:{})};
    // Root context must remain effective when the page changes it. Lift authored theme.
    const authoredTheme=spec.options.theme;delete spec.options.theme;
    if(spec.options.locale){spec.options.locale={...spec.options.locale};delete spec.options.locale.language;if(!Object.keys(spec.options.locale).length)delete spec.options.locale;}
    spec=JSON.parse(JSON.stringify(spec));
    spec=source.withWidth({version:1,locale:'en',...(authoredTheme!==undefined?{theme:authoredTheme}:{}),charts:[{name:'chart',...spec}]},720);
    const options=spec.charts[0].options;
    const optionLeaves=leaves(optionsSchema,'',new Map(),options,spec.charts[0].data,type);
    const cache=new Map();
    const draw = candidate => {const key=JSON.stringify(candidate);if(!cache.has(key)){renders++;cache.set(key,source.render(candidate));}return cache.get(key);};
    const baseline=draw(spec); const bundled=browser.render(spec); renders++;
    if(baseline.ok!==bundled.ok || baseline.svg!==bundled.svg || JSON.stringify(baseline.errors)!==JSON.stringify(bundled.errors)) {console.error(JSON.stringify({sourceErrors:baseline.errors,bundleErrors:bundled.errors}));throw new Error(`${type}/${variant.id}: bundle differs from CLI source`);}
    const settings=[], removed=[];
    for(const [key,leaf] of optionLeaves) {
      if([...Object.keys(excluded),...(hints.axis??[]),...(hints.exclude??[])].some(skip=>key===skip||key.startsWith(skip+'.'))) continue;
      let allowed=[...leaf.values];
      if(['highlight',...(hints.dataSettings??[])].includes(key)) allowed.push(...ids(spec.charts[0].data,hints.idFields?.[key]).filter(id=>leaf.schemas.some(s=>s.safeParse(id).success)));
      if(!allowed.length) continue;
      let defaultValue, defaultSource='engine';
      for(const schema of leaf.schemas){const parsed=schema.safeParse(undefined);if(parsed.success&&parsed.data!==undefined){defaultValue=parsed.data;defaultSource='schema';break;}}
      const authored=get(options,key);
      if(authored!==undefined) allowed.push(authored);
      if(defaultValue!==undefined) allowed.push(defaultValue);
      allowed=[...new Map(allowed.map(value=>[JSON.stringify(value),value])).values()];
      const omitted=structuredClone(spec),parts=key.split('.');
      const parent=get(omitted.charts[0].options,parts.slice(0,-1).join('.'));
      if(parts.length===1) delete omitted.charts[0].options[key];
      else if(parent) delete parent[parts.at(-1)];
      const omittedRender=draw(omitted);
      const attempts=allowed.map(value=>{const candidate=structuredClone(spec);set(candidate.charts[0].options,key,value);return {value,result:draw(candidate)};});
      const actualDefault=defaultValue===undefined?null:defaultValue;
      if(attempts.every(({result})=>omittedRender.ok&&result.ok&&normalized(result.svg)===normalized(omittedRender.svg))) {removed.push(key);continue;}
      if(defaultSource==='engine') allowed.unshift(null);
      const setting={key,values:allowed,default:actualDefault,defaultSource,...(defaultSource==='engine'?{engineDefault:true}:{})};
      settings.push(setting);kept++;valuesCount+=allowed.length;
      if([...schemaLeaves.keys()].some(path=>path.includes('*')&&path.split('.').every((part,index)=>part==='*'||part===key.split('.')[index]))) recordSettings++;
    }
    dropped+=removed.length;
    typeRow.variants.push({...variant, spec, settings, droppedSettings:removed.length, droppedKeys:removed,
      defaultRender:{ok:baseline.ok,ms:baseline.ms,svgBytes:baseline.svg?Buffer.byteLength(baseline.svg):0,errors:baseline.errors}});
  }
  catalog.types.push(typeRow);
  log(`${type}: ${typeRow.variants.length} variants, ${typeRow.variants.reduce((n,v)=>n+v.settings.length,0)} settings`);
}
const cardSpecSource=readFileSync(resolve(root,'scripts/explorer/cardspec.mjs'),'utf8');
const html=readFileSync(resolve(root,'scripts/explorer/index.html'),'utf8').replace('/* CARDSPEC_INLINE */',
  `const CardSpec = (() => {\n${cardSpecSource.replace(/^export /gm,'')}\nreturn {set,same,label,makeSpec,cardId,parseId};\n})();`);
if(!specMode){
  mkdirSync(out,{recursive:true});
  writeFileSync(resolve(out,'boardplot.js'),bundle);
  writeFileSync(resolve(out,'catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  writeFileSync(resolve(out,'index.html'),html);
  // Replace the folder, so a removed or renamed redesign does not linger in the output.
  rmSync(resolve(out,'after'),{recursive:true,force:true});
  cpSync(resolve(root,'scripts/explorer/after'),resolve(out,'after'),{recursive:true});
}
const all=catalog.types.flatMap(t=>t.variants.map(v=>({id:chartId(t.type,v),...v.defaultRender})));
const summary={ types:catalog.types.length, variants:all.length, settingsKept:kept,settingsDropped:dropped,settingValues:valuesCount,recordSettings,renders,
  refusals:all.filter(v=>!v.ok).map(({id,errors})=>({id,errors})),slowest:all.toSorted((a,b)=>b.ms-a.ms).slice(0,10).map(({id,ms})=>({id,ms:+ms.toFixed(1)})),
  bundleBeforeBytes:before.outputFiles[0].contents.length,bundleBytes:bundle.length,bundleGzipBytes:gzipSync(bundle).length,
  zodLocalesBefore:localesBefore.length,zodLocalesAfter:localesAfter.length,
  catalogBytes:Buffer.byteLength(JSON.stringify(catalog,null,2)+'\n'),htmlBytes:Buffer.byteLength(html),elapsedSeconds:+((performance.now()-start)/1000).toFixed(1) };
log(JSON.stringify(summary,null,2));
if(specMode){
  try {
    // Resolve the full round before writing anything to stdout.
    const resolved=reviewIds.map(id=>{
      const {variant,settings,width,theme,locale}=parseId(catalog,id);
      return {id,spec:makeSpec(variant,settings,width,theme,locale,source.withWidth)};
    });
    process.stdout.write(resolved.length===1?JSON.stringify(resolved[0].spec,null,2):resolved.map(row=>JSON.stringify(row)).join('\n')+'\n');
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
