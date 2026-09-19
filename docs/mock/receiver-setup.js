// Preview only. No device APIs or serial access.
const $ = s => document.querySelector(s);
const devices = [
  {id:'A', name:'USB 开发板', port:'COM14', serial:'…7A31', mac:'34:85:18:2C:7A:31'},
  {id:'B', name:'USB 开发板', port:'COM9', serial:'…92B4', mac:'48:CA:43:11:92:B4'},
];
let view='home', selected='', state='', busy=false, installed=false;
let timers=[], manualReady=false, recovery=false, retryOnline=false;
const mode=()=>$('#scenario').value;
const device=()=>devices.find(d=>d.id===selected);
function later(fn,ms){timers.push(setTimeout(fn,ms));}
function stop(){timers.forEach(clearTimeout);timers=[];}
function reset(){stop();busy=false;installed=false;if($('#wizard').open)$('#wizard').close();page(view);}
function page(v){
  view=v;
  $('#homeTab').classList.toggle('active',v==='home');
  $('#settingsTab').classList.toggle('active',v==='settings');
  $('#connection').innerHTML=installed?'<span class="badge">接收器已连接</span>':
    '<span class="dot"></span><span>未找到接收器</span>'+(mode()==='none'?'':'<button onclick="openWizard()">初始化接收器</button>');
  $('#main').innerHTML=v==='home'?
    `<h1>遥控器</h1><section class="surface empty"><div class="remote">·</div><h2>${installed?'接收器已就绪':'连接你的接收器'}</h2>${installed?'<button class="primary" onclick="addRemote()">添加遥控器</button>':''}</section>`:
    '<h1>设置</h1><section class="surface"><h3>高级</h3><div class="setting" style="margin-top:22px"><div><strong>初始化接收器</strong><p class="muted">安装或恢复接收器固件</p></div><button onclick="openWizard()">打开</button></div></section>';
}
function addRemote(){ $('#main').innerHTML='<section class="surface"><h2>添加遥控器</h2><p>请将遥控器置于配对模式</p><span class="spinner"></span>正在搜索…</section>'; }
function steps(n){return '<div class="steps">'+['1 连接开发板','2 安装','3 完成'].map((s,i)=>`<span class="${i===n?'active':i<n?'done':''}">${s}</span>`).join('')+'</div>';}
function footer(html){$('#footer').innerHTML=html;$('.close').disabled=busy;}
const cancel='<button class="back" onclick="closeWizard()">取消</button>';
function openWizard(){
  stop();selected='';manualReady=false;recovery=false;retryOnline=false;busy=false;
  $('#wizard').showModal();
  if(mode()==='package')blocked('package');else findBoard();
}
function closeWizard(){if(busy)return;stop();$('#wizard').close();}
$('#wizard').addEventListener('cancel',e=>{if(busy)e.preventDefault();else stop();});
function previewArrival(){return '<div class="preview-action"><strong>仅预览</strong><br><button id="simulateArrival" onclick="arrive()">模拟已按 BOOT 重新插入</button></div>';}
function findBoard(){
  stop();state='find';busy=false;
  if(mode()==='none'&&!manualReady){
    $('#body').innerHTML=steps(0)+'<h2>连接开发板</h2><p>用 USB 数据线连接电脑。</p><div class="work"><p class="waiting" role="status"><span class="spinner"></span>等待设备连接</p><button class="subtle" onclick="bootHelp()">仍未找到？</button></div>';
    footer(cancel);return;
  }
  const list=mode()==='multiple'?devices:[devices[0]];
  const multiple=list.length>1;
  $('#body').innerHTML=steps(0)+`<h2>${multiple?'选择你的开发板':'发现一块开发板'}</h2>`+
    (multiple?'<p class="muted">不确定时，拔下再插回你的开发板。</p>':'')+
    '<div class="devices">'+list.map(d=>multiple?
      `<label class="device"><input type="radio" name="device" value="${d.id}" onchange="selected=this.value;$('#connect').disabled=false"><span class="board" aria-hidden="true"></span><span><strong>${d.name} · ${d.port}</strong><small>标识 ${d.serial}</small></span></label>`:
      `<div class="device"><span class="board" aria-hidden="true"></span><span><strong>${d.name} · ${d.port}</strong><small>标识 ${d.serial}</small></span></div>`).join('')+
    '</div><p class="muted">连接会重启这块开发板，不清除数据。</p><button class="subtle" onclick="bootHelp()">没有我的设备</button>';
  // One candidate is shown, but the user must explicitly connect before resetting it.
  if(!multiple)selected=list[0].id;else selected='';
  footer(cancel+`<button id="connect" class="primary" ${multiple?'disabled':''} onclick="inspect()">${multiple?'连接所选设备':'连接这块开发板'}</button>`);
}
function bootHelp(){
  stop();state='boot';busy=false;
  $('#body').innerHTML=steps(0)+'<h2>按住 BOOT，重新插入</h2><ol class="manual"><li>拔下开发板的 USB。</li><li>按住 <span class="key">BOOT</span>，重新插入 USB。</li><li>松开 <span class="key">BOOT</span>。</li></ol><p class="waiting" role="status"><span class="spinner"></span>等待开发板</p><details><summary>仍未找到？</summary><p>换一根支持数据传输的 USB 线，直接连接电脑。若开发板有两个 USB 接口，尝试另一个。</p><p>没有 BOOT 按钮时，请查阅开发板说明。</p></details>'+previewArrival();
  footer('<button class="back" onclick="findBoard()">返回</button><button onclick="closeWizard()">取消</button>');
}
function arrive(){
  if(state!=='boot')return;
  manualReady=true;
  // Real implementation must resolve physical identity, not pick the first port.
  if(!selected){findBoard();return;}
  inspect();
}
function inspect(){
  if(!device())return;
  stop();state='checking';busy=true;
  $('#body').innerHTML=steps(0)+'<h2>正在连接开发板</h2><div class="work" role="status"><p><span class="spinner"></span>检查安装条件</p><p class="muted">'+device().port+' · 标识 '+device().serial+'</p></div>';
  footer('<button disabled>连接中…</button>');
  later(()=>{
    busy=false;
    if(mode()==='manual'&&!manualReady){bootHelp();return;}
    if(['incompatible','unknown','protected'].includes(mode())){blocked(mode());return;}
    confirmInstall();
  },900);
}
function blocked(reason){
  busy=false;state='blocked';
  const copy={
    incompatible:['这块开发板暂不支持','请使用兼容的 ESP32-S3 开发板。','检测到 ESP32-C6。'],
    unknown:['暂时无法确认兼容性','请核对开发板型号。','已检测 ESP32-S3 / 16 MB Flash；未确认 PSRAM。要求 8 MB Octal PSRAM。'],
    protected:['这块开发板受保护','无法安装接收器固件。','设备启用了安全启动或 Flash 加密。'],
    package:['缺少安装文件','请使用附带接收器固件的应用版本。','当前应用没有适用的完整安装包。'],
  }[reason];
  $('#body').innerHTML=steps(0)+`<h2>${copy[0]}</h2><div class="notice warning" role="alert">${copy[1]}</div><p class="muted">未清除原有数据。</p><details><summary>详情</summary><p>${copy[2]}</p></details>`;
  footer((reason==='package'?'':'<button class="back" onclick="selected=\'\';findBoard()">换一块开发板</button>')+'<button onclick="closeWizard()">关闭</button>');
}
function target(){return `<div class="device"><span class="board" aria-hidden="true"></span><span><strong>ESP32-S3 · ${device().port}</strong><small>标识 ${device().serial}</small></span></div>`;}
function confirmInstall(){
  busy=false;state='confirm';
  $('#body').innerHTML=steps(1)+`<h2>${recovery?'重新安装接收器':'安装接收器'}</h2>`+target()+
    '<details><summary>设备与版本</summary><p>设备 ID：'+device().mac+'<br>16 MB Flash / 8 MB Octal PSRAM<br>接收器固件 0.8.0</p></details>'+
    '<div class="notice warning"><strong>将清除这块开发板的全部内容。</strong><br>原程序、设置及配对信息会丢失。不备份，无法撤销。</div><label class="agree"><input id="consent" type="checkbox" onchange="$(\'#install\').disabled=!this.checked"><span>确认清除以上设备并安装</span></label>';
  footer('<button class="back" onclick="findBoard()">返回</button><button id="install" class="danger" disabled onclick="install()">清除并安装</button>');
}
function install(){
  if(!$('#consent')?.checked||state!=='confirm')return;
  if(mode()==='changed'){
    state='lost';selected='';
    $('#body').innerHTML=steps(0)+'<h2>开发板已断开</h2><p role="alert">未开始安装。请重新连接。</p>';
    footer(cancel+'<button class="primary" onclick="findBoard()">重新连接</button>');return;
  }
  state='writing';busy=true;progress(0);let n=0;
  function tick(){
    n++;
    if(mode()==='failure'&&!recovery&&n===2){failed();return;}
    if(n<5){progress(n);later(tick,650);}else finish();
  }
  later(tick,650);
}
function progress(n){
  $('#body').innerHTML=steps(1)+'<h2>正在安装</h2><p class="muted">'+device().port+' · 标识 '+device().serial+'</p><div class="work" role="status"><p>'+['清除原有内容','写入接收器','校验安装','重启开发板','等待接收器连接'][n]+'</p><div class="track" role="progressbar" aria-label="安装进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+[5,35,70,85,95][n]+'"><i style="width:'+ [5,35,70,85,95][n]+'%"></i></div><p class="muted">请勿拔出设备或退出应用。</p></div>';
  footer('<button disabled>安装中…</button>');
}
function failed(){
  busy=false;state='failed';
  $('#body').innerHTML=steps(1)+'<h2>安装中断</h2><div class="notice warning" role="alert">USB 已断开，原程序可能已被清除。</div><p>请重新连接这块开发板。</p><details><summary>错误详情</summary><p>设备 '+device().mac+'<br>写入失败：串口连接中断</p></details>';
  footer('<button class="back" onclick="closeWizard()">关闭</button><button class="primary" onclick="recovery=true;bootHelp()">继续恢复</button>');
}
function finish(){
  busy=false;
  if(mode()==='reboot'&&!retryOnline){
    state='waiting';
    $('#body').innerHTML=steps(2)+'<h2>安装已写入，尚未连接</h2><p>松开 BOOT，重新插入 USB。</p><details><summary>仍未连接？</summary><p>双 USB 接口的开发板，请连接原生 USB 接口。</p></details><p class="waiting"><span class="spinner"></span>等待接收器</p><div class="preview-action"><strong>仅预览</strong><br><button id="simulateOnline" onclick="retryOnline=true;finish()">模拟接收器上线</button></div>';
    footer('<button onclick="closeWizard()">稍后检查</button>');return;
  }
  state='done';installed=true;
  $('#body').innerHTML=steps(2)+'<div class="compact-result"><div class="result-symbol">✓</div><h2>接收器已就绪</h2></div>';
  footer('<button onclick="closeWizard();page(\'home\')">完成</button><button class="primary" onclick="closeWizard();page(\'home\');addRemote()">添加遥控器</button>');page(view);
}
page('home');
