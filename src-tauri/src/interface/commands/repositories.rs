use std::path::PathBuf;

use tauri::ipc::Channel;

use crate::application::{self, DiscoverRequest};
use crate::infrastructure::filesystem::FsLocator;
use crate::infrastructure::git_cli::GitCli;
use crate::infrastructure::tokei::TokeiCodeSize;
use crate::interface::dto::{ErrorDto, LocatedRepositoryDto, OpenedRepositoryDto};

/// How deep a scan looks when the frontend does not say.
///
/// Four levels covers `Clients/Acme/repo` under a chosen folder; deeper than
/// that is usually a dependency tree, which the locator skips anyway.
const DEFAULT_MAX_DEPTH: usize = 4;

/// Scan `roots` for repositories, sending each one down `on_found` as it is
/// described. Resolves with the total once the scan is over.
///
/// Runs on the blocking pool: a scan walks directories, spawns git and counts
/// lines, and the async runtime's threads are for shuttling messages, not for
/// waiting on disks.
#[tauri::command]
pub async fn discover_repositories(
    roots: Vec<String>,
    max_depth: Option<usize>,
    on_found: Channel<LocatedRepositoryDto>,
) -> Result<usize, ErrorDto> {
    let request = DiscoverRequest {
        roots: roots.into_iter().map(PathBuf::from).collect(),
        max_depth: max_depth.unwrap_or(DEFAULT_MAX_DEPTH),
    };
    let joined = tauri::async_runtime::spawn_blocking(move || {
        application::discover_repositories(&FsLocator, &GitCli, &TokeiCodeSize, request, &|located| {
            // A send fails only when the frontend went away mid-scan; there is
            // nobody left to tell, and the scan finishes on its own.
            if let Err(e) = on_found.send(LocatedRepositoryDto::from(located)) {
                log::warn!("discover.send.failed error={e}");
            }
        })
    })
    .await;
    joined.map_err(|e| ErrorDto::Failed {
        message: format!("the scan did not finish: {e}"),
    })
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
