use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Command, Stdio},
    sync::{atomic::Ordering, mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, State};

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Candidate {
    pub path: String,
    pub name: String,
    pub serial: String,
    pub vid: u16,
    pub pid: u16,
}
#[derive(Clone, Serialize, Default)]
pub struct Status {
    pub phase: String,
    pub info: Option<Value>,
    pub error: String,
    pub logs: Vec<String>,
}
struct Ticket {
    candidate: Candidate,
    info: Value,
    created: Instant,
}
#[derive(Default)]
pub struct Setup {
    status: Mutex<Status>,
    ticket: Mutex<Option<Ticket>>,
}
fn folder() -> Result<PathBuf, String> {
    Ok(std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("应用目录不存在")?
        .join("resources/installer"))
}
fn helper() -> Result<PathBuf, String> {
    if !cfg!(windows) {
        return Err("此平台暂不支持初始化接收器".into());
    }
    let p = folder()?.join("receiver-setup.exe");
    if !p.is_file() {
        return Err("缺少初始化工具，请使用完整应用包".into());
    }
    Ok(p)
}
#[tauri::command]
pub fn setup_candidates() -> Result<Vec<Candidate>, String> {
    let mut result: Vec<_> = serialport::available_ports()
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|p| {
            if let serialport::SerialPortType::UsbPort(u) = p.port_type {
                // Enumeration only. USB bridges are candidates, never proof of an ESP32.
                if [0x303a, 0x10c4, 0x1a86, 0x0403].contains(&u.vid) {
                    return Some(Candidate {
                        path: p.port_name,
                        name: u.product.unwrap_or("USB 开发板".into()),
                        serial: u.serial_number.unwrap_or_default(),
                        vid: u.vid,
                        pid: u.pid,
                    });
                }
            }
            None
        })
        .collect();
    result.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}
