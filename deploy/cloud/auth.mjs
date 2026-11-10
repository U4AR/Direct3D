import {createHash,createHmac,timingSafeEqual,scryptSync,randomBytes} from 'node:crypto';
export const userKey=sub=>createHash('sha256').update(String(sub)).digest('hex').slice(0,32);
export function seal(value,key){const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+createHmac('sha256',key).update(body).digest('base64url');}
export function unseal(value,key,now=Date.now()){
 try{const [body,signature,...extra]=String(value||'').split('.');if(extra.length||!signature||body.length>8192)return null;const expected=createHmac('sha256',key).update(body).digest();const supplied=Buffer.from(signature,'base64url');if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return null;const data=JSON.parse(Buffer.from(body,'base64url'));return Number.isFinite(data.exp)&&data.exp>now?data:null;}catch{return null;}
}
export function hashPasscode(passcode,salt=randomBytes(16).toString('hex')){return salt+':'+scryptSync(String(passcode),salt,32).toString('hex');}
export function verifyPasscode(passcode,stored){try{if(!/^\d{8,12}$/.test(String(passcode)))return false;const [salt,digest]=stored.split(':');const expected=Buffer.from(digest,'hex'),actual=scryptSync(String(passcode),salt,32);return expected.length===actual.length&&timingSafeEqual(expected,actual);}catch{return false;}}
export function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s)).filter(x=>x.length>1).map(([k,v])=>[k,v]));}
export function sameOrigin(req,origin){return req.headers.origin===origin;}
export function sessionIdentity(session){return session&&typeof session.sub==='string'&&/^\d{5,40}$/.test(session.sub)&&typeof session.email==='string'?{sub:session.sub,email:session.email,key:userKey(session.sub)}:null;}
