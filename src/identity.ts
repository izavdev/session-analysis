/** Stable portable SHA-256 identities; excludes only deliberate export/run timestamps. */
export function canonicalJson(value:unknown):string {
  return JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)??'null';
}
export function sha256(value:string):string {
  const bytes=new TextEncoder().encode(value),length=bytes.length;
  const data=new Uint8Array(Math.ceil((length+9)/64)*64);data.set(bytes);data[length]=128;
  const view=new DataView(data.buffer);view.setUint32(data.length-8,Math.floor(length/0x20000000));view.setUint32(data.length-4,(length*8)>>>0);
  const constants:number[]=[],initial:number[]=[];
  for(let n=2;constants.length<64;n++){let prime=true;for(let d=2;d*d<=n;d++)if(n%d===0){prime=false;break;}if(prime){if(initial.length<8)initial.push((Math.sqrt(n)%1*0x100000000)>>>0);constants.push((Math.cbrt(n)%1*0x100000000)>>>0);}}
  const h=initial,w=new Uint32Array(64),rotate=(x:number,n:number)=>(x>>>n)|(x<<(32-n));
  for(let offset=0;offset<data.length;offset+=64){
    for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){const a=w[i-15]!,b=w[i-2]!;w[i]=(w[i-16]!+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]!+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
    let [a,b,c,d,e,f,g,z]=h as [number,number,number,number,number,number,number,number];
    for(let i=0;i<64;i++){const t1=(z+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]!+w[i]!)>>>0;const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
    [a,b,c,d,e,f,g,z].forEach((v,i)=>{h[i]=(h[i]!+v)>>>0;});
  }
  return h.map(x=>x.toString(16).padStart(8,'0')).join('');
}
export const fingerprint=(value:unknown):string=>sha256(canonicalJson(value));
