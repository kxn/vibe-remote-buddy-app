use serde_json::Value;
use std::{fs, path::{Path, PathBuf}};
use tauri::Manager;
fn root(app: &tauri::AppHandle)->Result<PathBuf,String>{ Ok(app.path().app_config_dir().map_err(|e|e.to_string())?.join("model-overrides")) }
fn valid_id(id:&str)->bool{!id.is_empty()&&id.len()<=47&&id.as_bytes()[0].is_ascii_alphanumeric()&&id.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b"._-".contains(&b))}
#[tauri::command]
pub fn model_overrides(app:tauri::AppHandle)->Result<Vec<Value>,String>{
 let root=root(&app)?;if !root.exists(){return Ok(vec![])}
 let mut out=vec![];
 for entry in fs::read_dir(root).map_err(|e|e.to_string())?.flatten(){
  let path=entry.path();if path.extension().and_then(|s|s.to_str())!=Some("json"){continue}
  let data=fs::read(path).map_err(|e|e.to_string())?;if data.len()>65536{return Err("本地默认配置过大".into())}
  out.push(serde_json::from_slice(&data).map_err(|e|e.to_string())?);
 } Ok(out)
}
fn store(root:&Path,id:&str,value:Option<Value>)->Result<(),String>{
 if !valid_id(id){return Err("机型标识无效".into())}
 fs::create_dir_all(root).map_err(|e|e.to_string())?;
 let path=root.join(format!("{id}.json"));
 let data=if let Some(v)=value {
  if v["format_version"]!=1||v["id"]!=id{return Err("本地默认配置格式无效".into())}
  let b=serde_json::to_vec_pretty(&v).map_err(|e|e.to_string())?;if b.len()>65536{return Err("本地默认配置过大".into())}Some(b)
 } else {None};
 let next=root.join(format!("{id}.next"));let backup=root.join(format!("{id}.previous"));
 if let Some(ref bytes)=data {use std::io::Write;let mut f=fs::File::create(&next).map_err(|e|e.to_string())?;f.write_all(bytes).map_err(|e|e.to_string())?;f.sync_all().map_err(|e|e.to_string())?;}
 if backup.exists(){fs::remove_file(&backup).map_err(|e|e.to_string())?;}
 if path.exists(){fs::copy(&path,&backup).map_err(|e|e.to_string())?;}
 if data.is_some(){fs::rename(&next,&path).map_err(|e|e.to_string())?;}else if path.exists(){fs::remove_file(&path).map_err(|e|e.to_string())?;}
 Ok(())
}
#[tauri::command]
pub fn save_model_override(app:tauri::AppHandle,id:String,value:Option<Value>)->Result<(),String>{store(&root(&app)?,&id,value)}
#[cfg(test)] mod tests {
 use super::*;
 #[test] fn replace_reset_and_validate(){let root=std::env::temp_dir().join(format!("buddy-overrides-{}",std::process::id()));let v=serde_json::json!({"format_version":1,"id":"test.remote"});store(&root,"test.remote",Some(v.clone())).unwrap();store(&root,"test.remote",Some(v)).unwrap();assert!(root.join("test.remote.previous").exists());assert!(store(&root,"../bad",None).is_err());store(&root,"test.remote",None).unwrap();assert!(!root.join("test.remote.json").exists());fs::remove_file(root.join("test.remote.previous")).unwrap();fs::remove_dir(root).unwrap();}
}
