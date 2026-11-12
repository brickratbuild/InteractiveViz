import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { browserSession, sleep } from './browser-session.mjs';

const browser = await browserSession('validation/render-errors');
const results = [];
try {
  const run = async (name, source, expected) => {
    const script = await browser.call('Page.addScriptToEvaluateOnNewDocument', { source });
    await browser.call('Page.navigate', { url:'http://127.0.0.1:5173/local-validation?devModel=shareefa&quality=mobile' });
    let status;
    for (let i = 0; i < 200; i++) {
      await sleep(100);
      status = await browser.evaluate('document.getElementById("progressText")?.textContent');
      if (status === expected) break;
    }
    assert.equal(status, expected, name);
    assert.equal(await browser.evaluate('getComputedStyle(document.getElementById("clickPrompt")).display'), 'none');
    await browser.call('Page.removeScriptToEvaluateOnNewDocument', { identifier:script.identifier });
    results.push({name,status}); console.log('PASS',name);
  };
  await run('missing WebGL 2 reports rendering unavailable', `{
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type,...args) { return type === 'webgl2' ? null : get.call(this,type,...args); };
  }`, 'Rendering unavailable');
  await run('unsupported half-float HDR reports rendering unavailable', `{
    const get = WebGL2RenderingContext.prototype.getExtension;
    WebGL2RenderingContext.prototype.getExtension = function(name) {
      return ['EXT_color_buffer_float','EXT_color_buffer_half_float'].includes(name) ? null : get.call(this,name);
    };
  }`, 'Rendering unavailable');
  // Break the actual vendored shader patch target before the model arrives.
  await run('shader target mismatch reaches model error UI', `
    import('/lib/three/three.module.js').then(T => { T.ShaderChunk.lights_fragment_maps = T.ShaderChunk.lights_fragment_maps.replace('irradiance += lightMapIrradiance;', 'irradiance += vec3(0.0);'); });
  `, 'Model failed to load');
} catch (error) { results.push({error:error.stack}); console.error(error); process.exitCode = 1; }
finally { await writeFile('validation/render-errors/results.json',JSON.stringify(results,null,2)); await browser.close(); }
