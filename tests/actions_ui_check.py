from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
(root/'build/host-ui').mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 c=b.new_context(viewport={'width':1000,'height':780});c.add_init_script(path=str(root/'tests/ui-native-fixture.js'))
 page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://127.0.0.1:1420');page.locator('.device').nth(3).wait_for()
 rects=lambda:page.locator('.device').evaluate_all('(es)=>es.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})')
 before=rects();page.evaluate('fixture.voiceOwner=0');page.get_by_role('status').filter(has_text='正在录音').wait_for();assert before==rects()
 page.screenshot(path=str(root/'build/host-ui/recording-cards.png'),full_page=True)
 page.evaluate('fixture.voiceOwner=255');page.wait_for_function('!document.querySelector(".recording-mark.active")');assert before==rects()
 page.locator('.configure').first.click();page.locator('.handset button[aria-label="主页"]').wait_for()
 box=lambda name:page.locator(f'.handset button[aria-label="{name}"]').bounding_box()
 assert box('电源')['x']<box('语音')['x'];assert box('返回')['y']<box('主页')['y']<box('菜单')['y'];assert box('音量 +')['x']>box('返回')['x'];assert box('电视')['y']==box('菜单')['y']
 assert len(page.locator('.handset button').all())==13
 page.screenshot(path=str(root/'build/host-ui/xiaomi-photo-layout.png'),full_page=True)
 page.locator('.handset button[aria-label="主页"]').click();page.get_by_label('功能',exact=True).select_option('input:chatgpt')
 assert page.get_by_label('正在运行的应用',exact=True).count()==0
 page.get_by_role('button',name='保存',exact=True).click();page.locator('[role=dialog]').wait_for(state='hidden')
 page.locator('.handset button[aria-label="主页"]').click();assert page.get_by_label('功能',exact=True).input_value()=='input:chatgpt'
 page.get_by_label('功能',exact=True).select_option('command:next_app_window');page.get_by_role('button',name='保存',exact=True).click();page.locator('[role=dialog]').wait_for(state='hidden')
 page.locator('.handset button[aria-label="语音"]').click();page.get_by_role('combobox',name='语音输入',exact=True).select_option('wechat');assert 'Windows 语音输入' not in page.locator('[role=dialog]').inner_text()
 page.get_by_role('button',name='保存',exact=True).click();page.locator('[role=dialog]').wait_for(state='hidden');assert page.evaluate('fixture.maps["0:2"].modifiers')==9
 page.locator('.handset button[aria-label="语音"]').click();assert page.get_by_role('combobox',name='语音输入',exact=True).input_value()=='wechat'
 assert not errors,errors;b.close()
print('PASS: one-step application commands; WeChat preset persistence; 13-key Xiaomi layout; zero recording layout shift')
