// Bounded expression interpreter: no JavaScript evaluation, property calls, or assignments.
const denied=new Set(["__proto__","prototype","constructor"]);
const numeric=x=>{if(typeof x!=="number"||!Number.isFinite(x))throw Error("Expected finite number");return x;};
const array=x=>{if(!Array.isArray(x)||x.length>50000)throw Error("Expected bounded numeric array");return x.map(numeric);};
const dot=(a,b)=>{a=array(a);b=array(b);if(a.length!==b.length)throw Error("Vector sizes differ");return a.reduce((s,n,i)=>s+n*b[i],0);};
const functions={sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,atan2:Math.atan2,sqrt:Math.sqrt,abs:Math.abs,exp:Math.exp,log:Math.log,pow:Math.pow,floor:Math.floor,ceil:Math.ceil,round:Math.round,
 min:(...x)=>Math.min(...(Array.isArray(x[0])?array(x[0]):x.map(numeric))),max:(...x)=>Math.max(...(Array.isArray(x[0])?array(x[0]):x.map(numeric))),
 sum:x=>array(x).reduce((s,n)=>s+n,0),mean:x=>{x=array(x);if(!x.length)throw Error("Empty mean");return x.reduce((s,n)=>s+n,0)/x.length;},
 dot,norm:x=>Math.sqrt(dot(x,x)),cross:(a,b)=>{a=array(a);b=array(b);if(a.length!==3||b.length!==3)throw Error("Cross product needs XYZ");return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];},
 unit:x=>{x=array(x);const n=Math.sqrt(dot(x,x));if(n<1e-12)throw Error("Zero direction");return x.map(v=>v/n);},clamp:(x,a,b)=>Math.max(a,Math.min(b,x)),lerp:(a,b,t)=>a+(b-a)*t,
 column:(rows,index)=>{if(!Array.isArray(rows)||rows.length>50000||!Number.isInteger(index))throw Error("Invalid column");return rows.map(row=>numeric(row[index]));},count:x=>{if(!Array.isArray(x))throw Error("Expected array");return x.length;}};
export function evaluateExpression(expression,bindings={}) {
 if(typeof expression!=="string"||expression.length>4096)throw Error("Expression must be at most 4096 characters");
 const tokens=[];const re=/\s*(?:(\d*\.\d+(?:e[+-]?\d+)?|\d+(?:\.\d*)?(?:e[+-]?\d+)?)|([a-zA-Z_][a-zA-Z_0-9]*)|(\*\*|[+*/%\-^()[\],.]))/gy;let at=0;
 while(at<expression.trimEnd().length){re.lastIndex=at;const m=re.exec(expression);if(!m)throw Error("Unsupported expression syntax at "+at);tokens.push(m[1]?{number:Number(m[1])}:{text:m[2]||m[3]});at=re.lastIndex;}if(tokens.length>2048)throw Error("Expression too complex");
 let i=0,depth=0,operations=0;const peek=()=>tokens[i]?.text;const take=t=>{if(peek()!==t)throw Error("Expected "+t);i++;};
 const own=(o,k)=>{if(denied.has(String(k))||!o||!Object.hasOwn(o,k))throw Error("Unknown field or variable "+k);return o[k];};
 function atom(){if(++depth>48)throw Error("Expression nesting too deep");let value;const t=tokens[i++];if(!t)throw Error("Incomplete expression");
 if(t.number!==undefined)value=t.number;
 else if(t.text==="+"||t.text==="-")value=(t.text==="-"?-1:1)*numeric(parse(3));
 else if(t.text==="("){value=parse(0);take(")");}
 else if(t.text==="["){value=[];if(peek()!=="]")do{value.push(parse(0));if(peek()!==",")break;i++;}while(true);take("]");}
 else if(/^[A-Za-z_]/.test(t.text)){
 if(peek()==="("){if(!Object.hasOwn(functions,t.text))throw Error("Unknown mathematical function");i++;const args=[];if(peek()!==")")do{args.push(parse(0));if(peek()!==",")break;i++;}while(true);take(")");value=functions[t.text](...args);}
 else value=Object.hasOwn(bindings,t.text)?own(bindings,t.text):own({pi:Math.PI,e:Math.E},t.text);
 }else throw Error("Unexpected token");
 while(peek()==="["||peek()==="."){if(peek()==="["){i++;const k=parse(0);take("]");if(!Number.isInteger(k)||k<0)throw Error("Array index must be nonnegative integer");value=own(value,k);}else{i++;const k=tokens[i++]?.text;if(!k||denied.has(k))throw Error("Invalid field");value=own(value,k);}}
 depth--;return value;}
 function parse(min){let lhs=atom();const prec={"+":1,"-":1,"*":2,"/":2,"%":2,"^":4,"**":4};while(peek()&&Object.hasOwn(prec,peek())&&prec[peek()]>=min){if(++operations>10000)throw Error("Operation budget exceeded");const op=peek(),p=prec[op];i++;const rhs=parse(p+(["^","**"].includes(op)?0:1)),a=numeric(lhs),b=numeric(rhs);lhs=op==="+"?a+b:op==="-"?a-b:op==="*"?a*b:op==="/"?a/b:op==="%"?a%b:a**b;}return lhs;}
 const result=parse(0);if(i!==tokens.length)throw Error("Trailing expression tokens");
 function check(x,d=0){if(d>20)throw Error("Result nesting too deep");if(Array.isArray(x)){if(x.length>50000)throw Error("Result too large");x.forEach(v=>check(v,d+1));}else numeric(x);}check(result);return result;
}
