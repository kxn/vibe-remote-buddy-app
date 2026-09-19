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
  d.get_by_role('button',name='选择',exact=True).click()
  assert d.get_by_role('button',name='保存诊断',exact=True).count()==0
  assert d.get_by_role('button',name='配置按键',exact=True).count()==0
  page.evaluate('window.fixture.failProbeOpcode=0x448')
  d.get_by_role('button',name='识别',exact=True).click()
  d.get_by_role('alert').wait_for()
  expect(d.get_by_role('button',name='保存诊断',exact=True)).to_be_visible()
  assert d.get_by_role('button',name='配置按键',exact=True).count()==0
  page.evaluate('window.fixture.failProbeOpcode=0')
  d.get_by_role('button',name='重试识别',exact=True).click()
  d.get_by_label('型号名称').wait_for()
  assert d.get_by_role('button',name='保存诊断',exact=True).count()==0
  d.get_by_text('高级信息',exact=True).click()
  d.get_by_label('型号标识').fill('example.test');d.get_by_label('型号名称').fill('测试变种')
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
  if width>650:
   d.locator('.probe-grid').get_by_role('button',name='Netflix',exact=True).drag_to(d.locator('.probe-trash'))
  else:
   d.locator('.probe-grid').get_by_role('button',name='Netflix',exact=True).click()
   page.get_by_role('dialog',name='验证按键').get_by_role('button',name='移除按键',exact=True).click()
  expect(d.locator('.probe-grid').get_by_role('button',name='Netflix',exact=True)).to_have_count(0)
  page.screenshot(path=str(out/f'probe-grid-debug-{width}.png'),full_page=True)
  assert d.get_by_role('button',name='保存并使用',exact=True).is_disabled()
  for key,usage in [('上',82),('语音',62)]:
   d.locator('.probe-grid').get_by_role('button',name=key,exact=True).click()
   modal=page.get_by_role('dialog',name='验证按键');modal.get_by_text('等待按键…',exact=True).wait_for()
   expect(modal.locator('.probe-key-gesture strong')).to_have_text(['按下','松开'])
   if key=='语音' and family==1:
    page.evaluate("""()=>{const seq=window.fixture.probeReports.length;window.fixture.probeReports.push({sequence:seq+1,lost:0,time_ms:100,handle:5,length:8,hex:'0000520000000000'},{sequence:seq+2,lost:0,time_ms:200,handle:5,length:8,hex:'0000000000000000'});window.fixture.probe.sequence=seq+2}""")
    modal.get_by_text('这个键码已分配给其他按键',exact=True).wait_for()
    assert page.evaluate('window.fixture.voice===undefined')

   page.evaluate("""usage=>{const seq=(window.fixture.probeReports??[]).length;window.fixture.probeReports=[...(window.fixture.probeReports??[]),{sequence:seq+1,lost:0,time_ms:100,handle:5,length:8,hex:'0000'+usage.toString(16).padStart(2,'0')+'0000000000'}];window.fixture.probe.sequence=seq+1}""",usage)
   if key=='语音' and family==2:
    page.evaluate('''()=>{const seq=window.fixture.probeReports.length;window.fixture.probeReports.push({sequence:seq+1,lost:0,time_ms:150,handle:10,length:20,hex:'820301'+'00'.repeat(17)});window.fixture.probe.sequence=seq+1}''')
   expect(modal.locator('.probe-key-gesture strong.done')).to_have_text(['按下 ✓'])
   page.evaluate("""()=>{const seq=window.fixture.probeReports.length;window.fixture.probeReports.push({sequence:seq+1,lost:0,time_ms:200,handle:5,length:8,hex:'0000000000000000'});window.fixture.probe.sequence=seq+1}""")
   if key=='语音' and family==2:
    page.evaluate('''()=>{const seq=window.fixture.probeReports.length;window.fixture.probeReports.push({sequence:seq+1,lost:0,time_ms:250,handle:10,length:20,hex:'820300'+'00'.repeat(17)});window.fixture.probe.sequence=seq+1}''')
   expect(modal.locator('.probe-key-gesture strong.done')).to_have_text(['按下 ✓','松开 ✓'])
   if key=='语音':
    modal.get_by_text('请按住语音键说话约 3 秒，然后松开。',exact=True).wait_for()
    assert modal.get_by_role('button',name='重新录音',exact=True).count()==0
    page.evaluate("Object.assign(window.fixture.voice,{armed:false,recording:false,error:'no audio stream'})")
    modal.get_by_text('没有收到语音数据',exact=True).wait_for()
    modal.get_by_role('button',name='重新录音',exact=True).click()
    modal.get_by_text('请按住语音键说话约 3 秒，然后松开。',exact=True).wait_for()
    page.evaluate("window.fixture.failProbeOpcode=0x44c;Object.assign(window.fixture.voice,{armed:false,released:true,samples:160,recording:false})")
    modal.get_by_role('alert').wait_for()
    assert modal.get_by_role('button',name='声音正常',exact=True).count()==0
    page.evaluate('window.fixture.failProbeOpcode=0')
    modal.get_by_role('button',name='重新录音',exact=True).click()
    modal.get_by_text('请按住语音键说话约 3 秒，然后松开。',exact=True).wait_for()
    page.evaluate("Object.assign(window.fixture.voice,{recording:true,samples:100})")
    modal.get_by_text('正在录音，说话约 3 秒后松开',exact=True).wait_for()
    page.evaluate("Object.assign(window.fixture.voice,{armed:false,released:true,samples:160,recording:false})")
    modal.locator('audio').wait_for();assert modal.get_by_text('请按住语音键说话约 3 秒，然后松开。',exact=True).count()==0;assert modal.get_by_role('button',name='声音正常',exact=True).is_disabled()
    modal.locator('audio').evaluate('(e)=>e.play()');expect(modal.get_by_role('button',name='声音正常',exact=True)).to_be_enabled()
    modal.get_by_role('button',name='声音正常',exact=True).click()
   modal.wait_for(state='hidden')
  d.get_by_role('button',name='保存并使用',exact=True).click()
  d.get_by_text('型号已保存',exact=True).wait_for()
  assert '<svg' in page.evaluate('window.fixture.exported.image')
  data=page.evaluate('window.fixture.exported.model');assert data['id']=='example.test';assert len(data['keys'])==2;assert data['raw']==([{'report':1,'usage':82,'key':3},{'report':1,'usage':62,'key':2}] if family==1 else [{'report':1,'usage':82,'key':3}])
  page.screenshot(path=str(out/f'probe-real-{width}.png'),full_page=True)
  assert d.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  d.get_by_role('button',name='添加这只遥控器',exact=True).click();d.wait_for(state='hidden');page.get_by_role('dialog',name='添加遥控器').wait_for();page.wait_for_timeout(200)
  assert page.evaluate('window.fixture.writes.filter(x=>x===0x441).length')==1
  assert not errors,errors;c.close()
 b.close()
print('PASS: real wizard scan/connect, grid, per-key capture, voice decode retrieval/playback confirmation, export and cleanup at 150% DPI')
