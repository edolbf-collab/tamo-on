export function createDeliveryHandler({apply}) {
 return async req=>{
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(req.headers.has('origin'))return reply(403,{error:'SERVER_DELIVERY_REQUIRED'});
  if(!req.headers.get('content-type')?.startsWith('application/json'))return reply(400,{error:'INVALID_DELIVERY'});
  try {
   const reader=req.body?.getReader();if(!reader)return reply(400,{error:'INVALID_DELIVERY'});
   const chunks=[];let length=0;
   while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>1200000){await reader.cancel();return reply(413,{error:'DELIVERY_TOO_LARGE'})}chunks.push(value)}
   const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   const body=JSON.parse(new TextDecoder().decode(bytes));
   if(typeof body.p_payload!=='string'||typeof body.p_signature!=='string'||!/^[0-9a-f]{64}$/.test(body.p_signature))return reply(400,{error:'INVALID_DELIVERY'});
   // The database verifies HMAC, timestamp, nonce, operator and exact test group before applying.
   const {data,error}=await apply({p_payload:body.p_payload,p_signature:body.p_signature});
   if(error)return reply(error.code==='PT403'?403:503,{error:error.code==='PT403'?'DELIVERY_DENIED':'DELIVERY_UNAVAILABLE'});
   if(data?.ok!==true)return reply(503,{error:'DELIVERY_UNAVAILABLE'});
   return reply(200,data);
  }catch{return reply(400,{error:'INVALID_DELIVERY'})}
 };
}
