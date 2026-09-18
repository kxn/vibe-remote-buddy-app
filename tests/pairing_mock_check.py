from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path.cwd()
with sync_playwright() as p:
 b=p.chromium.launch(channel='msedge',headless=True)
 page=b.new_page(viewport={'width':1150,'height':1100},device_scale_factor=1.25);errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((root/'docs/mock/pairing-flow.html').as_uri())
 assert page.get_by_text('搜索选项',exact=True).count()==0
 page.get_by_role('button',name='选择',exact=True).first.click()
 page.get_by_role('button',name='返回',exact=True).wait_for()
 page.get_by_role('button',name='连接并识别',exact=True).click()
 page.get_by_role('button',name='配置按键',exact=True).click()
 assert page.locator('#next').is_disabled()
 assert page.locator('#customButton').count()==0
 page.locator('[data-cell="0"]').dblclick()
 assert page.locator('#customName').is_hidden()
 page.locator('#keyType').select_option('custom');page.locator('#customName').fill('上');page.locator('#addCustom').click()
 assert '同名常用按键' in page.locator('#customError').inner_text()
 page.get_by_role('button',name='取消',exact=True).click()
 page.locator('.palette button[data-name="9"]').scroll_into_view_if_needed()
 scroll=page.locator('.editor aside').evaluate('(e)=>e.scrollTop')
 assert scroll>0
 page.locator('.palette button[data-name="9"]').drag_to(page.locator('[data-cell="30"]'))
 assert abs(page.locator('.editor aside').evaluate('(e)=>e.scrollTop')-scroll)<2
 page.locator('[data-cell="30"] .tile').click();page.get_by_role('button',name='移除按键').click()
 page.locator('.palette button[data-name="上"]').scroll_into_view_if_needed()
 page.locator('.palette button[data-name="上"]').drag_to(page.locator('[data-cell="2"]'))
 page.locator('.palette button[data-name="确认"]').drag_to(page.locator('[data-cell="7"]'))
 page.locator('[data-cell="17"]').dblclick();page.locator('#keyType').select_option('custom');page.locator('#customName').fill('Disney+');page.locator('#addCustom').click()
 assert page.locator('.tile').count()==3
 for name in ['上','确认','Disney+']:
  page.locator('.tile').filter(has_text=name).click()
  assert page.locator('#confirmCapture').is_disabled()
  page.locator('#press').click();assert page.locator('#confirmCapture').is_disabled()
  page.locator('#release').click();page.locator('#confirmCapture').click()
 assert page.locator('#next').is_enabled()
 page.locator('.tile').filter(has_text='上').drag_to(page.locator('[data-cell="12"]'))
 assert page.locator('[data-cell="12"] .verified').count()==1
 page.wait_for_timeout(200)
 page.locator('.tile').filter(has_text='确认').click();page.locator('#simCode').fill(page.evaluate("placed.find(k=>k.name==='上').code"));page.locator('#press').click();page.locator('#release').click()
 assert page.locator('#confirmCapture').is_disabled();assert '已用于' in page.locator('#captureState').inner_text()
 page.get_by_role('button',name='取消',exact=True).click()
 page.screenshot(path=str(root/'build/host-ui/pairing-grid-desktop.png'),full_page=True)
 page.locator('#next').click();page.get_by_role('button',name='保存并使用',exact=True).click();page.get_by_text('型号已保存（预览）。接下来在“添加遥控器”中配对，验证按键与语音。',exact=True).wait_for();page.get_by_role('button',name='返回',exact=True).click()
 assert page.locator('.verified').count()==3
 page.locator('.palette button[data-name="语音"]').drag_to(page.locator('[data-cell="4"]'))
 page.locator('[data-cell="4"] .tile').click()
 for mode in ['missing','decode','ok']:
  page.locator('#voiceScenario').select_option(mode)
  page.locator('#press').click();page.wait_for_timeout(200);page.locator('#release').click()
  assert page.locator('#confirmCapture').is_disabled()
  if mode!='ok':assert page.locator('#listenVoice').is_disabled()
 page.locator('#listenVoice').click();page.wait_for_function("!document.querySelector('#voiceOK').disabled")
 page.locator('#voiceOK').check();assert page.locator('#confirmCapture').is_enabled()
 page.screenshot(path=str(root/'build/host-ui/pairing-voice-mock.png'))
 page.locator('#confirmCapture').click();assert page.locator('[data-cell="4"] .verified').count()==1
 page.set_viewport_size({'width':440,'height':820});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(root/'build/host-ui/pairing-grid-mobile.png'),full_page=True)
 assert not errors,errors
 b.close()
print('PASS: drag/drop, custom key, press/release, duplicate rejection, verification gate, move preservation, navigation, narrow layout')
