/** Browser-side UUIDv7 for a durable request that is also the server resource identity. */
export function resourceRequestId():string {
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  let timestamp=Date.now();for(let i=5;i>=0;i--){bytes[i]=timestamp%256;timestamp=Math.floor(timestamp/256);}
  bytes[6]=(bytes[6]!&15)|0x70;bytes[8]=(bytes[8]!&63)|0x80;
  const value=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
}
