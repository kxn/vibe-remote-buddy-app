#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
use serde::Serialize;
use std::{
    io::{Read, Write},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{Manager, State};
mod activate;
mod desktop;
mod ime;
mod installed_apps;
fn tray_image() -> Result<tauri::image::Image<'static>, tauri::Error> {
    #[cfg(windows)]
    let size = unsafe {
        use windows::{
            core::w,
            Win32::UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::FindWindowW},
        };
        let dpi = FindWindowW(w!("Shell_TrayWnd"), None)
            .ok()
            .map(|h| GetDpiForWindow(h))
            .filter(|d| *d > 0)
            .unwrap_or(96);
        (16 * dpi + 95) / 96
    };
    #[cfg(not(windows))]
    let size = 32;
    let bytes: &[u8] = match size {
        0..=16 => include_bytes!("../icons/tray-16.png"),
        17..=20 => include_bytes!("../icons/tray-20.png"),
        21..=24 => include_bytes!("../icons/tray-24.png"),
        25..=32 => include_bytes!("../icons/tray-32.png"),
        33..=40 => include_bytes!("../icons/tray-40.png"),
        41..=48 => include_bytes!("../icons/tray-48.png"),
        _ => include_bytes!("../icons/tray-64.png"),
    };
    tauri::image::Image::from_bytes(bytes)
}
#[tauri::command]
async fn desktop_input_method(window: desktop::Window, input_method: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || ime::switch(&window, &input_method))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
fn desktop_focus_token() -> String {
    desktop::current_token()
}
#[tauri::command]
async fn installed_applications() -> Result<Vec<installed_apps::InstalledApp>, String> {
    tauri::async_runtime::spawn_blocking(installed_apps::list)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn launch_installed_application(app_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || installed_apps::launch(&app_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn desktop_available() -> bool {
    cfg!(windows)
}
#[tauri::command]
fn desktop_windows() -> Result<Vec<desktop::Window>, String> {
    desktop::list()
}
#[tauri::command]
fn desktop_foreground() -> Result<desktop::Window, String> {
    desktop::foreground()
}
#[tauri::command]
async fn desktop_activate(window: desktop::Window) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || desktop::activate(&window))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn desktop_focus(window: desktop::Window, matcher: desktop::Focus) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || desktop::focus(&window, &matcher))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn desktop_command(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || desktop::command(&id))
        .await
        .map_err(|e| e.to_string())?
}
#[derive(Default)]
struct PickerState {
    prepared: bool,
    confirmed: bool,
    error: Option<String>,
}
#[tauri::command]
fn picker_prepared(
    window: tauri::WebviewWindow,
    state: State<Native>,
    error: Option<String>,
) -> Result<(), String> {
    if window.label() != "picker" {
        return Err("不是窗口选择器".into());
    }
    let mut p = state.picker.lock().map_err(|e| e.to_string())?;
    p.prepared = true;
    p.error = error;
    Ok(())
}
fn picker_identity(w: &tauri::WebviewWindow) -> Result<desktop::Window, String> {
    #[cfg(windows)]
    {
        let hwnd = w.hwnd().map_err(|e| e.to_string())?;
        Ok(desktop::Window {
            token: format!("{}:{}", hwnd.0 as usize, std::process::id()),
            title: "窗口选择".into(),
            process: "".into(),
            path: std::env::current_exe()
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into_owned(),
        })
    }
    #[cfg(not(windows))]
    {
        let _ = w;
        Err("此平台的窗口选择尚未适配".into())
    }
}
#[tauri::command]
fn picker_confirm(window: tauri::WebviewWindow, state: State<Native>) -> Result<(), String> {
    if window.label() != "picker" || desktop::current_token() != picker_identity(&window)?.token {
        return Err("选择器没有取得前台焦点".into());
    }
    state.picker.lock().map_err(|e| e.to_string())?.confirmed = true;
    Ok(())
}
#[tauri::command]
async fn show_window_picker(app: tauri::AppHandle) -> Result<(), String> {
    if app
        .state::<Native>()
        .picker_opening
        .swap(true, Ordering::SeqCst)
    {
        return Err("窗口选择器正在打开".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        struct Opening(tauri::AppHandle);
        impl Drop for Opening {
            fn drop(&mut self) {
                self.0
                    .state::<Native>()
                    .picker_opening
                    .store(false, Ordering::SeqCst);
            }
        }
        let _opening = Opening(app.clone());
        let origin = desktop::current_token();
        let w = if let Some(w) = app.get_webview_window("picker") {
            w
        } else {
            *app.state::<Native>()
                .picker
                .lock()
                .map_err(|e| e.to_string())? = PickerState::default();
            tauri::WebviewWindowBuilder::new(
                &app,
                "picker",
                tauri::WebviewUrl::App("index.html?picker".into()),
            )
            .title("窗口选择")
            .inner_size(600.0, 480.0)
            .min_inner_size(360.0, 280.0)
            .center()
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .build()
            .map_err(|e| e.to_string())?
        };
        let result = (|| -> Result<(), String> {
            let deadline = std::time::Instant::now() + Duration::from_secs(6);
            loop {
                let state = app.state::<Native>();
                let p = state.picker.lock().map_err(|e| e.to_string())?;
                if let Some(error) = &p.error {
                    return Err(error.clone());
                }
                if p.prepared {
                    break;
                }
                drop(p);
                if std::time::Instant::now() >= deadline {
                    return Err("窗口选择器加载超时".into());
                }
                std::thread::sleep(Duration::from_millis(15));
            }
            let identity = picker_identity(&w)?;
            let current = desktop::current_token();
            if current != origin && current != identity.token {
                return Err("前台窗口已变化，已取消打开选择器".into());
            }
            w.show().map_err(|e| e.to_string())?;
            desktop::activate(&identity)?;
            // Window::set_focus only focuses the native top-level window.
            // WebView2 must separately receive keyboard focus.
            w.as_ref().set_focus().map_err(|e| e.to_string())?;
            loop {
                if desktop::current_token() != identity.token {
                    return Err("选择器已失去前台焦点".into());
                }
                if app
                    .state::<Native>()
                    .picker
                    .lock()
                    .map_err(|e| e.to_string())?
                    .confirmed
                {
                    return Ok(());
                }
                if std::time::Instant::now() >= deadline {
                    return Err("选择器没有确认键盘焦点".into());
                }
                std::thread::sleep(Duration::from_millis(15));
            }
        })();
        if result.is_err() {
            let _ = w.destroy();
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Default)]
struct Native {
    picker: Mutex<PickerState>,
    picker_opening: AtomicBool,
    port: Mutex<Option<Box<dyn serialport::SerialPort>>>,
    background: AtomicBool,
}
#[derive(Serialize)]
struct Port {
    path: String,
    serial: String,
    name: String,
}
#[tauri::command]
fn ports() -> Result<Vec<Port>, String> {
    Ok(serialport::available_ports()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|p| {
            if let serialport::SerialPortType::UsbPort(u) = p.port_type {
                if u.vid == 0xcafe && u.pid == 0x4016 {
                    return Some(Port {
                        path: p.port_name,
                        serial: u.serial_number.unwrap_or_default(),
                        name: u.product.unwrap_or("Vibe Remote Buddy".into()),
                    });
                }
            }
            None
        })
        .collect())
}
#[tauri::command]
fn serial_open(path: String, state: State<Native>) -> Result<(), String> {
    if !ports()?.iter().any(|p| p.path == path) {
        return Err("不是受支持的接收器".into());
    }
    let mut guard = state.port.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("管理端口已经打开".into());
    }
    let mut p = serialport::new(path, 115200)
        .timeout(Duration::from_millis(20))
        .open()
        .map_err(|e| e.to_string())?;
    p.clear(serialport::ClearBuffer::All)
        .map_err(|e| e.to_string())?;
    p.write_data_terminal_ready(true)
        .map_err(|e| e.to_string())?;
    *guard = Some(p);
    Ok(())
}
#[tauri::command]
fn serial_close(state: State<Native>) -> Result<(), String> {
    if let Some(mut p) = state.port.lock().map_err(|e| e.to_string())?.take() {
        let _ = p.write_data_terminal_ready(false);
    }
    Ok(())
}
#[tauri::command]
fn serial_write(data: Vec<u8>, state: State<Native>) -> Result<(), String> {
    if data.len() > 552 {
        return Err("写入数据过长".into());
    }
    state
        .port
        .lock()
        .map_err(|e| e.to_string())?
        .as_mut()
        .ok_or("串口未连接")?
        .write_all(&data)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn serial_read(state: State<Native>) -> Result<Vec<u8>, String> {
    let mut g = state.port.lock().map_err(|e| e.to_string())?;
    let p = g.as_mut().ok_or("串口未连接")?;
    let count = p.bytes_to_read().map_err(|e| e.to_string())?;
    if count == 0 {
        return Ok(vec![]);
    }
    let mut data = vec![0; count.min(4096) as usize];
    match p.read(&mut data) {
        Ok(n) => {
            data.truncate(n);
            Ok(data)
        }
        Err(e) if e.kind() == std::io::ErrorKind::TimedOut => Ok(vec![]),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let p = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json");
    match std::fs::read(p) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
fn save_settings(value: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("配置过大".into());
    }
    let p = dir.join("settings.tmp");
    let mut file = std::fs::File::create(&p).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    std::fs::rename(p, dir.join("settings.json")).map_err(|e| e.to_string())
}
#[tauri::command]
fn set_background(enabled: bool, state: State<Native>) {
    state.background.store(enabled, Ordering::Relaxed);
}
#[tauri::command]
async fn choose_application() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("选择应用程序")
        .pick_file()
        .await
        .map(|f| f.path().to_string_lossy().into_owned())
}
#[tauri::command]
async fn export_config(text: String) -> Result<bool, String> {
    if text.len() > 1024 * 1024 {
        return Err("配置过大".into());
    }
    if let Some(file) = rfd::AsyncFileDialog::new()
        .set_file_name("vibe-remote-buddy.json")
        .add_filter("JSON", &["json"])
        .save_file()
        .await
    {
        std::fs::write(file.path(), text).map_err(|e| e.to_string())?;
        return Ok(true);
    }
    Ok(false)
}
#[tauri::command]
async fn import_config() -> Result<Option<String>, String> {
    if let Some(file) = rfd::AsyncFileDialog::new()
        .add_filter("JSON", &["json"])
        .pick_file()
        .await
    {
        if std::fs::metadata(file.path())
            .map_err(|e| e.to_string())?
            .len()
            > 1024 * 1024
        {
            return Err("配置过大".into());
        }
        return std::fs::read_to_string(file.path())
            .map(Some)
            .map_err(|e| e.to_string());
    }
    Ok(None)
}
#[tauri::command]
fn run_action(kind: String, target: String) -> Result<(), String> {
    match kind.as_str() {
        "web" if target.starts_with("https://") || target.starts_with("http://") => {
            open::that(target).map_err(|e| e.to_string())
        }
        "app" => {
            let p = std::path::Path::new(&target);
            if !p.is_absolute() || !p.exists() {
                return Err("应用程序路径无效".into());
            }
            if activate::existing(&target)? {
                return Ok(());
            }
            #[cfg(target_os = "macos")]
            {
                std::process::Command::new("open")
                    .arg("-a")
                    .arg(p)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            #[cfg(not(target_os = "macos"))]
            {
                std::process::Command::new(p)
                    .spawn()
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        _ => Err("不支持的动作".into()),
    }
}
#[tauri::command]
fn quit(app: tauri::AppHandle, state: State<Native>) {
    let _ = serial_close(state);
    app.exit(0);
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .manage(Native::default())
        .invoke_handler(tauri::generate_handler![
            ports,
            serial_open,
            serial_close,
            serial_read,
            serial_write,
            load_settings,
            save_settings,
            set_background,
            choose_application,
            export_config,
            import_config,
            run_action,
            desktop_available,
            desktop_focus_token,
            installed_applications,
            launch_installed_application,
            desktop_windows,
            desktop_foreground,
            desktop_activate,
            desktop_input_method,
            desktop_focus,
            desktop_command,
            show_window_picker,
            picker_prepared,
            picker_confirm,
            quit
        ])
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            // Tauri's ICO decoder takes the first frame, not the largest frame.
            // Explicit large RGBA also protects against future ICO reordering.
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/128x128@2x.png"
                ))?)?;
            }
            let show =
                MenuItem::with_id(app, "show", "打开 Vibe Remote Buddy", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &exit])?;
            TrayIconBuilder::with_id("main")
                .icon(tray_image()?)
                .tooltip("Vibe Remote Buddy")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "exit" => {
                        let _ = serial_close(app.state());
                        app.exit(0)
                    }
                    _ => (),
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|w, event| {
            if matches!(event, tauri::WindowEvent::ScaleFactorChanged { .. }) {
                if let (Some(tray), Ok(icon)) = (w.app_handle().tray_by_id("main"), tray_image()) {
                    let _ = tray.set_icon(Some(icon));
                }
            }
            if w.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if w.state::<Native>().background.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = w.hide();
                } else {
                    let _ = serial_close(w.state());
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 Vibe Remote Buddy 失败");
}
