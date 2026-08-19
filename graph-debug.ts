import { spawnSync } from "child_process";
import ffmpegPath from "ffmpeg-static";

const src = "C:/Users/ibraheem/Desktop/video uploader/smoke-src.mp4";

function run(name: string, args: string[]) {
  const r = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  console.log(name, "=>", r.status === 0 ? "OK" : "FAIL: " + (r.stderr || "").split("\n")[0]);
}

spawnSync(
  ffmpegPath!,
  ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x640:rate=30:duration=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", src],
  { encoding: "utf8" }
);

run("A trim+concat+voice chain", [
  "-i", src,
  "-filter_complex",
  "[0:v]trim=start=0.5:end=2.5,setpts=PTS-STARTPTS[v0];[0:v]trim=start=3:end=4.5,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[basev];[0:a]atrim=start=0.5:end=2.5,asetpts=PTS-STARTPTS[a0];[0:a]atrim=start=3:end=4.5,asetpts=PTS-STARTPTS[a1];[a0][a1]concat=n=2:v=0:a=1[basea];[basea],highpass=f=75,afftdn=nf=-25,deesser=i=0.35,aresample=44100[voice];[basev]scale=540:960:force_original_aspect_ratio=decrease[tailv]",
  "-map", "[tailv]", "-map", "[voice]", "-f", "null", "-",
]);

run("B deesser alone", ["-i", src, "-af", "deesser=i=0.35", "-f", "null", "-"]);

run("C sidechain+loudnorm", [
  "-i", src, "-i", src,
  "-filter_complex",
  "[1:a]volume=0.2[music];[0:a]highpass=f=75[voice];[music][voice]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=350[md];[voice][md]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]",
  "-map", "[aout]", "-f", "null", "-",
]);

run("D concat video only with [v0][v1] labels", [
  "-i", src,
  "-filter_complex",
  "[0:v]trim=start=0.5:end=2.5,setpts=PTS-STARTPTS[v0];[0:v]trim=start=3:end=4.5,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[basev];[basev]scale=540:960:force_original_aspect_ratio=decrease[tailv]",
  "-map", "[tailv]", "-f", "null", "-",
]);

run("E concat audio only", [
  "-i", src,
  "-filter_complex",
  "[0:a]atrim=start=0.5:end=2.5,asetpts=PTS-STARTPTS[a0];[0:a]atrim=start=3:end=4.5,asetpts=PTS-STARTPTS[a1];[a0][a1]concat=n=2:v=0:a=1[basea];[basea],highpass=f=75,afftdn=nf=-25,deesser=i=0.35,aresample=44100[voice]",
  "-map", "[voice]", "-f", "null", "-",
]);

run("F highpass only", ["-i", src, "-af", "highpass=f=75", "-f", "null", "-"]);
run("G afftdn only", ["-i", src, "-af", "afftdn=nf=-25", "-f", "null", "-"]);