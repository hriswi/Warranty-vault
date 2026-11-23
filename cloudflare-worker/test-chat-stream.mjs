import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import worker from './src/index.js';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const project='test-project';
const jwt=encode({alg:'RS256',kid:'test'})+'.'+encode({aud:project,sub:'tester',iss:'https://securetoken.google.com/'+project,exp:Date.now()/1000+60});
const token=jwt+'.'+sign('sha256',Buffer.from(jwt),privateKey).toString('base64url');
globalThis.caches={default:{match:async()=>Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'test'}]})}};
let calls=0, complete;
const env={FIREBASE_PROJECT_ID:project,AI:{run:async(model,input)=>{
  calls++;assert.equal(input.stream,true);
  return new ReadableStream({start(c){
    const send=s=>c.enqueue(new TextEncoder().encode(s));
    send('data: {"res');send('ponse":"Hello"}\n\n');
    complete=()=>{send('data: [DONE]\n\n');c.close()};
  }});
}}};
const req=t=>new Request('https://test.invalid/api/ai/chat',{method:'POST',headers:t?{Authorization:'Bearer '+t}:{},body:JSON.stringify({messages:[{role:'user',content:'hello'}]})});
assert.equal((await worker.fetch(req(),env)).status,401);
const r=await worker.fetch(req(token),env);
assert.equal(r.status,200);
const reader=r.body.pipeThrough(new TextDecoderStream()).getReader();
assert.match((await reader.read()).value,/"meta"/);
assert.match((await reader.read()).value,/"text":"Hello"/);
complete();
assert.match((await reader.read()).value,/"done"/);
assert.equal(calls,1);
console.log('PASS authenticated chat, unauthorized rejection, fragmented tokens, reply before completion, one model request');
const products=[{productName:'Lenovo ThinkPad E14 Gen 5',category:'Laptop'},{productName:'Redmi Note 9',category:'Laptop'}];
const ask=(content)=>new Request('https://test.invalid/api/ai/chat',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({messages:[{role:'user',content}],products})});
let lookupUrl='',prompt='';
globalThis.fetch=async url=>{
  lookupUrl=decodeURIComponent(String(url));
  return new Response('<div class="result results_links"><a href="https://example.com/spec" class="result__a">Fixture model</a><a class="result__snippet">Fixture price INR 69900</a></div>');
};
env.AI.run=async(model, input)=>{
  prompt=JSON.stringify(input.messages);
  return new Response('data: {"response":"Test reply"}\n\ndata: [DONE]\n\n').body;
};
for(const [q,term] of [['Look up the specs for my laptop','ThinkPad E14 Gen 5'],['whats the new iphone price>','Apple India']]){
  const response=await worker.fetch(ask(q),env);
  assert.match(await response.text(),/"dataSource":"web"/);
  assert.ok(lookupUrl.includes(term));
  assert.ok(!prompt.includes('Redmi Note 9'));
}
globalThis.fetch=async()=>new Response('Service unavailable',{status:503});
assert.match(await (await worker.fetch(ask('whats the new iphone price>'),env)).text(),/Web search is unavailable/);
console.log('PASS laptop model lookup, India iPhone pricing route, source metadata and search failure');
const offlineSpecs = await (await worker.fetch(ask('wht specs does my laptop have'),env)).text();
assert.match(offlineSpecs,/1920/);
assert.match(offlineSpecs,/psref.lenovo.com/);
assert.doesNotMatch(offlineSpecs,/try again shortly/);
console.log('PASS manufacturer reference during a search outage');
