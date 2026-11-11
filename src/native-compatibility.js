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
  // Local spawn/fork with prepareContinuable, no advertised preset choices:
  // modelSelection false / true. External backend wording is not accepted.
  subagent:Object.freeze([
    'a6a76b87abf319cb2f43adf0da96e0b570680e4cc269d4bc72ef4ca34fdd413f',
    '21cdbcfd5a3f328ec0534d94588532df640d1059c11c981676e0836217816997',
  ]),
  subagent_fork:Object.freeze([
    '8a18fed1e8b6da9c8bc53e04e5fda59c0e915e697770709b643eff69224668c1',
    '50246caadde2321f2530b3cc4225bbba5c5380c112e917b3d3be138d0fb17631',
  ]),
  list_subagent_models:'5699955155bb4ca8884f22cadee1a7a331f9b664369fb4acafe9ccf8bd9c21c6',
  list_agents:'eaa290d3eebb15c164317039b3fc5e3ce9ebd82c9a4eb11f403504fb78c1bb14',
  send_message:'67f194b404146c38e68900831acb913ddbdb6709a85e3150ab5d731fd7bffd94',
  interrupt_agent:'4df2673a920841c9fac27af2a7841eaf78fac00e455bfcad6a11a3c39ab34c6c',
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
  const hash=createHash('sha256').update(JSON.stringify(canonical(schema))).digest('hex');
  const expected=SCHEMAS[definition.name];
  return Array.isArray(expected)?expected.includes(hash):hash===expected;
}
