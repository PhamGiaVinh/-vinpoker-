import {assertEquals} from 'https://deno.land/std@0.224.0/assert/mod.ts';
Deno.test('dispatcher preserves canary hand scope and rejects malformed bodies without global invocation',async()=>{
 const oldServe=Deno.serve,oldFetch=globalThis.fetch;
 const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TRACKER_HISTORY_COMPLETION_WORKER_ENABLED'];
 const previous=names.map(name=>Deno.env.get(name)); let handler:(req:Request)=>Promise<Response>;
 Object.defineProperty(Deno,'serve',{configurable:true,value:(fn:typeof handler)=>{handler=fn;}});
 names.forEach((name,i)=>Deno.env.set(name,['https://backend.invalid','dispatcher-service-fixture','true'][i]));
 const id='00000000-0000-4000-8000-000000000001';
 const call=(body:string)=>handler!(new Request('https://dispatcher.invalid',{method:'POST',headers:{authorization:'Bearer dispatcher-service-fixture'},body}));
 try {
  await import('./index.ts'); let forwarded=0;
  globalThis.fetch=()=>{forwarded++;throw new Error('invalid request was forwarded');};
  for(const body of ['{"hand_ids":[','[]','123','null','{"hand_ids":[]}','{"hand_ids":["bad"]}']) {
   const response=await call(body);assertEquals(response.status,400);await response.json();
  }
  assertEquals(forwarded,0);
  globalThis.fetch=(input,init)=>{
   assertEquals(String(input),'https://backend.invalid/functions/v1/tournament-historical-settlement-worker');
   assertEquals(JSON.parse(String((init as {body?:unknown})?.body)),{limit:1,hand_ids:[id]});
   forwarded++; return Promise.resolve(new Response(JSON.stringify({ok:true,claimed:1,completed:1}),{status:200}));
  };
  const response=await call(JSON.stringify({limit:1,hand_ids:[id]}));assertEquals(response.status,200);await response.json();assertEquals(forwarded,1);
 } finally {
  globalThis.fetch=oldFetch;Object.defineProperty(Deno,'serve',{configurable:true,value:oldServe});
  names.forEach((name,i)=>previous[i]===undefined?Deno.env.delete(name):Deno.env.set(name,previous[i]!));
 }
});
