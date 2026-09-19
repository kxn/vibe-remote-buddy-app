"""Real React wizard with simulated native boundary; no board access."""
from pathlib import Path
from datetime import datetime
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
out=root/'build/diagnostics'/(datetime.now().strftime('%Y%m%d-%H%M%S')+'-receiver-setup-ui')
out.mkdir(parents=True)
fixture=(root/'tests/ui-native-fixture.js').read_text(encoding='utf-8').replace('firmware: "ui-fixture",','firmware: "buddy-0.8.0", confirmed:true, target:"s3-o8-ab1", flash_bytes:16777216, psram_bytes:8388608,')
extension='''
const original=window.__TAURI_INTERNALS__.invoke;
window.setupTest={calls:[],phase:'',online:false,fail:false,package:true,candidates:[{path:'COM99',name:'USB board',serial:'001122334455',vid:12346,pid:4097}]};
window.__TAURI_INTERNALS__.invoke=async(cmd,args={})=>{
 const f=window.setupTest;f.calls.push(cmd);
 const info={chip:'ESP32-S3',mac:'001122334455',version:'0.8.0',psram_known:false,variant:'',target:'s3-o8-ab1',flash_bytes:16777216,description:'test chip'};
 if(cmd==='ports')return f.online?[{path:'COM100',serial:info.mac,name:'Vibe Remote Buddy'}]:[];
 if(cmd==='setup_package')return f.package?{version:'0.8.0'}:null;
 if(cmd==='setup_candidates')return f.candidates;
 if(cmd==='setup_check'){f.phase='checked';return;}
 if(cmd==='setup_status')return {phase:f.phase,info:{...info,variant:f.phase==='written'?'o8':''},error:f.fail?'device disconnected':'',logs:[]};
 if(cmd==='setup_release')return;
 if(cmd==='setup_install'){
   if(!args.confirmed||!args.boardConfirmed)throw Error('Missing confirmation');
   f.phase='writing';setTimeout(()=>{f.phase=f.fail?'error':'written';f.online=!f.fail;},900);return;
 }
 return original(cmd,args);
};
'''
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 for width in [1000,440]:
  page=b.new_page(viewport={'width':width,'height':900},device_scale_factor=1.5);errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script(fixture+'\n'+extension)
  page.goto('http://127.0.0.1:1420')
  page.get_by_role('button',name='初始化接收器',exact=True).click()
  d=page.locator('dialog.receiver-setup')
  d.get_by_role('button',name='连接这块开发板').click()
  confirm=d.get_by_role('button',name='清除并安装')
  confirm.wait_for();assert confirm.is_disabled()
  d.get_by_label('确认清除以上设备并安装').check();assert confirm.is_disabled()
  d.get_by_label('板子内存规格',exact=True).select_option('o8');d.get_by_label('已核对板子标注与所选内存规格一致',exact=False).check();assert confirm.is_enabled()
  page.screenshot(path=str(out/f'confirm-{width}.png'))
  confirm.click();assert d.get_by_role('button',name='关闭',exact=True).is_disabled()
  page.keyboard.press('Escape');assert d.is_visible()
  d.get_by_role('heading',name='接收器已就绪').wait_for()
  d.get_by_role('button',name='添加遥控器',exact=True).click()
  page.get_by_role('dialog',name='添加遥控器',exact=True).wait_for()
  assert page.evaluate("setupTest.calls.filter(x=>x==='setup_install').length")==1
  assert not errors,errors
  page.close()
 # Lack of package must not even start device probing.
 page=b.new_page();page.add_init_script(fixture+'\n'+extension+'\nsetupTest.package=false;')
 page.goto('http://127.0.0.1:1420');page.get_by_role('button',name='初始化接收器',exact=True).click()
 page.get_by_text('当前应用没有完整安装包。请使用附带固件的版本。').wait_for()
 assert not page.evaluate("setupTest.calls.includes('setup_check')")
 b.close()
print('PASS: real setup UI, two confirmations, close lock, identity reconnect, existing pairing dialog, missing package')
