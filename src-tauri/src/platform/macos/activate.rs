use super::desktop;
/// Activates the front window of an already running `.app`. A running
/// application without windows is left to `open -a`, which reopens one.
pub fn existing(target: &str) -> Result<bool, String> {
    let canonical = std::fs::canonicalize(target).map_err(|e| e.to_string())?;
    let path = canonical.to_string_lossy();
    if let Some(window) = desktop::list()?
        .into_iter()
        .find(|w| std::fs::canonicalize(&w.path).is_ok_and(|p| p.to_string_lossy() == path))
    {
        desktop::activate(&window)?;
        return Ok(true);
    }
    Ok(false)
}
