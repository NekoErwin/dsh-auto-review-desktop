import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// DSH_TEST_RUNTIME names a dsh runtime directory containing node_modules.
const runtime=process.env.DSH_TEST_RUNTIME
  ? pathToFileURL(resolve(process.env.DSH_TEST_RUNTIME,'package.json'))
  : new URL('../runtime-test/dsh/package.json',import.meta.url);
const runtimeRequire=createRequire(runtime);
registerHooks({resolve(specifier,context,nextResolve){
  try{return nextResolve(specifier,context);}catch(error){
    if(!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.includes(':')) {
      try{return nextResolve(pathToFileURL(runtimeRequire.resolve(specifier)).href,context);}catch{}
    }
    throw error;
  }
}});
