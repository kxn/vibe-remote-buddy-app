"""Capture the real React UI with example receiver data at 2x resolution.

Start the Vite server on port 1420 first. This uses the existing browser test
fixture, so the pictures document UI states rather than hardware validation.
"""

import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs/images/user-guide"
URL = "http://127.0.0.1:1420"
FIXTURE = (ROOT / "tests/ui-native-fixture.js").read_text(encoding="utf-8")
MODEL = json.loads((ROOT / "resources/remotes/xiaomi.rc003/model.json").read_text(encoding="utf-8"))
APP_VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
MAPS = {
    f"0:{key['id']}": dict(zip(("kind", "modifiers", "value"), key["default"]))
    for key in MODEL["keys"]
}
BASE = FIXTURE.replace('name: "小米 Remote 2 Pro",', 'name: "小米蓝牙语音遥控器",') + "\nwindow.fixture.maps = " + json.dumps(MAPS) + ";\n"

SETUP = r"""
const original = window.__TAURI_INTERNALS__.invoke;
window.setupExample = { phase: '', online: false };
window.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
  const f = window.setupExample;
  const info = {chip:'ESP32-S3',mac:'00:11:22:33:44:55',version:'0.8.0',
    psram_known:false,variant:'',target:'s3-o8-ab1',flash_bytes:16777216,
    description:'ESP32-S3 example board'};
  if (cmd === 'ports') return f.online ? [{path:'COM7',serial:info.mac,name:'Vibe Remote Buddy'}] : [];
  if (cmd === 'setup_package') return {version:'0.8.0'};
  if (cmd === 'setup_candidates') return [{path:'COM6',name:'ESP32-S3',serial:info.mac,vid:12346,pid:4097}];
  if (cmd === 'setup_check') {f.phase='checked';return;}
  if (cmd === 'setup_status') return {phase:f.phase,
    info:{...info,variant:f.phase==='written'?'o8':''},error:'',logs:[]};
  if (cmd === 'setup_release') return;
  if (cmd === 'setup_install') {
    f.phase='writing';
    setTimeout(() => {f.phase='written';f.online=true;},900);
    return;
  }
  return original(cmd,args);
};
"""


def page_for(browser, script):
    context = browser.new_context(viewport={"width": 1000, "height": 780}, device_scale_factor=2)
    context.add_init_script(script)
    page = context.new_page()
    page.goto(URL)
    return context, page


def shot(page, name):
    page.locator('.build-version').evaluate('(e,version)=>{e.textContent=version}', APP_VERSION)
    page.screenshot(path=str(OUTPUT / name), animations="disabled")


def main():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True)

        context, page = page_for(browser, BASE + "window.fixture.count=2;")
        page.locator('.device').nth(1).wait_for()
        shot(page, 'home-connected.png')
        page.locator('.configure').first.click()
        page.locator('.model-full').wait_for()
        shot(page, 'buttons-overview.png')
        page.locator('.model-full button[aria-label="\u8bed\u97f3"]').click()
        page.locator('[role=dialog]').last.wait_for()
        shot(page, 'voice-setting.png')
        context.close()

        context, page = page_for(browser, BASE + "window.fixture.count=0;")
        page.locator('.connection').filter(has_text='\u63a5\u6536\u5668\u5df2\u8fde\u63a5').wait_for()
        shot(page, 'home-empty.png')
        page.locator('.title .primary').click()
        dialog = page.locator('[role=dialog]').last
        dialog.wait_for()
        dialog.locator('.probe-device').wait_for(timeout=10000)
        dialog.locator('.probe-device').first.click()
        shot(page, 'add-found.png')
        context.close()

        # Delay one scan response so the transient searching state is visible.
        searching = BASE.replace(
            'else if (q.opcode === 0x406) {',
            'else if (q.opcode === 0x406) { await new Promise(r=>setTimeout(r,3500));',
        )
        context, page = page_for(browser, searching + 'window.fixture.count=0;')
        page.locator('.connection').filter(has_text='\u63a5\u6536\u5668\u5df2\u8fde\u63a5').wait_for()
        page.locator('.title .primary').click()
        page.locator('[role=dialog]').last.wait_for()
        shot(page, 'add-search.png')
        context.close()

        installed = BASE.replace(
            'firmware: "ui-fixture",',
            'firmware: "buddy-0.8.0", confirmed:true, target:"s3-o8-ab1", flash_bytes:16777216, psram_bytes:8388608,',
        )
        context, page = page_for(browser, installed + SETUP)
        page.get_by_role('button', name='\u521d\u59cb\u5316\u63a5\u6536\u5668', exact=True).wait_for()
        shot(page, 'home-uninitialized.png')
        page.get_by_role('button', name='\u521d\u59cb\u5316\u63a5\u6536\u5668', exact=True).click()
        dialog = page.locator('dialog.receiver-setup')
        dialog.get_by_role('button', name='\u6ca1\u6709\u6211\u7684\u8bbe\u5907').click()
        dialog.get_by_text('\u5df2\u627e\u5230\u4e00\u5757\u5f00\u53d1\u677f').wait_for()
        shot(page, 'setup-connect.png')
        dialog.get_by_role('button', name='\u8fde\u63a5\u8fd9\u5757\u5f00\u53d1\u677f').click()
        dialog.get_by_label('\u786e\u8ba4\u6e05\u9664\u4ee5\u4e0a\u8bbe\u5907\u5e76\u5b89\u88c5').check()
        dialog.get_by_label('\u677f\u5b50\u5185\u5b58\u89c4\u683c', exact=True).select_option('o8')
        dialog.get_by_label('\u5df2\u6838\u5bf9\u677f\u5b50\u6807\u6ce8\u4e0e\u6240\u9009\u5185\u5b58\u89c4\u683c\u4e00\u81f4', exact=False).check()
        dialog.get_by_role('button', name='\u6e05\u9664\u5e76\u5b89\u88c5').click()
        dialog.locator('h2').filter(has_text='\u63a5\u6536\u5668\u5df2\u5c31\u7eea').wait_for(timeout=10000)
        shot(page, 'setup-done.png')
        context.close()

        updates = BASE.replace(
            'firmware: "ui-fixture",',
            'firmware: "buddy-0.8.0", update_api:1, target:"s3-o8-ab1",',
        ).replace(
            'if (cmd === "firmware_package") return null;',
            '''if (cmd === "firmware_package") return {manifest:{format:1,target:"s3-o8-ab1",version:"0.8.1",size:0,sha256:"",data_min:1,data_max:1,notes:""},image:[]};''',
        )
        context, page = page_for(browser, updates + 'window.fixture.count=2;')
        page.locator('.device').nth(1).wait_for()
        page.locator('button[aria-label="\u8bbe\u7f6e"]').click()
        page.locator('.settings-group').first.wait_for()
        shot(page, 'settings-update.png')
        context.close()
        browser.close()


if __name__ == '__main__':
    main()
