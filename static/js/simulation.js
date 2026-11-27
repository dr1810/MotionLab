const el=id=>document.getElementById(id),canvas=el('scene'),ctx=canvas.getContext('2d');
let time=0,active=false,ended=false,last=0,angle=45,speed=17;
function draw(){
 const w=canvas.clientWidth,h=canvas.clientHeight,d=window.devicePixelRatio||1;
 if(canvas.width!==Math.round(w*d)||canvas.height!==Math.round(h*d)){canvas.width=Math.round(w*d);canvas.height=Math.round(h*d)}
 ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);
 const s=(w-60)/70,left=25,ground=h-45,r=angle*Math.PI/180,vx=speed*Math.cos(r),vy=speed*Math.sin(r);
 const pos=t=>[left+vx*t*s,ground-(vy*t-4.905*t*t)*s];
 ctx.strokeStyle='#eee8f5';ctx.lineWidth=1;
 for(let x=left;x<w;x+=s*10){ctx.beginPath();ctx.moveTo(x,15);ctx.lineTo(x,ground);ctx.stroke()}
 ctx.strokeStyle='#cfc4dc';ctx.beginPath();ctx.moveTo(left,ground);ctx.lineTo(w-15,ground);ctx.stroke();
 ctx.strokeStyle='#9c78db';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(left+28*s,ground);ctx.lineTo(left+32*s,ground);ctx.stroke();
 ctx.fillStyle='#8a7a9c';ctx.font='11px system-ui';ctx.fillText('0 m',left-8,ground+24);ctx.fillText('Target · 30 m',left+30*s-36,ground+24);
 if(time>0){ctx.strokeStyle='#b49bdc';ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<=80;i++){const p=pos(time*i/80);i?ctx.lineTo(...p):ctx.moveTo(...p)}ctx.stroke()}
 const p=pos(time);ctx.fillStyle='#7953cf';ctx.beginPath();ctx.arc(p[0],p[1]-6,6,0,Math.PI*2);ctx.fill();
 const x=vx*time,y=Math.max(0,vy*time-4.905*time*time);
 el('measurements').textContent=`Time ${time.toFixed(2)} s · Distance ${x.toFixed(1)} m · Height ${y.toFixed(1)} m`;
}
function reset(){active=false;ended=false;time=0;angle=+el('angle').value;speed=+el('speed').value;el('status').textContent='Ready to launch';el('launch').textContent='▶ Launch';draw()}
el('controls').onsubmit=e=>{e.preventDefault();if(ended)reset();active=!active;last=performance.now();el('launch').textContent=active?'Ⅱ Pause':'▶ Resume';el('status').textContent=active?'Experiment running':'Paused'};
el('reset').onclick=reset;
for(const id of ['angle','speed'])el(id).oninput=()=>{el(id+'Value').textContent=el(id).value+(id==='angle'?'°':' m/s');reset()};
function frame(now){if(active){time+=Math.min((now-last)/1000,.05);const r=angle*Math.PI/180,end=2*speed*Math.sin(r)/9.81;if(time>=end){time=end;active=false;ended=true;const x=speed*Math.cos(r)*time,miss=Math.abs(x-30);el('status').textContent=miss<=2?'✓ Delivery successful!':`Missed ${x<30?'short':'long'} by ${miss.toFixed(1)} m. Adjust and try again.`;el('launch').textContent='▶ Try again'}draw()}last=now;requestAnimationFrame(frame)}
window.addEventListener('resize',draw);reset();requestAnimationFrame(frame);
