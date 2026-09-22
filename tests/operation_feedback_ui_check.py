"""Real shared components, mocked app transport: no receiver writes."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b = p.chromium.launch(channel="msedge", headless=True)
 for width,height in [(1000,780),(400,620)]:
  c=b.new_context(viewport={"width":width,"height":height},device_scale_factor=1.5)
  c.add_init_script(path=str(root/"tests/ui-native-fixture.js"))
  page=c.new_page();page.goto("http://127.0.0.1:5173")
  page.locator(".device").first.wait_for()
  page.evaluate(r"""async () => {
   const source=await (await fetch('/src/main.tsx')).text();
   const imports=[...source.matchAll(/from \"([^\"]+)\"/g)].map(m=>m[1]);
   const reactModule = await import(imports.find(u=>/\/react\.js/.test(u)));
   const React=reactModule.default ?? reactModule;
   const client=await import(imports.find(u=>/react-dom_client/.test(u)));
   const createRoot=client.createRoot ?? client.default.createRoot;
   const {OperationDialog}=await import('/src/OperationDialog.tsx');
   const {Feedback}=await import('/src/Feedback.tsx');
   const mount=document.createElement('div');document.body.append(mount);
   window.testRoot=createRoot(mount);window.cancelled=false;
   testRoot.render(React.createElement(OperationDialog,{title:'更新接收器固件'},
     React.createElement('p',{className:'operation-phase'},'正在写入'),
     React.createElement('progress',{max:100,value:45}),
     React.createElement('footer',null,React.createElement('button',{onClick:()=>window.cancelled=true},'取消更新'))));
   window.showFeedback=()=>testRoot.render(React.createElement(Feedback,{error:true},'错误详情：'.repeat(200)));
  }""")
  d=page.get_by_role('dialog',name='更新接收器固件');d.wait_for()
  page.wait_for_timeout(250);rect=d.bounding_box();assert rect and abs(rect['x']+rect['width']/2-width/2)<10
  assert abs(rect['y']+rect['height']/2-height/2)<2
  assert d.evaluate('(e)=>e.scrollHeight<=e.clientHeight+1')
  before=page.evaluate('scrollY');page.mouse.move(1,1);page.mouse.wheel(0,500);page.wait_for_timeout(100)
  assert page.evaluate('scrollY')==before
  page.keyboard.press('Escape');assert d.is_visible()
  d.get_by_role('button',name='取消更新').click();assert page.evaluate('cancelled')
  page.evaluate('showFeedback()');d.wait_for(state='hidden')
  item=page.locator('.feedback-item').last;item.wait_for()
  assert item.evaluate('(e)=>e.scrollHeight<=e.clientHeight+1')
  assert item.evaluate('(e)=>getComputedStyle(e.parentElement).overflowY==="visible"')
  item.get_by_role('button',name='详情').click()
  detail=page.get_by_role('dialog',name='错误详情');detail.wait_for()
  assert detail.inner_text().count('错误详情：')==200
  detail.get_by_role('button',name='关闭').click();detail.wait_for(state='hidden')
  page.evaluate('testRoot.unmount()');c.close()
 b.close()
print('PASS: centered operation, visible cancellation, modal scroll lock, complete long-error details')
