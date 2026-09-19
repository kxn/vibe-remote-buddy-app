from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(channel="msedge",headless=True)
 for width in (1000,440):
  page=b.new_page(viewport={"width":width,"height":850})
  page.add_init_script(path=str(root/"tests/ui-native-fixture.js"))
  page.goto("http://127.0.0.1:1420")
  page.locator(".device").nth(3).wait_for()
  boxes=lambda:page.locator("main h1,.device,.configure").evaluate_all("es=>es.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})")
  before=boxes()
  page.evaluate("""()=>{const original=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{if(cmd==='ports')return [];if(cmd==='serial_read')throw Error('设备不识别此命令。');return original(cmd,args);};}""")
  page.get_by_role("alert").filter(has_text="设备不识别此命令").wait_for()
  assert boxes()==before,(width,before,boxes())
  page.get_by_role("alert").get_by_role("button",name="关闭").click()
  assert boxes()==before
  page.close()
 b.close()
print("PASS: transient transport errors do not move title, remote cards or buttons at wide/narrow widths")
