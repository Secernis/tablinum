//! Running git as a subprocess.
//!
//! One place, one shape: a fixed program name, arguments as a slice, the
//! repository as the working directory. Nothing here ever builds the program
//! or an argument string out of user input — a path chosen by the user is only
//! ever `current_dir`, which is a location, not a command.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

/// Why a git call did not produce output.
///
/// Tagged so the frontend can tell "git is not on this machine" (a setup
/// problem to explain once) from "this folder is not a repository" (a picker
/// mistake to recover from) without parsing message text.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GitError {
    /// `git` could not be started at all.
    NotInstalled,
    /// The directory exists but git does not recognise it as a work tree.
    NotARepository { path: String },
    /// git ran and reported a failure; `message` is its stderr, trimmed.
    Failed { message: String },
}

/// Run `git <args>` inside `cwd` and return trimmed stdout.
///
/// Stderr is folded into the error rather than printed: a bundled desktop
/// binary has no terminal, so anything written there is lost, and the caller
/// is the one that can show it.
pub fn run(cwd: &Path, args: &[&str]) -> Result<String, GitError> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd);
    hide_console(&mut cmd);
    let output = cmd.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            GitError::NotInstalled
        } else {
            GitError::Failed {
                message: e.to_string(),
            }
        }
    })?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.contains("not a git repository") {
        return Err(GitError::NotARepository {
            path: cwd.display().to_string(),
        });
    }
    Err(GitError::Failed { message: stderr })
}

/// Keep git from flashing a console window on Windows.
///
/// The app itself is built with the windows subsystem, but a child process
/// started from it still gets a console unless told otherwise, and every git
/// call would open one for a fraction of a second.
#[cfg(windows)]
fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_cmd: &mut Command) {}
