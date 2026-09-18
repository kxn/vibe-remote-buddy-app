from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
out=root/'build/host-ui';out.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 for width,height in [(880,720),(400,620)]:
  c=b.new_context(viewport={'width':width,'height':height});c.add_init_script(path=str(root/'tests/ui-native-fixture.js'))
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:1420');page.locator('.device').nth(3).wait_for()
  page.get_by_role('button',name='设置',exact=True).click()
  page.get_by_role('button',name='关于 Vibe Remote Buddy',exact=True).click()
  dialog=page.get_by_role('dialog',name='关于');dialog.wait_for()
  assert dialog.get_by_role('link',name='GitHub',exact=True).get_attribute('href')=='https://github.com/kxn/vibe-remote-buddy-app'
  assert dialog.get_by_role('link',name='B 站',exact=True).get_attribute('href')=='https://space.bilibili.com/343648047'
  assert dialog.get_by_role('link',name='第三方代码与版权声明').get_attribute('href').endswith('/THIRD_PARTY_NOTICES.md')
  page.screenshot(path=str(out/f'about-{width}.png'),full_page=True)
  dialog.get_by_role('button',name='关闭',exact=True).click()
  page.get_by_role('button',name='Vibe Remote Buddy 首页').click();page.get_by_role('heading',name='我的遥控器',exact=True).wait_for()
  page.locator('.configure').first.click();page.locator('.model-full').wait_for()
  page.get_by_role('button',name='Vibe Remote Buddy 首页').click();page.get_by_role('heading',name='我的遥控器',exact=True).wait_for()
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  for label in ['GitHub','B 站']:assert page.locator('header').get_by_role('link',name=label,exact=True).locator('svg').count()==1
  page.screenshot(path=str(out/f'home-{width}.png'),full_page=True)
  assert page.locator("[role=alert]").count()==0,page.locator("[role=alert]").all_text_contents();assert not errors,errors
  c.close()
 b.close()
print('PASS: header home navigation, project icons, About links/close and narrow/default layouts')
