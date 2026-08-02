//! Vault file I/O and settings persistence.
//!
//! All journal reads and writes go through these commands rather than the `fs`
//! plugin. Two reasons:
//!
//! 1. **The vault folder is user-configurable.** A plugin scope is declared
//!    statically in `capabilities/`, so it can't cover a directory the user
//!    picks at runtime without granting something far broader than we want.
//! 2. **Filenames are validated in one place.** Only the exact shapes the app
//!    writes are accepted, so nothing the webview sends can escape the vault
//!    directory — no path separators, no `..`, no arbitrary extensions.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager, Runtime, State};

/// The active vault directory, swappable at runtime via `vault_set_dir`.
pub struct VaultState {
    dir: Mutex<PathBuf>,
}

impl VaultState {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir: Mutex::new(dir),
        }
    }

    fn current(&self) -> Result<PathBuf, String> {
        self.dir
            .lock()
            .map(|dir| dir.clone())
            .map_err(|_| "The vault path lock was poisoned.".to_string())
    }
}

/// The default vault location: `<Documents>/TaskTracker`.
///
/// Documents rather than AppData on purpose — the whole point of this vault is
/// that the user (and whatever agent they point at it) can find and read it
/// without hunting through a hidden application folder.
pub fn default_vault_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("TaskTracker")
}

/// Is this a filename the app owns?
///
/// Mirrors `isSafeVaultName` in `src/lib/vault.ts`. Both exist deliberately:
/// the TypeScript guard catches mistakes early, this one is the actual security
/// boundary, because it is the only one an attacker-controlled webview can't
/// skip.
fn is_safe_name(name: &str) -> bool {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return false;
    }

    if name == "CONTEXT.md" {
        return true;
    }

    let Some(stem) = name.strip_suffix(".md") else {
        return false;
    };

    // `YYYY-MM-DD`
    let is_day = stem.len() == 10
        && stem
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                4 | 7 => character == '-',
                _ => character.is_ascii_digit(),
            });

    // `YYYY-Www`
    let is_week = stem.len() == 8
        && stem
            .chars()
            .enumerate()
            .all(|(index, character)| match index {
                4 => character == '-',
                5 => character == 'W',
                _ => character.is_ascii_digit(),
            });

    is_day || is_week
}

fn resolve(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if !is_safe_name(name) {
        return Err(format!(
            "Refusing to touch an unexpected vault file: {name}"
        ));
    }
    Ok(dir.join(name))
}

fn ensure_dir(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("Could not create {}: {err}", dir.display()))
}

/// Write a file atomically: fully write a temporary sibling, then rename over
/// the target.
///
/// A day file is the only copy of that day's notes. A partial write — the app
/// killed mid-save, the machine losing power — would otherwise truncate it.
/// `rename` within a directory is atomic on both NTFS and POSIX filesystems, so
/// a reader sees either the old file or the complete new one, never a half of
/// each.
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let temp = path.with_extension("md.tmp");

    fs::write(&temp, contents)
        .map_err(|err| format!("Could not write {}: {err}", temp.display()))?;

    fs::rename(&temp, path).map_err(|err| {
        // Best-effort cleanup so a failed rename doesn't leave litter behind.
        let _ = fs::remove_file(&temp);
        format!("Could not save {}: {err}", path.display())
    })
}

/// The absolute path of the active vault, for display in settings.
#[tauri::command]
pub fn vault_dir(state: State<'_, VaultState>) -> Result<String, String> {
    Ok(state.current()?.to_string_lossy().into_owned())
}

/// Point the vault at a different folder, creating it if necessary.
#[tauri::command]
pub fn vault_set_dir(path: String, state: State<'_, VaultState>) -> Result<(), String> {
    let dir = PathBuf::from(path);
    ensure_dir(&dir)?;

    let mut current = state
        .dir
        .lock()
        .map_err(|_| "The vault path lock was poisoned.".to_string())?;
    *current = dir;
    Ok(())
}

/// Read a vault file, or `None` when it doesn't exist yet.
///
/// A missing file is the normal case for the first check-in of a day, so it is
/// `Ok(None)` rather than an error the frontend has to pattern-match on.
#[tauri::command]
pub fn vault_read(name: String, state: State<'_, VaultState>) -> Result<Option<String>, String> {
    let path = resolve(&state.current()?, &name)?;

    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Could not read {}: {err}", path.display())),
    }
}

/// Write a vault file, creating the vault directory on first use.
#[tauri::command]
pub fn vault_write(
    name: String,
    contents: String,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    let dir = state.current()?;
    ensure_dir(&dir)?;
    write_atomic(&resolve(&dir, &name)?, &contents)
}

/// Every file the app owns in the vault. Files it doesn't own are filtered out,
/// so a stray document in the folder can't confuse the day-key scan.
#[tauri::command]
pub fn vault_list(state: State<'_, VaultState>) -> Result<Vec<String>, String> {
    let dir = state.current()?;

    // An absent vault is empty, not broken — this is the state on first launch.
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };

    let mut names = Vec::new();
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if is_safe_name(name) {
                names.push(name.to_string());
            }
        }
    }

    names.sort();
    Ok(names)
}

/// Reveal the vault folder in the OS file manager.
#[tauri::command]
pub fn open_vault_dir<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, VaultState>,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = state.current()?;
    ensure_dir(&dir)?;

    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|err| format!("Could not open the vault folder: {err}"))
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("Could not locate the config directory: {err}"))?;
    Ok(dir.join("settings.json"))
}

/// Read `settings.json`, or `None` on first run.
#[tauri::command]
pub fn settings_load<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;

    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Could not read {}: {err}", path.display())),
    }
}

/// Persist `settings.json`.
#[tauri::command]
pub fn settings_save<R: Runtime>(app: AppHandle<R>, contents: String) -> Result<(), String> {
    let path = settings_path(&app)?;
    if let Some(parent) = path.parent() {
        ensure_dir(parent)?;
    }

    fs::write(&path, contents).map_err(|err| format!("Could not save {}: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::is_safe_name;

    #[test]
    fn accepts_the_filenames_the_app_writes() {
        assert!(is_safe_name("2026-08-02.md"));
        assert!(is_safe_name("2026-W32.md"));
        assert!(is_safe_name("CONTEXT.md"));
    }

    #[test]
    fn rejects_traversal_and_separators() {
        assert!(!is_safe_name("../secrets.md"));
        assert!(!is_safe_name("..\\secrets.md"));
        assert!(!is_safe_name("sub/2026-08-02.md"));
        assert!(!is_safe_name("sub\\2026-08-02.md"));
        assert!(!is_safe_name("..2026-08-02.md"));
    }

    #[test]
    fn rejects_anything_outside_the_known_shapes() {
        assert!(!is_safe_name("notes.md"));
        assert!(!is_safe_name("2026-08-02.txt"));
        assert!(!is_safe_name("2026-08-0.md"));
        assert!(!is_safe_name("20260802.md"));
        assert!(!is_safe_name("2026-X32.md"));
        assert!(!is_safe_name(""));
        assert!(!is_safe_name(".."));
    }
}
