from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];out=root/'build/host-ui';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 for width,height in [(1000,900),(440,760)]:
  c=b.new_context(viewport={'width':width,'height':height},device_scale_factor=1.5);c.add_init_script(path=str(root/'tests/ui-native-fixture.js'))
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:1420');page.locator('.device').nth(3).wait_for()
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('高级',exact=True).click()
  page.locator('.setting').filter(has_text='遥控器适配工具').get_by_role('button').click()
  d=page.get_by_role('dialog',name='遥控器适配工具')
  d.get_by_role('button',name='选择',exact=True).click();d.get_by_label('待适配协议').select_option('1')
  d.get_by_role('button',name='连接并识别',exact=True).click();d.get_by_role('button',name='配置按键',exact=True).click()
  d.get_by_label('型号标识').fill('example.test');d.get_by_label('型号名称').fill('测试变种')
  # Drag standard Up; add voice through the empty-cell picker.
  if width>650:d.locator('.probe-palette').get_by_role('button',name='上',exact=True).drag_to(d.locator('.probe-cell').nth(2))
  else:
   d.get_by_role('button',name='空格 3',exact=True).dblclick();add=page.get_by_role('dialog',name='添加按键');add.get_by_label('按键类型').select_option('3');add.get_by_role('button',name='添加',exact=True).click()
  d.get_by_role('button',name='空格 8',exact=True).dblclick();add=page.get_by_role('dialog',name='添加按键');add.get_by_label('按键类型').select_option('2');add.get_by_role('button',name='添加',exact=True).click()
  page.screenshot(path=str(out/f'probe-grid-debug-{width}.png'),full_page=True)
  assert d.get_by_role('button',name='下一步',exact=True).is_disabled()
  for key,usage in [('上',82),('语音',62)]:
   d.locator('.probe-grid').get_by_role('button',name=key,exact=True).click()
   modal=page.get_by_role('dialog',name='验证按键');modal.get_by_text('等待按键…',exact=True).wait_for()
   page.evaluate('''usage=>{const seq=(window.fixture.probeReports??[]).length;window.fixture.probeReports=[...(window.fixture.probeReports??[]),{sequence:seq+1,lost:0,time_ms:100,handle:5,length:8,hex:'0000'+usage.toString(16).padStart(2,'0')+'0000000000'},{sequence:seq+2,lost:0,time_ms:200,handle:5,length:8,hex:'0000000000000000'}];window.fixture.probe.sequence=seq+2}''',usage)
   modal.get_by_text('已收到按下和松开',exact=False).wait_for()
   if key=='语音':
    modal.get_by_role('button',name='测试语音').click();modal.get_by_text('请再按住语音键说话约 3 秒，然后松开。',exact=True).wait_for()
    page.evaluate("Object.assign(window.fixture.voice,{armed:false,released:true,samples:160,recording:false})")
    modal.locator('audio').wait_for();assert modal.get_by_role('button',name='确认',exact=True).is_disabled()
    modal.locator('audio').evaluate('(e)=>e.play()');page.wait_for_function('!document.querySelector(".probe-modal input[type=checkbox]").disabled')
    modal.get_by_label('声音正常').check()
   modal.get_by_role('button',name='确认',exact=True).click()
  d.get_by_role('button',name='下一步',exact=True).click();d.get_by_role('button',name='导出型号',exact=True).click()
  d.get_by_text('已导出：test/exported-model',exact=True).wait_for()
  data=page.evaluate('window.fixture.exported.model');assert data['id']=='example.test';assert len(data['keys'])==2;assert data['raw']==[{'report':1,'usage':82,'key':3},{'report':1,'usage':62,'key':2}]
  page.screenshot(path=str(out/f'probe-real-{width}.png'),full_page=True)
  assert d.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  d.get_by_role('button',name='关闭',exact=True).click();d.wait_for(state='hidden');page.wait_for_timeout(200)
  assert page.evaluate('window.fixture.writes.filter(x=>x===0x441).length')==1
  assert not errors,errors;c.close()
 b.close()
print('PASS: real wizard scan/connect, grid, per-key capture, voice decode retrieval/playback confirmation, export and cleanup at 150% DPI')
