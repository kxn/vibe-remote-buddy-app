#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
mod model_overrides;
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
mod models;
mod catalog;
mod platform;
mod receiver_setup;
use platform::{activate, desktop, ime, installed_apps};
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}
fn tray_image() -> Result<tauri::image::Image<'static>, tauri::Error> {
    let size = platform::shell::tray_size();
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
fn desktop_platform() -> &'static str {
    std::env::consts::OS
}
#[tauri::command]
fn desktop_available() -> bool {
    platform::DESKTOP_AVAILABLE
}
/// Display name and icon per application path; only macOS provides them.
#[tauri::command]
async fn desktop_app_display(paths: Vec<String>) -> Vec<Option<serde_json::Value>> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|p| platform::app_display::get(p).and_then(|d| serde_json::to_value(d).ok()))
            .collect()
    })
    .await
    .unwrap_or_default();
    #[cfg(not(target_os = "macos"))]
    paths.iter().map(|_| None).collect()
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
#[tauri::command]
fn picker_confirm(window: tauri::WebviewWindow, state: State<Native>) -> Result<(), String> {
    if window.label() != "picker"
        || desktop::current_token() != platform::shell::picker_identity(&window)?.token
    {
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
            let identity = platform::shell::picker_identity(&w)?;
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
    updating: AtomicBool,
    initializing: AtomicBool,
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
        // macOS lists each USB serial device as /dev/cu.* and /dev/tty.*; the
        // dial-in tty node waits for carrier, so keep only the callout node.
        .filter(|p| !cfg!(target_os = "macos") || p.port_name.starts_with("/dev/cu."))
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
    if state.initializing.load(Ordering::SeqCst) {
        return Err("接收器正在初始化".into());
    }
    if !ports()?.iter().any(|p| p.path == path) {
        return Err("不是受支持的接收器".into());
    }
    let mut guard = state.port.lock().map_err(|e| e.to_string())?;
    if state.initializing.load(Ordering::SeqCst) {
        return Err("接收器正在初始化".into());
    }
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
fn serial_failure(app: &tauri::AppHandle, operation: &str, error: impl std::fmt::Display + std::fmt::Debug) -> String {
    let message = format!("USB 串口{operation}失败：{error}");
    #[cfg(debug_assertions)]
    if let Ok(dir) = app.path().app_local_data_dir() {
        let dir = dir.join("diagnostics");
        let _ = std::fs::create_dir_all(&dir);
        let snapshot = serde_json::json!({"operation":operation,"error":message,"detail":format!("{error:?}"),
            "time":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs()});
        let _ = std::fs::write(dir.join("transport-latest.json"), snapshot.to_string());
    }
    #[cfg(not(debug_assertions))]
    let _ = app;
    message
}
#[tauri::command]
fn serial_write(data: Vec<u8>, state: State<Native>, app: tauri::AppHandle) -> Result<(), String> {
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
        .map_err(|e| serial_failure(&app, "写入", e))
}
#[tauri::command]
fn serial_read(state: State<Native>, app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let mut g = state.port.lock().map_err(|e| e.to_string())?;
    let p = g.as_mut().ok_or("串口未连接")?;
    let count = p.bytes_to_read().map_err(|e| serial_failure(&app, "查询接收缓冲", e))?;
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
        Err(e) => Err(serial_failure(&app, "读取", e)),
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
// Bounded local diagnostic snapshot; never contains recorded PCM or credentials.
#[tauri::command]
fn save_probe_diagnostic(value: serde_json::Value, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("diagnostics");
        let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 { return Err("诊断记录过大".into()); }
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("probe-latest.json"), bytes).map_err(|e| e.to_string())
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = (value, app);
        Err("自动诊断仅在开发构建中可用".into())
    }
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
            platform::shell::launch_path(p)?;
            Ok(())
        }
        _ => Err("不支持的动作".into()),
    }
}
#[tauri::command]
fn quit(app: tauri::AppHandle, state: State<Native>) {
    if state.updating.load(Ordering::Relaxed) {
        return;
    }
    let _ = serial_close(state);
    app.exit(0);
}
#[tauri::command]
fn firmware_package(target: String) -> Result<Option<serde_json::Value>, String> {
    let selected: Option<(&[u8], &[u8])> =
        include!(concat!(env!("OUT_DIR"), "/firmware-select.rs"));
    let Some((raw, image)) = selected else {
        return Ok(None);
    };
    let manifest: serde_json::Value = serde_json::from_slice(raw).map_err(|e| e.to_string())?;
    if image.len() > 2 * 1024 * 1024 || manifest["target"] != target {
        return Err("固件包类型不匹配".into());
    }
    Ok(Some(serde_json::json!({"manifest":manifest,"image":image})))
}
#[tauri::command]
fn firmware_lock(enabled: bool, state: State<Native>) -> Result<(), String> {
    if state.initializing.load(Ordering::SeqCst) {
        return Err("接收器正在初始化".into());
    }
    state.updating.store(enabled, Ordering::Relaxed);
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_main(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .manage(Native::default())
        .manage(receiver_setup::Setup::default())
        .invoke_handler(tauri::generate_handler![
            models::remote_model_resources,
            catalog::catalog_resources,
            catalog::catalog_stage,
            catalog::catalog_activate,
            models::save_remote_model,
            models::update_remote_model,
            model_overrides::model_overrides,
            model_overrides::save_model_override,
            receiver_setup::setup_candidates,
            receiver_setup::setup_package,
            receiver_setup::setup_check,
            receiver_setup::setup_status,
            receiver_setup::setup_install,
            receiver_setup::setup_release,
            firmware_package,
            firmware_lock,
            ports,
            serial_open,
            serial_close,
            serial_read,
            save_probe_diagnostic,
            serial_write,
            load_settings,
            save_settings,
            set_background,
            choose_application,
            export_config,
            import_config,
            run_action,
            desktop_available,
            desktop_platform,
            desktop_focus_token,
            installed_applications,
            launch_installed_application,
            desktop_windows,
            desktop_app_display,
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
            #[cfg(target_os = "macos")]
            platform::fn_bridge::start();
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };
            // Tauri's ICO decoder takes the first frame, not the largest frame.
            // Explicit large RGBA also protects against future ICO reordering.
            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.current_monitor()? {
                    let available = monitor
                        .work_area()
                        .size
                        .to_logical::<f64>(monitor.scale_factor());
                    window.set_size(tauri::LogicalSize::new(
                        880.0_f64.min((available.width - 32.0).max(400.0)),
                        720.0_f64.min((available.height - 64.0).max(420.0)),
                    ))?;
                    window.center()?;
                }
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
                .show_menu_on_left_click(platform::TRAY_MENU_ON_LEFT_CLICK)
                .on_tray_icon_event(|tray, event| {
                    if !platform::TRAY_MENU_ON_LEFT_CLICK
                        && matches!(
                            event,
                            TrayIconEvent::Click {
                                button: MouseButton::Left,
                                button_state: MouseButtonState::Up,
                                ..
                            }
                        )
                    {
                        show_main(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "exit" => {
                        if !app.state::<Native>().updating.load(Ordering::Relaxed) {
                            let _ = serial_close(app.state());
                            app.exit(0);
                        }
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
                if w.state::<Native>().updating.load(Ordering::Relaxed) {
                    api.prevent_close();
                    return;
                }
                if w.state::<Native>().background.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = w.hide();
                } else {
                    let _ = serial_close(w.state());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("启动 Vibe Remote Buddy 失败")
        .run(|_app, _event| {
            // Clicking the Dock icon restores a window hidden to the background.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main(_app);
            }
        });
}
