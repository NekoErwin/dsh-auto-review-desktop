import { createHash } from 'node:crypto';

// Compatibility fingerprints from the actual built-in schemas in DSH 0.2.2-rc.1.
// This is not code authentication: installed Host plugins are trusted and can
// execute arbitrary code. A name alone never enables the workspace fast path.
const SCHEMAS=Object.freeze({
  read:'5a539360351b27737aa9e7429eb8c94975038a07b303e713a4b03d20399183e3',
  read_image:'eb5f0beb6117a9e0a1ed9075113de3eada4c0bbf576ec392118d4826914168a5',
  write:'2bbccce335cc754d712a178fbc030e0d6b4a068c138d24938cf7080f13424682',
  edit:'a74fbc7f3bbdebcb7537720430ce603b28cbc29244d7474a7dfe2344cda871a3',
  apply_patch:'3e136ab7346e28b59debc32360d416790a83e507035d3b94ac1948f28e7f724c',
  pwsh:'ce0a69a26a7745b9b701058a380ffc182889e37b10fdef11df0257c400ce02c3',
  bash:'59ed3b135d3fa6f192b1b497720d1873631f0327db3f055f28b6a2766ab65afd',
  glob:'a63d3f55eff811fdeb376cf024e26dc0899ede42bf70b1781c98bf4825581ebf',
  grep:'0207a37259c7602217ae6a6f70a321e2b12723c9b95f8afdd424f5e63591d649',
  working_directory:'94e5b848621fc3b00f96df75d5ff8cb75fe10aaad8aad35ec2612be4569eac4a',
});
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export function nativeCompatible(definition) {
  if(!definition || !SCHEMAS[definition.name])return false;
  const schema={name:definition.name,description:definition.description,parameters:definition.parameters,
    ...definition.deferLoading===true?{deferLoading:true}:{}};
  return createHash('sha256').update(JSON.stringify(canonical(schema))).digest('hex')===SCHEMAS[definition.name];
}
