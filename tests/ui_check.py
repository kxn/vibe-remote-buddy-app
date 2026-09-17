"""Run against npm run dev. Does not enumerate/open real hardware."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
out=root/'build'/'host-ui';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(channel='msedge',headless=True)
 for dpi in [1,1.25,1.5,2]:
  context=browser.new_context(viewport={'width':1000,'height':780},device_scale_factor=dpi)
  context.add_init_script(path=str(root/'tests/ui-native-fixture.js'))
  page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:1420');page.locator('.device').nth(3).wait_for()
  for count in [1,2,3,4]:
   page.evaluate('(n)=>window.fixture.count=n',count)
   page.wait_for_function('(n)=>document.querySelectorAll(".device").length===n',arg=count)
   rects=page.locator('.device').evaluate_all('(es)=>es.map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width}})')
   if count>1:assert rects[0]['y']==rects[1]['y']
   if count>2:assert rects[2]['y']>rects[0]['y']
  page.screenshot(path=str(out/f'four-{dpi}.png'),full_page=True)
  page.locator('.configure').first.click();page.locator('.handset button').nth(12).wait_for()
  page.locator('.handset button[aria-label="语音"]').click()
  page.get_by_role('combobox',name='语音输入',exact=True).select_option('custom')
  page.get_by_label('左 Alt',exact=True).check()
  page.get_by_role('button',name='保存',exact=True).click()
  page.locator('[role=dialog]').wait_for(state='hidden')
  assert 0x40c in page.evaluate('fixture.writes')
  page.get_by_role('button',name='‹ 我的遥控器').click()
  # Text/page zoom tests CSS layout in addition to physical device pixel ratios.
  page.evaluate('document.documentElement.style.zoom="2"')
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  rects=page.locator('.device').evaluate_all('(es)=>es.map(e=>e.getBoundingClientRect().y)')
  assert rects[1]>rects[0]
  assert not errors,errors
  context.close()
 browser.close()
print('PASS: 1–4 cards, DPI 100/125/150/200%, page zoom 200%, mapping save; no real hardware used.')
