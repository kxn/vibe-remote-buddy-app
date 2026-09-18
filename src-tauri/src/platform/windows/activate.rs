pub fn existing(target: &str) -> Result<bool, String> {
    let canonical = std::fs::canonicalize(target).map_err(|e| e.to_string())?;
    let path = canonical
        .to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_lowercase();
    if let Some(window) = crate::platform::desktop::list()?
        .into_iter()
        .find(|w| w.path.to_lowercase() == path)
    {
        crate::platform::desktop::activate(&window)?;
        return Ok(true);
    }
    Ok(false)
}
