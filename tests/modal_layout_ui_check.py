"""Production UI with mocked transport; no real receiver access."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
out=root/'build/host-ui';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 for width,height in [(1000,780),(720,640),(400,620)]:
  c=b.new_context(viewport={'width':width,'height':height},device_scale_factor=1.5)
  c.add_init_script(path=str(root/'tests/ui-native-fixture.js'))
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:5173');page.locator('.device').nth(3).wait_for()
  def snap(name):
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),name
   dialogs=page.locator('[aria-modal=true]')
   if dialogs.count():
    d=dialogs.last
    assert d.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),(name,'horizontal overflow')
    for button in d.locator(':scope > footer button').all():
     rect=button.bounding_box();assert rect and rect['x']>=0 and rect['y']>=0 and rect['x']+rect['width']<=width+1 and rect['y']+rect['height']<=height+1,(name,rect)
   page.screenshot(path=str(out/f'audit-{name}-{width}.png'))
  snap('home')
  page.locator('.configure').first.click();page.locator('.model-full').wait_for();snap('keys')
  page.locator('.model-full button[aria-label="主页"]').click()
  d=page.locator('[aria-modal=true]').last
  d.locator('select').first.select_option('6');snap('key-action')
  d.get_by_role('button',name='确认保存',exact=True).click();d.wait_for(state='hidden')
  assert page.evaluate('Object.values(fixture.maps).some(m=>m.kind===6&&m.value===0)')
  page.get_by_role('button',name='Vibe Remote Buddy 首页').click()
  page.get_by_role('button',name='设置',exact=True).click();page.get_by_text('高级',exact=True).click();snap('settings')
  page.locator('.setting').filter(has_text='机型库管理').get_by_role('button').click()
  d=page.get_by_role('dialog',name='机型库',exact=True);d.wait_for();snap('library')
  underlying=page.evaluate('scrollY');before=d.locator('.library-list').evaluate('(e)=>e.scrollTop')
  page.mouse.move(1,1);page.mouse.wheel(0,600);page.wait_for_timeout(100)
  assert page.evaluate('scrollY')==underlying
  assert d.evaluate('(e)=>[e,...e.querySelectorAll("*")].some(n=>n.scrollTop>0)')
  # Nested dialog: even a wheel over the parent must only scroll the top child.
  d.evaluate("""e=>{const layer=document.createElement('div');layer.className='probe-modal-layer';layer.id='scroll-test';layer.innerHTML='<section class="probe-modal" role="dialog" aria-modal="true" style="height:180px"><div style="height:900px">scroll test</div></section>';e.append(layer)}""")
  before=d.locator('.library-list').evaluate('(e)=>e.scrollTop')
  page.mouse.move(1,1);page.mouse.wheel(0,500);page.wait_for_timeout(100)
  assert page.locator('#scroll-test section').evaluate('(e)=>e.scrollTop')>0
  assert d.locator('.library-list').evaluate('(e)=>e.scrollTop')==before
  page.locator('#scroll-test section').evaluate('(e)=>e.scrollTop=e.scrollHeight')
  page.mouse.wheel(0,500);page.wait_for_timeout(100)
  assert d.locator('.library-list').evaluate('(e)=>e.scrollTop')==before
  assert page.evaluate('scrollY')==underlying
  page.locator('#scroll-test').evaluate('(e)=>e.remove()')
  d.get_by_role('button',name='编辑默认配置',exact=True).click()
  d=page.locator('[aria-modal=true]').last
  d.locator('.probe-editor > label').first.locator('select').select_option('8')
  for label in d.locator('.probe-modifiers label').all():
   assert label.evaluate('(e)=>getComputedStyle(e).display==="flex"'), 'modifier label stacked'
   assert label.locator('input').evaluate('(e)=>e.getBoundingClientRect().width<30'), 'checkbox stretched'
  d.get_by_text('外观',exact=True).click();snap('defaults')
  page.mouse.move(1,1);page.mouse.wheel(0,600);page.wait_for_timeout(100)
  assert d.locator('.defaults-body').evaluate('(e)=>e.scrollTop')>0
  assert page.evaluate('scrollY')==underlying
  d.get_by_role('button',name='取消',exact=True).click()
  page.get_by_role('dialog',name='机型库',exact=True).get_by_role('button',name='关闭',exact=True).click()
  page.get_by_role('button',name='关于 Vibe Remote Buddy',exact=True).click();snap('about')
  page.get_by_role('dialog',name='关于',exact=True).get_by_role('button',name='关闭',exact=True).click()
  for setting,title in [('接收器信息','接收器详情'),('备份与恢复','备份与恢复'),('故障诊断','接收器与故障日志')]:
   page.locator('.setting').filter(has_text=setting).get_by_role('button').click()
   extra=page.get_by_role('dialog',name=title,exact=True);extra.wait_for();snap(title)
   extra.get_by_role('button',name='关闭' if title=='接收器详情' else '完成',exact=True).click()
  page.get_by_role('button',name='Vibe Remote Buddy 首页').click()
  page.evaluate('fixture.count=0')
  page.wait_for_function('document.querySelectorAll(".device").length===0')
  page.get_by_role('button',name='添加遥控器',exact=False).first.click()
  d=page.get_by_role('dialog',name='添加遥控器',exact=True);d.wait_for();snap('discovery')
  d.get_by_label('显示所有机型').check()
  d.get_by_text('小米 Remote 2 Pro',exact=True).click()
  d.get_by_role('button',name='连接',exact=True).click()
  try: d.locator('.candidate-step select').wait_for(timeout=10000)
  except Exception:
   print(page.locator('body').inner_text());print(page.evaluate('fixture.probe'));raise
  snap('candidate')
  d.get_by_role('button',name='下一步',exact=True).click()
  d.locator('.capture-modal').wait_for();snap('voice')
  page.wait_for_function('fixture.voice?.armed===true')
  page.evaluate('Object.assign(fixture.voice,{armed:false,released:true,samples:320,recording:false})')
  d.locator('audio').wait_for();d.locator('audio').evaluate('(e)=>e.play()')
  d.get_by_role('button',name='声音正常',exact=True).click()
  d.locator('.layout-step').wait_for();snap('layout')
  d.locator('.layout-palette-panel').get_by_text('外观',exact=True).click();snap('appearance')
  d.get_by_role('button',name='关闭',exact=True).click()
  page.wait_for_function('!document.documentElement.classList.contains("modal-open")')
  assert not errors,errors
  c.close()
 b.close()
print('PASS: three viewports, real action editor, library/defaults, modal backdrop and nested wheel isolation')
