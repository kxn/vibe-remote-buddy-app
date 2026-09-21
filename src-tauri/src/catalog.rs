use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::{Component, Path, PathBuf}, time::Duration};
use tauri::Manager;
const REPOSITORY: &str = "kxn/vibe-remote-buddy-models";
const MAX_TOTAL: usize = 32 * 1024 * 1024;
#[derive(Serialize)]
pub struct Snapshot { commit: String, version: String, resources: Vec<Value> }
fn safe_path(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if path.contains('\\') || path.contains(':') || p.components().any(|c| !matches!(c, Component::Normal(_))) || p.extension().and_then(|v| v.to_str()) != Some("json") { return Err("机型库路径无效".into()); }
    Ok(p)
}
fn read_snapshot(root: &Path, commit: String) -> Result<Snapshot, String> {
    let index: Value = serde_json::from_slice(&fs::read(root.join("catalog.json")).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    if index["format_version"] != 2 || index["minimum_catalog_api"].as_u64().unwrap_or(u64::MAX) > 2 { return Err("机型库需要更新版本的应用".into()); }
    let entries = index["resources"].as_array().ok_or("机型库索引无效")?;
    if entries.len()>32768 { return Err("机型库资源过多".into()); }
    let mut resources=Vec::new();let mut total=0;let mut paths=std::collections::HashSet::new();
    for entry in entries {
        let path=entry["path"].as_str().ok_or("缺少资源路径")?;safe_path(path)?;
        if !paths.insert(path) { return Err("重复资源路径".into()); }
        let size=entry["size"].as_u64().ok_or("缺少资源大小")? as usize;
        if size>262144 { return Err("机型资源过大".into()); } total+=size;if total>MAX_TOTAL{return Err("机型库过大".into());}
        let data=fs::read(root.join(path)).map_err(|e|e.to_string())?;
        if data.len()!=size || format!("{:x}",Sha256::digest(&data))!=entry["sha256"].as_str().unwrap_or("") { return Err(format!("机型资源校验失败：{path}")); }
        let value:Value=serde_json::from_slice(&data).map_err(|e|e.to_string())?;
        if value["id"]!=entry["id"] || value["kind"]!=entry["kind"] || value["revision"]!=entry["revision"] { return Err("机型资源与索引不符".into()); }
        resources.push(value);
    }
    Ok(Snapshot { commit, version:index["catalog_version"].as_str().ok_or("缺少机型库版本")?.into(),resources })
}
fn root(app:&tauri::AppHandle)->Result<PathBuf,String>{Ok(app.path().app_config_dir().map_err(|e|e.to_string())?.join("catalog"))}
fn bundled(app:&tauri::AppHandle)->Result<PathBuf,String>{
    let exe=std::env::current_exe().map_err(|e|e.to_string())?;let p=exe.parent().ok_or("程序目录无效")?.join("resources/catalog");
    if p.is_dir(){return Ok(p)}
    if cfg!(debug_assertions){return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/catalog"))}
    Ok(app.path().resource_dir().map_err(|e|e.to_string())?.join("resources/catalog"))
}
fn valid_commit(commit:&str)->bool{commit.len()==40&&commit.bytes().all(|b|b.is_ascii_hexdigit())}
#[tauri::command]
pub fn catalog_resources(app:tauri::AppHandle)->Result<Snapshot,String>{
    let r=root(&app)?;
    if let Ok(commit)=fs::read_to_string(r.join("active")) {if valid_commit(&commit){return read_snapshot(&r.join(&commit),commit)}}
    read_snapshot(&bundled(&app)?,"bundled".into())
}
fn download(client:&reqwest::blocking::Client,url:&str,limit:usize)->Result<Vec<u8>,String>{
    let response=client.get(url).send().map_err(|e|e.to_string())?.error_for_status().map_err(|e|e.to_string())?;
    if response.content_length().is_some_and(|n|n>limit as u64){return Err("下载资源过大".into())}
    let mut data=Vec::new();response.take(limit as u64+1).read_to_end(&mut data).map_err(|e|e.to_string())?;
    if data.len()>limit{return Err("下载资源过大".into())}Ok(data)
}
#[tauri::command]
pub async fn catalog_stage(app:tauri::AppHandle)->Result<Snapshot,String>{
    tauri::async_runtime::spawn_blocking(move || {
        let client=reqwest::blocking::Client::builder().user_agent("VibeRemoteBuddy").timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())?;
        let revision:Value=serde_json::from_slice(&download(&client,&format!("https://api.github.com/repos/{REPOSITORY}/commits/main"),1024*1024)?).map_err(|e|e.to_string())?;
        let commit=revision["sha"].as_str().ok_or("无法读取机型库版本")?.to_string();if !valid_commit(&commit){return Err("机型库版本无效".into())}
        let r=root(&app)?;let target=r.join(&commit);
        // Never rewrite an active immutable snapshot, even on a retry.
        if let Ok(snapshot)=read_snapshot(&target,commit.clone()){return Ok(snapshot)}
        fs::create_dir_all(&target).map_err(|e|e.to_string())?;
        let base=format!("https://raw.githubusercontent.com/{REPOSITORY}/{commit}");
        let index_bytes=download(&client,&format!("{base}/catalog.json"),4*1024*1024)?;
        let index:Value=serde_json::from_slice(&index_bytes).map_err(|e|e.to_string())?;
        let entries=index["resources"].as_array().ok_or("机型库索引无效")?;if entries.len()>32768{return Err("机型库资源过多".into())}
        let mut total=0usize;
        for entry in entries {
            let path=entry["path"].as_str().ok_or("缺少资源路径")?;safe_path(path)?;
            let size=entry["size"].as_u64().ok_or("缺少资源大小")?;if size>262144{return Err("机型资源过大".into())}
            total+=size as usize;if total>MAX_TOTAL{return Err("机型库过大".into())}
            let data=download(&client,&format!("{base}/{path}"),size as usize)?;
            if data.len()!=size as usize||format!("{:x}",Sha256::digest(&data))!=entry["sha256"].as_str().unwrap_or(""){return Err("机型库校验失败".into())}
            let output=target.join(path);fs::create_dir_all(output.parent().ok_or("路径无效")?).map_err(|e|e.to_string())?;fs::write(output,data).map_err(|e|e.to_string())?;
        }
        fs::write(target.join("catalog.json"),index_bytes).map_err(|e|e.to_string())?;
        read_snapshot(&target,commit)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn catalog_activate(app:tauri::AppHandle,commit:String)->Result<(),String>{
    if !valid_commit(&commit){return Err("机型库版本无效".into())}let r=root(&app)?;read_snapshot(&r.join(&commit),commit.clone())?;
    let previous=fs::read_to_string(r.join("active")).ok();
    let temporary=r.join("active.next");fs::write(&temporary,&commit).map_err(|e|e.to_string())?;
    fs::rename(temporary,r.join("active")).map_err(|e|e.to_string())?;
    // Only our direct, hash-named snapshot directories are eligible. Keep the
    // previous snapshot for recovery; updates cannot grow storage forever.
    if let Ok(entries)=fs::read_dir(&r){for entry in entries.flatten(){
        let name=entry.file_name().to_string_lossy().to_string();
        if valid_commit(&name)&&name!=commit&&previous.as_deref()!=Some(&name)
            &&entry.file_type().is_ok_and(|t|t.is_dir()&&!t.is_symlink()){
            let _=fs::remove_dir_all(entry.path());
        }
    }}
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn bundled_manifest_verifies_exact_bytes(){
        let snapshot=read_snapshot(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/catalog"),"bundled".into()).unwrap();
        assert_eq!(snapshot.resources.iter().filter(|r|r["kind"]=="model").count(),6);
    }
    #[test] fn paths_stay_in_snapshot(){for p in ["../model.json","/model.json","C:/model.json","a\\b.json","a:stream.json"]{assert!(safe_path(p).is_err());}assert!(safe_path("models/xiaomi/rc003.json").is_ok());}
}
