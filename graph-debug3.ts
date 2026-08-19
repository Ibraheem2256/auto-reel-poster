import { spawnSync } from "child_process";
import ffmpegPath from "ffmpeg-static";

const src = "C:/Users/ibraheem/Desktop/video uploader/smoke-src.mp4";
const music = "C:/Users/ibraheem/Desktop/video uploader/music.wav";

function run(name: string, args: string[]) {
  const r = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  console.log(name, "=>", r.status === 0 ? "OK" : "FAIL: " + (r.stderr || "").split("\n").slice(0, 2).join(" | ").slice(0, 220));
}

const base =
  "[0:a]highpass=f=75,aresample=44100[voice];[1:a]volume=0.18,aresample=44100[music];" +
  "[music][voice]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=350[musicD];" +
  "[voice][musicD]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14.0:TP=-1.5:LRA=11,aresample=44100[aout];" +
  "[0:v]scale=540:960[vid]";

const baseNoSide =
  "[0:a]highpass=f=75,aresample=44100[voice];[1:a]volume=0.18,aresample=44100[music];" +
  "[music]anull[musicD];" +
  "[voice][musicD]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14.0:TP=-1.5:LRA=11,aresample=44100[aout];" +
  "[0:v]scale=540:960[vid]";

const common = (g: string) => ["-i", src, "-i", music, "-filter_complex", g, "-map", "[vid]", "-map", "[aout]", "-t", "3", "-f", "null", "-"];

run("1 sidechain, both mapped", common(base));
run("2 no-sidechain, both mapped", common(baseNoSide));
run("3 sidechain, only [aout] mapped", ["-i", src, "-i", music, "-filter_complex", base, "-map", "[aout]", "-t", "3", "-f", "null", "-"]);
run("4 sidechain, no maps at all", ["-i", src, "-i", music, "-filter_complex", base, "-t", "3", "-f", "null", "-"]);
run("5 sidechain, rename labels", [
  "-i", src, "-i", music,
  "-filter_complex",
  "[0:a]highpass=f=75,aresample=44100[vox];[1:a]volume=0.18,aresample=44100[mus];[mus][vox]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=350[mduck];[vox][mduck]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14.0:TP=-1.5:LRA=11,aresample=44100[aout];[0:v]scale=540:960[vid]",
  "-map", "[vid]", "-map", "[aout]", "-t", "3", "-f", "null", "-",
]);