#[tauri::command]
pub fn setup_package() -> Result<Option<Value>, String> {
    helper()?;
    let p = folder()?.join("catalog.json");
    if !p.is_file() {
        return Ok(None);
    }
    Ok(Some(
        serde_json::from_slice(&std::fs::read(p).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?,
    ))
}
#[tauri::command]
pub fn setup_status(state: State<Setup>, native: State<super::Native>) -> Result<Status, String> {
    let mut s = state.status.lock().map_err(|e| e.to_string())?.clone();
    if native.initializing.load(Ordering::SeqCst)
        && ["checked", "written", "error"].contains(&s.phase.as_str())
    {
        s.phase = "finishing".into();
    }
    Ok(s)
}
fn command(
    operation: &str,
    candidate: &Candidate,
    expected: Option<&str>,
    confirm: bool,
    variant: Option<&str>,
) -> Result<Command, String> {
    let mut cmd = Command::new(helper()?);
    cmd.arg(operation)
        .arg("--port")
        .arg(&candidate.path)
        .arg("--package")
        .arg(folder()?);
    if let Some(mac) = expected {
        cmd.arg("--expected-mac").arg(mac);
    }
    if let Some(v) = variant {
        cmd.arg("--variant").arg(v);
    }
    if confirm {
        cmd.arg("--confirm-board");
    }
    cmd.env("PYTHONUTF8", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    Ok(cmd)
}
fn execute(mut cmd: Command, limit: Duration, mut line: impl FnMut(&str)) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let (tx, rx) = mpsc::channel();
    let out = child.stdout.take().ok_or("工具输出不可用")?;
    let err = child.stderr.take().ok_or("工具错误输出不可用")?;
    let tx2 = tx.clone();
    std::thread::spawn(move || {
        for v in BufReader::new(out).lines().map_while(Result::ok) {
            if tx.send(v).is_err() {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        for v in BufReader::new(err).lines().map_while(Result::ok) {
            if tx2.send(v).is_err() {
                break;
            }
        }
    });
    let deadline = Instant::now() + limit;
    loop {
        if let Ok(v) = rx.recv_timeout(Duration::from_millis(50)) {
            line(&v);
        }
        match child.try_wait() {
            Ok(Some(code)) => {
                for v in rx {
                    line(&v);
                }
                return if code.success() {
                    Ok(())
                } else {
                    Err(format!("烧录工具退出: {code}"))
                };
            }
            Ok(None) => (),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.to_string());
            }
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("设备操作超时，请使用 BOOT 重新连接".into());
        }
    }
}
fn lock_native(app: &tauri::AppHandle) -> Result<(), String> {
    let native = app.state::<super::Native>();
    let port = native.port.lock().map_err(|e| e.to_string())?;
    if port.is_some() {
        return Err("请先断开接收器管理连接".into());
    }
    native
        .updating
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "已有设备操作正在进行")?;
    native.initializing.store(true, Ordering::SeqCst);
    Ok(())
}
fn launch(
    app: tauri::AppHandle,
    candidate: Candidate,
    operation: &str,
    info: Option<Value>,
    confirm: bool,
) -> Result<(), String> {
    if !setup_candidates()?.contains(&candidate) {
        return Err("设备已改变，请重新选择".into());
    }
    let cmd = command(
        operation,
        &candidate,
        info.as_ref().and_then(|v| v["mac"].as_str()),
        confirm,
        info.as_ref().and_then(|v| v["variant"].as_str()),
    )?;
    lock_native(&app)?;
    let operation = operation.to_string();
    *app.state::<Setup>().status.lock().unwrap() = Status {
        phase: "connecting".into(),
        ..Default::default()
    };
    std::thread::spawn(move || {
        let result = execute(
            cmd,
            Duration::from_secs(if operation == "install" { 600 } else { 45 }),
            |line| {
                let setup = app.state::<Setup>();
                let mut s = setup.status.lock().unwrap();
                if let Some(raw) = line.strip_prefix("@buddy:") {
                    if let Ok(v) = serde_json::from_str::<Value>(raw) {
                        if let Some(p) = v["phase"].as_str() {
                            s.phase = p.to_string();
                        }
                        if v["info"].is_object() {
                            s.info = Some(v["info"].clone());
                        }
                        if let Some(e) = v["error"].as_str() {
                            s.error = e.into();
                        }
                    }
                } else if !line.trim().is_empty() {
                    s.logs.push(line.chars().take(1000).collect());
                    if s.logs.len() > 80 {
                        s.logs.remove(0);
                    }
                }
            },
        );
        let setup = app.state::<Setup>();
        let mut s = setup.status.lock().unwrap();
        if let Err(e) = result {
            if s.error.is_empty() {
                s.error = e;
            }
            s.phase = "error".into();
        } else if operation == "check" && s.phase == "checked" {
            if let Some(info) = s.info.clone() {
                *setup.ticket.lock().unwrap() = Some(Ticket {
                    candidate,
                    info,
                    created: Instant::now(),
                });
            } else {
                s.phase = "error".into();
                s.error = "未收到设备检查结果".into();
            }
        } else if operation == "install" && s.phase != "written" {
            s.phase = "error".into();
            s.error = "未收到写入校验结果".into();
        }
        // Release ownership before publishing the final state to polling clients.
        app.state::<super::Native>()
            .initializing
            .store(false, Ordering::SeqCst);
        app.state::<super::Native>()
            .updating
            .store(false, Ordering::SeqCst);
    });
    Ok(())
}
#[tauri::command]
pub fn setup_check(app: tauri::AppHandle, candidate: Candidate) -> Result<(), String> {
    if app
        .state::<super::Native>()
        .initializing
        .load(Ordering::SeqCst)
    {
        return Err("设备操作进行中".into());
    }
    *app.state::<Setup>().ticket.lock().unwrap() = None;
    launch(app, candidate, "check", None, false)
}
#[tauri::command]
pub fn setup_install(
    app: tauri::AppHandle,
    confirmed: bool,
    board_confirmed: bool,
    variant: String,
) -> Result<(), String> {
    if !confirmed {
        return Err("需要明确确认清除设备".into());
    }
    let mut ticket = app
        .state::<Setup>()
        .ticket
        .lock()
        .unwrap()
        .take()
        .ok_or("请重新检查设备")?;
    if ticket.created.elapsed() > Duration::from_secs(180) {
        return Err("检查已过期，请重新连接设备".into());
    }
    if ticket.info["psram_known"] != true && !board_confirmed {
        return Err("请核对板型规格".into());
    }
    if !["q2", "o8", "q2-f4"].contains(&variant.as_str()) {
        return Err("请选择内存规格".into());
    }
    if ticket.info["psram_known"] == true && ticket.info["variant"] != variant {
        return Err("固件类型与设备不匹配".into());
    }
    ticket.info["variant"] = Value::String(variant);
    launch(
        app,
        ticket.candidate,
        "install",
        Some(ticket.info),
        board_confirmed,
    )
}
#[tauri::command]
pub async fn setup_release(app: tauri::AppHandle) -> Result<(), String> {
    if app
        .state::<super::Native>()
        .initializing
        .load(Ordering::SeqCst)
    {
        return Err("操作尚未结束".into());
    }
    let ticket = app.state::<Setup>().ticket.lock().unwrap().take();
    if let Some(t) = ticket {
        if !setup_candidates()?.contains(&t.candidate) {
            return Ok(());
        }
        let cmd = command("reset", &t.candidate, t.info["mac"].as_str(), false, None)?;
        lock_native(&app)?;
        let result = tauri::async_runtime::spawn_blocking(move || {
            execute(cmd, Duration::from_secs(20), |_| {})
        })
        .await;
        app.state::<super::Native>()
            .initializing
            .store(false, Ordering::SeqCst);
        app.state::<super::Native>()
            .updating
            .store(false, Ordering::SeqCst);
        result.map_err(|e| e.to_string())??;
    }
    Ok(())
}
