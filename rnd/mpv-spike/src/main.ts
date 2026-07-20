import { invoke } from "@tauri-apps/api/core";

document.getElementById("pause")!.addEventListener("click", () => invoke("mpv_toggle_pause"));
document.getElementById("back")!.addEventListener("click", () => invoke("mpv_seek", { seconds: -10 }));
document.getElementById("fwd")!.addEventListener("click", () => invoke("mpv_seek", { seconds: 10 }));

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    invoke("mpv_toggle_pause");
  } else if (e.code === "ArrowLeft") {
    invoke("mpv_seek", { seconds: -10 });
  } else if (e.code === "ArrowRight") {
    invoke("mpv_seek", { seconds: 10 });
  }
});
