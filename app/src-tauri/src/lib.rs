// mzPeakViewer — Tauri v2 desktop shell.
//
// This is a thin native wrapper around the static, client-side web app. There
// are NO custom Rust commands: all data access (local Blob reads, remote HTTP
// range reads) happens in the webview/Worker exactly as in the browser build.
// The plugins below back the minimal capabilities declared in
// capabilities/default.json (dialog/fs for native file picking if the frontend
// ever wires it; opener for external https:// links).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running mzPeakViewer");
}
