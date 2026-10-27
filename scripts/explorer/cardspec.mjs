/** Shared card specs and IDs for the page and the command. */
const clone = value => JSON.parse(JSON.stringify(value));
export const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export const label = value => value === null ? 'engine default' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function set(object,key,value) {
  const parts=key.split('.');let node=object;
  for(const part of parts.slice(0,-1)){if(!node[part]||typeof node[part]!=='object'||Array.isArray(node[part]))node[part]={};node=node[part];}
  node[parts.at(-1)]=clone(value);
}
export function makeSpec(variant,settings,width,theme,locale,withWidth) {
  let spec=clone(variant.spec);
  for(const setting of variant.settings)if(Object.hasOwn(settings,setting.key)){
    const value=settings[setting.key];
    if(value===null&&setting.engineDefault){
      const parts=setting.key.split('.'),parent=parts.slice(0,-1).reduce((node,part)=>node?.[part],spec.charts[0].options);
      if(parent)delete parent[parts.at(-1)];
    }else set(spec.charts[0].options,setting.key,value);
  }
  spec=withWidth(spec,width);
  if(theme!=='authored')spec.theme=theme;
  spec.locale=locale;
  // Explicit locale formats stay authored, as in the CLI; root locale supplies language.
  return spec;
}
/** The public chart ID of a card: type.variant, or the type alone for a one-form type. */
export const chartId = (type,variant) => variant.id ? `${type}.${variant.id}` : type;
export function cardId(type,variant,settings,width,theme,locale,withWidth) {
  // The ID lists the chosen settings, and parseId hands them back to makeSpec, so the round trip is exact
  // (a parent reset followed by a child choice included). A choice that leaves the spec unchanged is dropped,
  // so a card at default settings has none.
  const specOf=chosen=>JSON.stringify(makeSpec(variant,chosen,width,theme,locale,withWidth));
  const kept={...settings},full=specOf(kept);
  for(const key of Object.keys(kept).sort()){const {[key]:_,...rest}=kept;if(specOf(rest)===full)delete kept[key];}
  const choices=Object.keys(kept).sort()
    .map(key=>`${encodeURIComponent(key)}=${kept[key]===null?'engine-default':encodeURIComponent(label(kept[key]))}`).join('+');
  return `${chartId(type,variant)}${choices?'/'+choices:''}/${width}/${theme}/${locale}`;
}
export function parseId(catalog, id) {
  const bad = part => { throw new Error(`Malformed ID: ${part} in '${id}'`); };
  if(typeof id !== 'string') bad('expected a string');
  const parts=id.split('/');
  if(![4,5].includes(parts.length) || parts.some(part=>!part)) bad('expected chart[/settings]/width/theme/locale');
  const [type, variantId='']=parts[0].split('.'), [widthToken, theme, locale]=parts.slice(-3);
  const typeRow=catalog.types.find(row=>row.type===type);
  if(!typeRow) throw new Error(`Unknown type '${type}'`);
  const variant=typeRow.variants.find(row=>row.id===variantId);
  if(!variant) throw new Error(`Unknown chart '${parts[0]}'`);
  const width=catalog.widths.find(value=>String(value)===widthToken);
  if(width===undefined) throw new Error(`Width '${widthToken}' is not in the catalog`);
  if(!catalog.themes.includes(theme)) throw new Error(`Theme '${theme}' is not in the catalog`);
  if(!catalog.locales.includes(locale)) throw new Error(`Locale '${locale}' is not in the catalog`);
  const settings={};
  if(parts.length===5) for(const token of parts[1].split('+')) {
    const pair=token.split('=');
    if(pair.length!==2 || !pair[0] || !pair[1]) bad(`setting token '${token}'`);
    let key;
    try { key=decodeURIComponent(pair[0]); } catch { bad(`setting key '${pair[0]}'`); }
    const setting=variant.settings.find(row=>row.key===key);
    if(!setting) throw new Error(`Unknown setting key '${key}' for '${parts[0]}'`);
    if(Object.hasOwn(settings,key)) bad(`duplicate setting key '${key}'`);
    const valueToken=pair[1];
    const index=valueToken==='engine-default' && setting.engineDefault
      ? setting.values.findIndex(value=>value===null)
      : setting.values.findIndex(value=>encodeURIComponent(label(value))===valueToken);
    if(index===-1) throw new Error(`Value '${valueToken}' is not allowed for setting '${key}' in '${parts[0]}'`);
    Object.defineProperty(settings,key,{value:clone(setting.values[index]),enumerable:true,writable:true,configurable:true});
  }
  return {type,variant,settings,width,theme,locale};
}
