import crypto from 'node:crypto';

function frameText(value){
  const payload=Buffer.from(JSON.stringify(value));
  if(payload.length<126){const out=Buffer.alloc(2+payload.length);out[0]=0x81;out[1]=payload.length;payload.copy(out,2);return out;}
  if(payload.length<65536){const out=Buffer.alloc(4+payload.length);out[0]=0x81;out[1]=126;out.writeUInt16BE(payload.length,2);payload.copy(out,4);return out;}
  const out=Buffer.alloc(10+payload.length);out[0]=0x81;out[1]=127;out.writeBigUInt64BE(BigInt(payload.length),2);payload.copy(out,10);return out;
}
function framePong(payload=Buffer.alloc(0)){const out=Buffer.alloc(2+payload.length);out[0]=0x8A;out[1]=payload.length;payload.copy(out,2);return out;}
function closeFrame(){return Buffer.from([0x88,0x00]);}

function parseFrames(buffer){
  const messages=[];let offset=0;
  while(buffer.length-offset>=2){
    const first=buffer[offset],second=buffer[offset+1],opcode=first&0x0f,masked=Boolean(second&0x80);let len=second&0x7f,header=2;
    if(len===126){if(buffer.length-offset<4)break;len=buffer.readUInt16BE(offset+2);header=4;}
    else if(len===127){if(buffer.length-offset<10)break;const big=buffer.readBigUInt64BE(offset+2);if(big>BigInt(10*1024*1024))throw new Error('Frame too large.');len=Number(big);header=10;}
    const maskBytes=masked?4:0;if(buffer.length-offset<header+maskBytes+len)break;
    let payload=buffer.subarray(offset+header+maskBytes,offset+header+maskBytes+len);
    if(masked){const mask=buffer.subarray(offset+header,offset+header+4);payload=Buffer.from(payload);for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];}
    messages.push({opcode,payload});offset+=header+maskBytes+len;
  }
  return {messages,remaining:buffer.subarray(offset)};
}

export function createTrackingRealtimeServer({httpServer,authenticate,repository}){
  const subscribers=new Map();const clients=new Set();
  const subscribe=(bookingId,client)=>{let set=subscribers.get(String(bookingId));if(!set){set=new Set();subscribers.set(String(bookingId),set);}set.add(client);client.bookingId=String(bookingId);};
  const unsubscribe=(client)=>{if(client.bookingId){const set=subscribers.get(client.bookingId);if(set){set.delete(client);if(!set.size)subscribers.delete(client.bookingId);}}clients.delete(client);};
  const broadcast=(bookingId,payload)=>{const set=subscribers.get(String(bookingId));if(!set)return;const frame=frameText(payload);for(const client of [...set]){try{client.socket.write(frame);}catch{unsubscribe(client);}}};
  httpServer.on('upgrade',async(req,socket)=>{
    try{
      const url=new URL(req.url||'/','http://localhost');if(!url.pathname.startsWith('/ws/tracking/'))return;
      const bookingId=decodeURIComponent(url.pathname.slice('/ws/tracking/'.length));if(!bookingId){socket.destroy();return;}
      const protocols=String(req.headers['sec-websocket-protocol']||'').split(',').map(x=>x.trim());const authProtocol=protocols.find(x=>x.startsWith('rideon-auth.'));const token=authProtocol?.slice('rideon-auth.'.length)||'';
      if(!token){socket.write('HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\n');socket.destroy();return;}
      const user=await authenticate(token);if(!user){socket.write('HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\n');socket.destroy();return;}
      const tracking=await repository.getTrackingForCustomer(user.id,bookingId);if(!tracking?.session||tracking.booking.deliveryStatus!=='in_delivery'){socket.write('HTTP/1.1 409 Conflict\\r\\nConnection: close\\r\\n\\r\\n');socket.destroy();return;}
      const key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return;}
      const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+accept+'\\r\\nSec-WebSocket-Protocol: '+authProtocol+'\\r\\n\\r\\n');
      socket.setNoDelay(true);const client={socket,userId:String(user.id),bookingId:String(bookingId)};clients.add(client);subscribe(bookingId,client);socket.write(frameText({type:'tracking.snapshot',tracking}));
      let buffered=Buffer.alloc(0);socket.on('data',(chunk)=>{try{buffered=Buffer.concat([buffered,chunk]);const parsed=parseFrames(buffered);buffered=parsed.remaining;for(const message of parsed.messages){if(message.opcode===0x8){socket.write(closeFrame());socket.end();return;}if(message.opcode===0x9)socket.write(framePong(message.payload));}}catch{try{socket.write(closeFrame());socket.end();}catch{}}});
      socket.on('close',()=>unsubscribe(client));socket.on('end',()=>unsubscribe(client));socket.on('error',()=>unsubscribe(client));
    }catch{try{socket.write('HTTP/1.1 503 Service Unavailable\\r\\nConnection: close\\r\\n\\r\\n');}catch{}socket.destroy();}
  });
  return {broadcast,close(){for(const client of clients){try{client.socket.end(closeFrame());}catch{}}clients.clear();subscribers.clear();}};
}