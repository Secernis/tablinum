use std::path::PathBuf;

use crate::application::ports::RepositoryLocator;
use crate::application::{self, DiscoverRequest};
use crate::infrastructure::filesystem::FsLocator;
use crate::infrastructure::git_cli::GitCli;
use crate::interface::dto::{ErrorDto, LocatedRepositoryDto, OpenedRepositoryDto};

/// How deep a scan looks when the frontend does not say.
///
/// Four levels covers `Desktop/Clients/Acme/repo`; deeper than that is usually
/// a dependency tree, which the locator skips anyway.
const DEFAULT_MAX_DEPTH: usize = 4;

/// The directories a scan starts from by default.
#[tauri::command]
pub async fn default_roots() -> Vec<String> {
    FsLocator
        .default_roots()
        .into_iter()
        .map(|p| p.display().to_string())
        .collect()
}

/// Scan `roots` (or the defaults, when empty) for repositories.
///
/// Runs on the blocking pool: a scan walks directories and spawns git, and the
/// async runtime's threads are for shuttling messages, not for waiting on
/// disks.
#[tauri::command]
pub async fn discover_repositories(roots: Vec<String>, max_depth: Option<usize>) -> Vec<LocatedRepositoryDto> {
    let request = DiscoverRequest {
        roots: roots.into_iter().map(PathBuf::from).collect(),
        max_depth: max_depth.unwrap_or(DEFAULT_MAX_DEPTH),
    };
    let joined = tauri::async_runtime::spawn_blocking(move || {
        application::discover_repositories(&FsLocator, &GitCli, request)
    })
    .await;
    match joined {
        Ok(found) => found.into_iter().map(LocatedRepositoryDto::from).collect(),
        Err(e) => {
            log::error!("discover.join.failed error={e}");
            Vec::new()
        }
    }
}

/// Open the repository at `path` and summarize it.
#[tauri::command]
pub async fn open_repository(path: String) -> Result<OpenedRepositoryDto, ErrorDto> {
    let joined = tauri::async_runtime::spawn_blocking(move || application::open_repository(&GitCli, path)).await;
    match joined {
        Ok(result) => result.map(OpenedRepositoryDto::from).map_err(ErrorDto::from),
        Err(e) => Err(ErrorDto::Failed {
            message: format!("the open task did not finish: {e}"),
        }),
    }
}
