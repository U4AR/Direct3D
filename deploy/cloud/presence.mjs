export class PresencePool{
 constructor({limit=2,ttlMs=90000,now=Date.now}={}){this.limit=limit;this.ttlMs=ttlMs;this.now=now;this.users=new Map();}
 prune(){const now=this.now();for(const [key,user]of this.users)if(!user.requests&&user.until<=now)this.users.delete(key);}
 enter(key){this.prune();let user=this.users.get(key);if(!user&&this.users.size>=this.limit)return {allowed:false,limit:this.limit,retryAfter:20};if(!user){user={requests:0};this.users.set(key,user);}user.leaving=false;user.until=this.now()+this.ttlMs;return {allowed:true,limit:this.limit,active:this.users.size};}
 begin(key){const result=this.enter(key);if(!result.allowed)return result;this.users.get(key).requests++;return result;}
 end(key){const user=this.users.get(key);if(user){user.requests=Math.max(0,user.requests-1);if(user.leaving&&!user.requests)this.users.delete(key);else user.until=this.now()+this.ttlMs;}}
 leave(key){const user=this.users.get(key);if(user?.requests)user.leaving=true;else this.users.delete(key);}
}
