import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { zipSync, strToU8 } from 'fflate';
import { stageAssets, validateBundle } from '../tools/stage-assets.mjs';
const root = await mkdtemp(join(tmpdir(), 'harbor-staging-'));
try {
  const prefix = 'Payload/HarborMasterHD.app/';
  const files = ['hmhd0001-texture.png','spritesTexture.png','hmhd0001.lvl','HarborMasterSeagulls.mp3','sound.caf'];
  const bundle = zipSync(Object.fromEntries(files.map(name => [prefix + name, strToU8('synthetic')])));
  assert.equal(validateBundle(bundle).effects, 1);
  assert.throws(() => validateBundle(strToU8('not zip')), /valid ZIP|empty/);
  let seen;
  const result = await stageAssets({root, env: {HARBOR_ASSET_BUNDLE_URL:'https://assets.example/test?private=yes', HARBOR_ASSET_BUNDLE_TOKEN:'token'},
    fetchFn: async (url, options) => { seen = {url,options}; return new Response(bundle,{status:200}); }});
  assert.equal(result.source,'url');
  assert.equal(seen.options.headers.authorization,'Bearer token');
  assert.equal(seen.options.redirect,'error');
  assert.deepEqual(new Uint8Array(await readFile(result.output)), bundle);
  assert.equal((await stageAssets({root, env:{}})).source,'existing');
  await assert.rejects(stageAssets({root,env:{HARBOR_ASSET_BUNDLE_URL:'http://example.com/a'}}),/HTTPS/);
  await assert.rejects(stageAssets({root,env:{HARBOR_ASSET_BUNDLE_URL:'https://example.com/a',HARBOR_HD_IPA:'file'}}),/only one/);
  await assert.rejects(stageAssets({root,env:{HARBOR_ASSET_BUNDLE_URL:'https://example.com/a'},fetchFn:async()=>new Response('<html>bad</html>')}),/ZIP|empty/);
  console.log('PASS: optional HTTPS asset staging, token handling, archive validation, and local reuse');
} finally { await rm(root,{recursive:true,force:true}); }
