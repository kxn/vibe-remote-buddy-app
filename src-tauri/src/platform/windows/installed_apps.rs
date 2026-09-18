pub use crate::platform::types::InstalledApp;
pub fn list() -> Result<Vec<InstalledApp>, String> {
    use std::{
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let root = std::env::var_os("SystemRoot").ok_or("Windows 系统目录不可用")?;
    let exe = std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    // Fixed script only: no executable path, profile id or user text is interpolated.
    let script = r#"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $ErrorActionPreference='Stop'; ConvertTo-Json -Compress -InputObject @(Get-StartApps | Where-Object { $_.Name -match '^(ChatGPT|Codex|ZCode|Windows Terminal|Terminal|Terminal Preview|终端)$' -or $_.AppID -match '^(OpenAI\.(ChatGPT|Codex)|Microsoft\.WindowsTerminal)' })"#;
    let mut child = Command::new(exe)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("读取已安装应用超时".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "读取已安装应用失败：{}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let json = String::from_utf8_lossy(&out.stdout);
    if json.trim().is_empty() {
        return Ok(vec![]);
    }
    serde_json::from_str(&json).map_err(|e| format!("应用目录格式错误：{e}"))
}
pub fn launch(app_id: &str) -> Result<(), String> {
    if !list()?.iter().any(|a| a.app_id == app_id) {
        return Err("应用已卸载或启动入口已变化".into());
    }
    let root = std::env::var_os("SystemRoot").ok_or("Windows 系统目录不可用")?;
    std::process::Command::new(std::path::PathBuf::from(root).join("explorer.exe"))
        .arg(format!(r"shell:AppsFolder\{app_id}"))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
