use serde::Serialize;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;
#[derive(Serialize)]
pub struct ModelSource {
    evidence: Option<Value>,
    edited: bool,
    source: String,
    model: Value,
    image: Option<String>,
    error: Option<String>,
}
fn read_package(dir: &Path) -> Result<(Value, Option<String>), String> {
    let path = dir.join("model.json");
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    if data.len() > 65536 {
        return Err("型号文件超过 64 KB".into());
    }
    let model: Value = serde_json::from_slice(&data).map_err(|e| e.to_string())?;
    let image = if let Some(name) = model.pointer("/layout/artwork").and_then(Value::as_str) {
        let base = dir.canonicalize().map_err(|e| e.to_string())?;
        let path = dir.join(name).canonicalize().map_err(|e| e.to_string())?;
        if !path.starts_with(&base) || path.extension().and_then(|v| v.to_str()) != Some("svg") {
            return Err("图片必须是型号目录内的 SVG".into());
        }
        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        if bytes.len() > 262144 {
            return Err("图片超过 256 KB".into());
        }
        Some(String::from_utf8(bytes).map_err(|e| e.to_string())?)
    } else {
        None
    };
    Ok((model, image))
}
#[tauri::command]
pub fn remote_model_resources(app: tauri::AppHandle) -> Result<Vec<ModelSource>, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let beside = exe
        .parent()
        .ok_or("程序目录无效")?
        .join("resources/remotes");
    let root: PathBuf = if beside.is_dir() {
        beside
    } else if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/remotes")
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("resources/remotes")
    };
    let mut entries: Vec<_> = fs::read_dir(&root)
        .map_err(|e| format!("{}: {}", root.display(), e))?
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .collect();
    entries.sort_by_key(|e| e.file_name());
    if entries.len() > 64 {
        return Err("型号资源目录超过 64 个".into());
    }
    Ok(entries
        .into_iter()
        .map(|e| {
            let source = e.path().display().to_string();
            match read_package(&e.path()) {
                Ok((model, image)) => ModelSource {
                    evidence: fs::read(e.path().join("probe-evidence.json")).ok().filter(|b|b.len()<=2*1024*1024).and_then(|b|serde_json::from_slice(&b).ok()),
                    edited: e.path().join("user-edited").is_file(),
                    source,
                    model,
                    image,
                    error: None,
                },
                Err(error) => ModelSource {
                    evidence: None,
                    edited: false,
                    source,
                    model: Value::Null,
                    image: None,
                    error: Some(error),
                },
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn package_export_preserves_assets_and_never_overwrites() {
        let root = std::env::temp_dir().join(format!("buddy-model-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let (mut model, image) = read_package(
            &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/remotes/xiaomi.rc003"),
        )
        .unwrap();
        model["id"] = Value::String("example.export".into());
        let dir = write_model_package(&root, model.clone(), image.clone(), "{}").unwrap();
        let (loaded, svg) = read_package(Path::new(&dir)).unwrap();
        assert_eq!(loaded["id"], "example.export");
        assert_eq!(svg, image);
        assert!(write_model_package(&root, model.clone(), None, "{}").is_err());
        model["id"] = Value::String("../escape".into());
        assert!(write_model_package(&root, model, None, "{}").is_err());
        for name in ["model.json", "artwork.svg", "probe-evidence.json"] {
            fs::remove_file(Path::new(&dir).join(name)).unwrap();
        }
        fs::remove_dir(dir).unwrap();
        fs::remove_dir(root).unwrap();
    }
    #[test]
    fn packaged_models_include_external_artwork() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/remotes");
        for id in ["xiaomi.rc003", "unicom.hid_ico.v1"] {
            let (model, image) = read_package(&root.join(id)).unwrap();
            assert_eq!(model["id"], id);
            assert!(image.unwrap().contains("<svg"));
        }
        assert!(read_package(&root.join("missing-model")).is_err());
    }
}

fn write_model_package(
    root: &Path,
    mut model: Value,
    image: Option<String>,
    evidence: &str,
) -> Result<String, String> {
    let id = model
        .get("id")
        .and_then(Value::as_str)
        .ok_or("缺少型号标识")?
        .to_owned();
    if id.is_empty()
        || id.len() > 47
        || !id.as_bytes()[0].is_ascii_alphanumeric()
        || !id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c))
    {
        return Err("型号标识无效".into());
    }
    if evidence.len() > 2 * 1024 * 1024 {
        return Err("采集信息过大".into());
    }
    let object = model.as_object_mut().ok_or("型号格式无效")?;
    object.remove("image");
    let layout = object
        .get_mut("layout")
        .and_then(Value::as_object_mut)
        .ok_or("缺少布局")?;
    if let Some(ref svg) = image {
        if svg.len() > 262144 {
            return Err("图片过大".into());
        }
        layout.insert("artwork".into(), Value::String("artwork.svg".into()));
    } else {
        layout.remove("artwork");
    }
    let data = serde_json::to_string_pretty(&model).map_err(|e| e.to_string())?;
    if data.len() > 65536 {
        return Err("型号文件过大".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let dir = root.join(&id);
    if dir.exists() {
        return Err("同名型号目录已经存在，请使用新的标识".into());
    }
    // Reserve the destination without ever overwriting a user's existing package.
    fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), std::io::Error> {
        if let Some(svg) = image {
            fs::write(dir.join("artwork.svg"), svg)?;
        }
        fs::write(dir.join("probe-evidence.json"), evidence)?;
        // Write the discoverable entry last; interrupted exports are not valid packages.
        fs::write(dir.join("model.json"), data)?;
        Ok(())
    })();
    result.map_err(|e| format!("{}: {}", dir.display(), e))?;
    Ok(dir.display().to_string())
}
#[tauri::command]
pub async fn save_remote_model(
    model: Value,
    image: Option<String>,
    evidence: String,
) -> Result<Option<String>, String> {
    let root = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("程序目录无效")?
        .join("resources/remotes");
    write_model_package(&root, model, image, &evidence).map(Some)
}

#[tauri::command]
pub async fn update_remote_model(model: Value, image: String) -> Result<String, String> {
    let root = std::env::current_exe().map_err(|e|e.to_string())?.parent().ok_or("程序目录无效")?.join("resources/remotes");
    replace_model_package(&root, model, image)
}
fn replace_model_package(root: &Path, model: Value, image: String) -> Result<String, String> {
    let id = model["id"].as_str().ok_or("缺少型号标识")?;
    if id.is_empty() || !id.bytes().all(|c|c.is_ascii_lowercase() || c.is_ascii_digit() || b"._-".contains(&c)) || id.starts_with('.') { return Err("型号标识无效".into()); }
    let dir=root.join(id);
    let (old, _) = read_package(&dir)?;
    for key in ["id", "schema", "family", "matches", "raw", "map_crc"] {
        if old[key] != model[key] { return Err("编辑已有型号不能改变协议或键码".into()); }
    }
    let ids=|v:&Value| v["keys"].as_array().map(|a|a.iter().map(|k|k["id"].clone()).collect::<Vec<_>>());
    if ids(&old)!=ids(&model) {return Err("编辑已有型号不能增删按键".into());}
    let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let staging=root.join(format!(".edit-{}",stamp));
    let evidence=fs::read_to_string(dir.join("probe-evidence.json")).unwrap_or_default();
    let staged=PathBuf::from(write_model_package(&staging,model.clone(),Some(image),&evidence)?);
    fs::write(staged.join("user-edited"), b"1").map_err(|e|e.to_string())?;
    let backup=root.join(format!(".backup-{}-{}",id,stamp));
    fs::rename(&dir,&backup).map_err(|e|e.to_string())?;
    if let Err(e)=fs::rename(&staged,&dir) {
        let restore=fs::rename(&backup,&dir);
        return Err(format!("保存失败: {}; 恢复结果: {:?}",e,restore));
    }
    let _=fs::remove_dir(&staging);
    Ok(dir.display().to_string())
}

#[cfg(test)]
mod edit_tests {
 use super::*;
 #[test]
 fn edits_keep_identity_and_backup_the_original() {
  let root=std::env::temp_dir().join(format!("buddy-edit-{}",std::process::id()));
  fs::create_dir_all(&root).unwrap();
  let (mut m,image)=read_package(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../resources/remotes/xiaomi.rc003")).unwrap();
  write_model_package(&root,m.clone(),image.clone(),"evidence").unwrap();
  m["keys"][0]["label"]=Value::String("Changed".into());
  replace_model_package(&root,m.clone(),image.clone().unwrap()).unwrap();
  assert_eq!(read_package(&root.join("xiaomi.rc003")).unwrap().0["keys"][0]["label"],"Changed");
  assert!(root.join("xiaomi.rc003/user-edited").exists());
  assert!(fs::read_dir(&root).unwrap().filter_map(Result::ok).any(|e|e.file_name().to_string_lossy().starts_with(".backup-")));
  m["family"]=Value::from(2);
  assert!(replace_model_package(&root,m,image.unwrap()).is_err());
  fs::remove_dir_all(root).unwrap();
 }
}
