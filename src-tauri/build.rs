use std::{env, fs, path::PathBuf};
fn main() {
    if env::var("PROFILE").as_deref() == Ok("release")
        && env::var_os("CARGO_FEATURE_CUSTOM_PROTOCOL").is_none()
    {
        panic!("Release requires embedded frontend assets. Use npm run release (Tauri build), not plain cargo build --release.");
    }
    println!("cargo:rerun-if-env-changed=BUDDY_FIRMWARE_DIR");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let mut arms = String::new();
    if let Some(dir) = env::var_os("BUDDY_FIRMWARE_DIR") {
        let dir = PathBuf::from(dir);
        for variant in ["q2", "o8", "q2-f4"] {
            for file in ["manifest.json", "receiver.bin"] {
                let path = dir.join(variant).join(file);
                println!("cargo:rerun-if-changed={}", path.display());
                fs::copy(path, out.join(format!("{variant}-{file}")))
                    .expect("firmware variant missing");
            }
            let target = if variant == "q2-f4" { "s3-q2-f4-ab2".to_string() } else { format!("s3-{variant}-ab1") };
            arms.push_str(&format!(r#""{target}" => Some((include_bytes!(concat!(env!("OUT_DIR"), "/{variant}-manifest.json")).as_slice(), include_bytes!(concat!(env!("OUT_DIR"), "/{variant}-receiver.bin")).as_slice())),"#));
        }
    }
    fs::write(
        out.join("firmware-select.rs"),
        format!("match target.as_str() {{ {arms} _ => None }}"),
    )
    .unwrap();
    println!("cargo:rerun-if-changed=../resources");
    // Portable Windows distribution: executable plus editable resources directory.
    let target = out.ancestors().nth(3).unwrap().join("resources");
    fn copy_dir(from: &std::path::Path, to: &std::path::Path) {
        fs::create_dir_all(to).unwrap();
        for item in fs::read_dir(from).unwrap() {
            let item = item.unwrap();
            let dst = to.join(item.file_name());
            if item.file_type().unwrap().is_dir() {
                copy_dir(&item.path(), &dst)
            } else {
                fs::copy(item.path(), dst).unwrap();
            }
        }
    }
    copy_dir(std::path::Path::new("../resources"), &target);
    tauri_build::build();
}
