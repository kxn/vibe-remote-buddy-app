"""Windows native smoke: the picker must accept real OS keys from another foreground app.
Requires a locally launched debug WebView on port 9223; does not change mappings.
"""
from playwright.sync_api import sync_playwright
import ctypes
from ctypes import wintypes as W
u=ctypes.WinDLL('user32',use_last_error=True)
u.GetForegroundWindow.restype=W.HWND
class KI(ctypes.Structure):_fields_=[('wVk',W.WORD),('wScan',W.WORD),('dwFlags',W.DWORD),('time',W.DWORD),('dwExtraInfo',W.WPARAM)]
class MI(ctypes.Structure):_fields_=[('dx',W.LONG),('dy',W.LONG),('mouseData',W.DWORD),('dwFlags',W.DWORD),('time',W.DWORD),('dwExtraInfo',W.WPARAM)]
class IU(ctypes.Union):_fields_=[('ki',KI),('mi',MI)]
class INPUT(ctypes.Structure):_fields_=[('type',W.DWORD),('u',IU)]
def key(vk):
 events=(INPUT*2)(INPUT(type=1,u=IU(ki=KI(wVk=vk))),INPUT(type=1,u=IU(ki=KI(wVk=vk,dwFlags=2))))
 assert u.SendInput(2,events,ctypes.sizeof(INPUT))==2
with sync_playwright() as p:
 b=p.chromium.connect_over_cdp('http://127.0.0.1:9223');c=b.contexts[0];main=next(t for t in c.pages if '?picker' not in t.url)
 windows=main.evaluate("()=>window.__TAURI_INTERNALS__.invoke('desktop_windows')")
 origin=next(w for w in windows if w['process'].lower()=='zcode.exe')
 for repeat in range(3):
  main.evaluate("window=>globalThis.__TAURI_INTERNALS__.invoke('desktop_activate',{window})",origin)
  assert int(u.GetForegroundWindow())==int(origin['token'].split(':')[0])
  with c.expect_page() as created:main.evaluate("()=>window.__TAURI_INTERNALS__.invoke('show_window_picker')")
  picker=created.value;picker.get_by_role('listbox').wait_for()
  assert picker.evaluate('document.hasFocus()'), 'WebView lacks focus'
  token=main.evaluate("()=>window.__TAURI_INTERNALS__.invoke('desktop_focus_token')")
  assert token!=origin['token']
  # Reopening the already active picker must not create another window.
  main.evaluate("()=>window.__TAURI_INTERNALS__.invoke('show_window_picker')")
  assert picker.evaluate('document.hasFocus()')
  opts=picker.get_by_role('option');assert opts.count()>1
  key(0x28);picker.wait_for_function('document.querySelectorAll("[role=option]")[1].getAttribute("aria-selected")==="true"')
  key(0x26);picker.wait_for_function('document.querySelectorAll("[role=option]")[0].getAttribute("aria-selected")==="true"')
  if repeat==1:
   # Switching away closes the picker; it must never seize focus again.
   main.evaluate("window=>globalThis.__TAURI_INTERNALS__.invoke('desktop_activate',{window})",origin)
  elif repeat==2:
   selected=opts.first.inner_text();key(0x0d)
  else:key(0x1b)
  if not picker.is_closed():picker.wait_for_event('close')
  assert not main.is_closed()
 print('PASS: 3 opens from background, native+WebView focus, actual SendInput Up/Down/Esc/Enter, repeat open, focus-loss close; no mapping changes')
