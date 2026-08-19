import { spawnSync } from "child_process";
import ffmpegPath from "ffmpeg-static";

const src = "C:/Users/ibraheem/Desktop/video uploader/smoke-src.mp4";
const music = "C:/Users/ibraheem/Desktop/video uploader/music.wav";

function run(name: string, args: string[]) {
  const r = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  console.log(name, "=>", r.status === 0 ? "OK" : "FAIL: " + (r.stderr || "").split("\n").slice(0, 2).join(" | ").slice(0, 200));
}

const tail = "[0:v]scale=540:960[vid]";

run("A acompressor sidechain 2nd input", ["-i", src, "-i", music, "-filter_complex",
  "[0:a]aresample=44100[vox];[1:a]volume=0.18,aresample=44100[mus];[vox][mus]acompressor=threshold=0.03:ratio=6:attack=25:release=350[duck];[vox][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout];" + tail,
  "-map", "[vid]", "-map", "[aout]", "-t", "3", "-f", "null", "-"]);

run("B acompressor + sidechain=1", ["-i", src, "-i", music, "-filter_complex",
  "[0:a]aresample=44100[vox];[1:a]volume=0.18,aresample=44100[mus];[vox][mus]acompressor=threshold=0.03:ratio=6:attack=25:release=350:sidechain=1[duck];[vox][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout];" + tail,
  "-map", "[vid]", "-map", "[aout]", "-t", "3", "-f", "null", "-"]);

run("C sidechaincompress input order swapped", ["-i", src, "-i", music, "-filter_complex",
  "[0:a]aresample=44100[vox];[1:a]volume=0.18,aresample=44100[mus];[vox][mus]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=350[duck];[vox][duck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout];" + tail,
  "-map", "[vid]", "-map", "[aout]", "-t", "3", "-f", "null", "-"]);

run("D volume envelope ducking (no sidechain)", ["-i", src, "-i", music, "-filter_complex",
  "[0:a]aresample=44100[vox];[1:a]volume='between(t,0,2)*0.08+between(t,2,10)*0.18',aresample=44100[mus];[vox][mus]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout];" + tail,
  "-map", "[vid]", "-map", "[aout]", "-t", "3", "-f", "null", "-"]);