from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parents[1];out=root/'build/host-ui';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 for width,height,family in [(1000,900,1),(440,760,1),(1000,900,2)]:
  c=b.new_context(viewport={'width':width,'height':height},device_scale_factor=1.5);c.add_init_script(path=str(root/'tests/ui-native-fixture.js'))
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:1420');page.locator('.device').nth(3).wait_for()
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('高级',exact=True).click()
  page.evaluate('family=>window.fixture.probeFamily=family',family)
  page.locator('.setting').filter(has_text='遥控器适配工具').get_by_role('button').click()
  d=page.get_by_role('dialog',name='遥控器适配工具')
  def preflight():
   modal=page.get_by_role('dialog',name='验证按键')
   try: modal.get_by_text('请按住语音键说话约 3 秒，然后松开。',exact=True).wait_for(timeout=10000)
   except Exception:
    print(page.locator('body').inner_text()[-2500:]);print(page.evaluate('fixture.voice'));raise
   page.evaluate("Object.assign(window.fixture.voice,{armed:false,released:true,samples:320,rate:16000,recording:false})")
   modal.locator('audio').wait_for();modal.locator('audio').evaluate('(e)=>e.play()')
   expect(modal.get_by_role('button',name='声音正常',exact=True)).to_be_enabled()
   modal.get_by_role('button',name='声音正常',exact=True).click();modal.wait_for(state='hidden')
  d.get_by_role('button',name='选择',exact=True).click()
  assert page.get_by_role('button',name='保存诊断',exact=True).count()==0
  assert d.get_by_role('button',name='配置按键',exact=True).count()==0
  page.evaluate('window.fixture.failProbeOpcode=0x448')
  d.get_by_role('button',name='识别',exact=True).click()
  page.get_by_role('alert').first.wait_for()
  expect(page.get_by_role('button',name='保存诊断',exact=True)).to_be_visible()
  assert d.get_by_role('button',name='配置按键',exact=True).count()==0
  page.evaluate('window.fixture.failProbeOpcode=0;window.fixture.audioGap=false')
  d.get_by_role('button',name='重试识别',exact=True).click()
  preflight()
  d.get_by_label('型号名称').wait_for()
  assert page.get_by_role('button',name='保存诊断',exact=True).count()==0
  d.get_by_text('高级信息',exact=True).click()
  d.get_by_label('型号标识').fill('example.test');d.get_by_label('型号名称').fill('测试变种')
  # Preset copies require replacement confirmation and discard all borrowed proofs.
  d.get_by_label('布局预设').select_option('xiaomi.rc003');d.get_by_role('button',name='加载布局',exact=True).click()
  assert d.locator('.probe-grid button:not(.empty)').count()>2
  d.get_by_label('布局预设').select_option('unicom.sample-28');d.get_by_role('button',name='加载布局',exact=True).click()
  page.get_by_role('dialog',name='替换当前布局').get_by_role('button',name='取消',exact=True).click()
  d.get_by_role('button',name='加载布局',exact=True).click();page.get_by_role('dialog',name='替换当前布局').get_by_role('button',name='替换',exact=True).click()
  assert d.locator('.probe-grid button:not(.empty)').count()==28
  assert d.get_by_role('button',name='保存并使用',exact=True).is_disabled()
  # Restart this mock session for the small two-key complete-save regression.
  d.locator('.probe-footer').get_by_role('button',name='返回',exact=True).click();d.locator('.probe-footer').get_by_role('button',name='返回',exact=True).click()
  d.get_by_role('button',name='选择',exact=True).click();d.get_by_role('button',name='识别',exact=True).click()
  preflight()
  d.get_by_label('型号名称').wait_for();d.get_by_text('高级信息',exact=True).click();d.get_by_label('型号标识').fill('example.test')
  # Drag standard Up; add voice through the empty-cell picker.
  if width>650:d.locator('.probe-palette').get_by_role('button',name='上',exact=True).drag_to(d.locator('.probe-cell').nth(2))
  else:
   d.get_by_role('button',name='空格 3',exact=True).click();add=page.get_by_role('dialog',name='添加按键');add.get_by_label('按键类型').select_option('3');add.get_by_role('button',name='添加',exact=True).click()
  d.get_by_role('button',name='空格 8',exact=True).click();add=page.get_by_role('dialog',name='添加按键');add.get_by_label('按键类型').select_option('2');add.get_by_role('button',name='添加',exact=True).click()
  # Repeat add/cancel and move/remove without losing the editor to a modal.
  for cell in [10,11,12]:
   d.get_by_role('button',name=f'空格 {cell}',exact=True).click()
   page.get_by_role('dialog',name='添加按键').get_by_role('button',name='取消',exact=True).click()
  d.get_by_role('button',name='空格 10',exact=True).click()
  add=page.get_by_role('dialog',name='添加按键');add.get_by_label('按键类型').select_option('custom');add.get_by_label('名称',exact=True).fill('Netflix');add.get_by_role('button',name='添加',exact=True).click()
  d.locator('.probe-grid').get_by_role('button',name='Netflix',exact=True).drag_to(d.locator('.probe-cell').nth(10))
  assert d.locator('.probe-cell').nth(10).get_by_role('button',name='Netflix',exact=True).count()==1
  d.locator('.probe-grid').get_by_role('button',name='Netflix',exact=True).click()
  page.get_by_role('dialog',name='验证按键').get_by_role('button',name='移除按键',exact=True).click()
  expect(d.locator('.probe-grid').get_by_role('button',name='Netflix',exact=True)).to_have_count(0)
  page.screenshot(path=str(out/f'probe-grid-debug-{width}.png'),full_page=True)
  assert d.get_by_role('button',name='保存并使用',exact=True).is_disabled()
  for key,usage in [('上',82),('语音',62)]:
   d.locator('.probe-grid').get_by_role('button',name=key,exact=True).click()
   if key=='语音':
    expect(page.get_by_role('dialog',name='验证按键')).to_have_count(0)
    continue
   modal=page.get_by_role('dialog',name='验证按键');modal.get_by_text('等待按键…',exact=True).wait_for()
   expect(modal.locator('.probe-key-gesture strong')).to_have_text(['按下','松开'])
   page.evaluate("""usage=>{const seq=(window.fixture.probeReports??[]).length;window.fixture.probeReports=[...(window.fixture.probeReports??[]),{sequence:seq+1,lost:0,time_ms:100,handle:5,length:8,hex:'0000'+usage.toString(16).padStart(2,'0')+'0000000000'}];window.fixture.probe.sequence=seq+1}""",usage)
   if key=='语音' and family==2:
    page.evaluate('''()=>{const seq=window.fixture.probeReports.length;window.fixture.probeReports.push({sequence:seq+1,lost:0,time_ms:150,handle:10,length:20,hex:'820301'+'00'.repeat(17)});window.fixture.probe.sequence=seq+1}''')
   expect(modal.locator('.probe-key-gesture strong.done')).to_have_text(['按下 ✓'])
   page.evaluate("""()=>{const seq=window.fixture.probeReports.length;window.fixture.probeReports.push({sequence:seq+1,lost:0,time_ms:200,handle:5,length:8,hex:'0000000000000000'});window.fixture.probe.sequence=seq+1}""")
   if key=='语音' and family==2:
    page.evaluate('''()=>{const seq=window.fixture.probeReports.length;window.fixture.probeReports.push({sequence:seq+1,lost:0,time_ms:250,handle:10,length:20,hex:'820300'+'00'.repeat(17)});window.fixture.probe.sequence=seq+1}''')
   expect(modal.locator('.probe-key-gesture strong.done')).to_have_text(['按下 ✓','松开 ✓'])
   modal.wait_for(state='hidden')
  d.get_by_role('button',name='保存并使用',exact=True).click()
  page.get_by_text('型号已保存',exact=True).wait_for()
  assert '<svg' in page.evaluate('window.fixture.exported.image')
  data=page.evaluate('window.fixture.exported.model');assert data['id']=='example.test';assert len(data['keys'])==2;assert data['raw']==[{'report':1,'usage':82,'key':3}]
  page.screenshot(path=str(out/f'probe-real-{width}.png'),full_page=True)
  assert d.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  d.get_by_role('button',name='添加这只遥控器',exact=True).click();d.wait_for(state='hidden');page.get_by_role('dialog',name='添加遥控器').wait_for();page.wait_for_timeout(200)
  assert page.evaluate('window.fixture.writes.filter(x=>x===0x441).length')==2
  assert not errors,errors;c.close()
 page=b.new_page();page.add_init_script(path=str(root/'tests/ui-native-fixture.js'))
 page.goto('http://127.0.0.1:1420');page.locator('.device').nth(3).wait_for()
 page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('高级',exact=True).click()
 page.locator('.setting').filter(has_text='遥控器适配工具').get_by_role('button').click()
 d=page.get_by_role('dialog',name='遥控器适配工具');d.get_by_role('button',name='选择',exact=True).click();d.get_by_role('button',name='识别',exact=True).click()
 page.get_by_role('dialog',name='验证按键').wait_for()
 page.evaluate("""()=>{const orig=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(c,a)=>{if(c==='serial_read')throw Error('USB disconnected');if(c==='ports')return [];return orig(c,a)};}""")
 page.get_by_text('接收器连接已中断，请重新打开适配工具',exact=True).wait_for()
 page.wait_for_timeout(500);before=page.evaluate('fixture.writes.filter(x=>x===0x442).length')
 page.wait_for_timeout(1000);assert page.evaluate('fixture.writes.filter(x=>x===0x442).length')==before
 d.get_by_role('button',name='关闭',exact=True).click();d.wait_for(state='hidden')
 b.close()
print('PASS: real wizard scan/connect, grid, per-key capture, front-loaded UAC recording/playback confirmation and session loss termination, export and cleanup at 150% DPI')
