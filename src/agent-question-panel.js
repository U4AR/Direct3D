export const QUESTION_ACTIONS=[];
export function questionActionAt(uv){if(!uv)return null;const x=uv.x*900,y=(1-uv.y)*720;return y>=628&&y<=678?QUESTION_ACTIONS.find(b=>x>=b.x&&x<=b.x+272)?.action||null:null;}
export const questionOptionAt=(uv,count)=>{if(!uv)return null;const x=uv.x*900,y=(1-uv.y)*720;if(x<24||x>876)return null;const i=Math.floor((y-330)/72);return i>=0&&i<count&&y<=330+i*72+62?i:null;};
export function drawAgentQuestion(canvas,question){const c=canvas.getContext("2d");c.fillStyle="#112333";c.fillRect(0,0,900,720);c.strokeStyle="#bcf477";c.lineWidth=5;c.strokeRect(3,3,894,714);
 function wrap(text,x,y,maxWidth,lineHeight,maxLines){let line="",lines=0;for(const word of text.split(/\s+/)){if(c.measureText(line+word).width>maxWidth&&line){c.fillText(line,x,y);line="";y+=lineHeight;if(++lines>=maxLines)return;}line+=word+" ";}if(lines<maxLines)c.fillText(line,x,y);}
 c.fillStyle="#bcf477";c.font="bold 26px sans-serif";c.fillText("DESIGN QUESTION",24,40);c.fillStyle="#f1f6ff";c.font=question.question.length>360?"22px sans-serif":"28px sans-serif";wrap(question.question,24,84,850,30,8);
 (question.options||[]).forEach((option,i)=>{const y=330+i*72;c.fillStyle="#2d4356";c.fillRect(24,y,852,62);c.fillStyle="#fff";c.font="23px sans-serif";wrap((i+1)+". "+option,38,y+25,820,26,2);});
 QUESTION_ACTIONS.forEach(b=>{c.fillStyle="#2d4356";c.fillRect(b.x,628,272,50);c.fillStyle="#fff";c.font="22px sans-serif";c.fillText(b.label,b.x+14,660);});
 c.fillStyle="#bcf477";c.font="18px sans-serif";c.fillText("Answer in your own words by speech or text. AI waits for you.",24,706);
}
