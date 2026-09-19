"""Exercise the setup prototype; never opens a serial port."""
from pathlib import Path
from datetime import datetime
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
out = root / 'build/diagnostics' / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-receiver-setup-mock')
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge', headless=True)
    page = browser.new_page(viewport={'width': 1000, 'height': 900}, device_scale_factor=1.25)
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto((root / 'docs/mock/receiver-setup.html').as_uri())
    assert page.locator('.preview').inner_text().startswith('仅预览 · 不会出现在成品中')
    assert page.locator('.preview').evaluate('(e)=>getComputedStyle(e).color') == 'rgb(112, 81, 143)'
    assert '遥控器、语音和按键设置会显示在这里' not in page.locator('#main').inner_text()

    def open_scenario(mode):
        page.evaluate("if(document.querySelector('#wizard').open)document.querySelector('#wizard').close()")
        page.select_option('#scenario', mode)
        page.get_by_role('button', name='设置', exact=True).click()
        page.get_by_role('button', name='打开', exact=True).click()

    def check_device():
        page.locator('#connect').click()

    # Header entry, check-before-erase and explicit destructive consent.
    page.get_by_role('button', name='初始化接收器', exact=True).click()
    check_device()
    page.locator('#consent').wait_for()
    assert page.locator('#install').is_disabled()
    page.screenshot(path=str(out / 'confirmation.png'))
    page.locator('#consent').check()
    page.locator('#install').click()
    assert page.locator('.close').is_disabled()
    page.keyboard.press('Escape')
    assert page.locator('#wizard').is_visible()
    page.locator('#wizard').get_by_role('heading', name='接收器已就绪').wait_for()
    page.get_by_role('button', name='完成', exact=True).click()
    assert page.get_by_text('接收器已连接', exact=True).is_visible()
    for mode in ['incompatible', 'unknown', 'protected', 'package']:
        open_scenario(mode)
        if mode != 'package': check_device()
        page.locator('[role=alert]').wait_for()
        assert page.locator('#install').count() == 0
    open_scenario('manual')
    check_device()
    page.locator('#simulateArrival').click()
    page.locator('#consent').wait_for()
    open_scenario('multiple')
    assert page.locator('input[name=device]').count() == 2
    assert page.locator('input[name=device]:checked').count() == 0
    open_scenario('changed')
    check_device()
    page.locator('#consent').check()
    page.locator('#install').click()
    page.get_by_role('heading', name='开发板已断开').wait_for()
    for mode in ['failure', 'reboot']:
        open_scenario(mode)
        check_device()
        page.locator('#consent').check()
        page.locator('#install').click()
        if mode == 'failure':
            page.get_by_role('heading', name='安装中断').wait_for()
            page.get_by_role('button', name='继续恢复').click()
            page.locator('#simulateArrival').click()
            page.locator('#consent').wait_for()
            assert not page.locator('#consent').is_checked()
            assert page.locator('#install').is_disabled()
        else:
            page.get_by_role('heading', name='安装已写入，尚未连接').wait_for()
            page.locator('#simulateOnline').click()
            page.locator('#wizard').get_by_role('heading', name='接收器已就绪').wait_for()
    open_scenario('none')
    assert page.locator('#connect').count() == 0
    page.get_by_role('button', name='仍未找到？', exact=True).click()
    page.locator('#simulateArrival').click()
    check_device()
    page.locator('#consent').wait_for()
    for width in [360, 640, 1000]:
        page.set_viewport_size({'width': width, 'height': 850})
        open_scenario('auto')
        check_device()
        page.locator('#consent').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert page.locator('#wizard').evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    page.screenshot(path=str(out / 'confirmation-final.png'))
    assert not errors, errors
    browser.close()
print('Receiver setup mock: entries, consent, recovery, blocking and responsive layout passed')
