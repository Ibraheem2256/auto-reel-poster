import { spawnSync } from "child_process";
import ffmpegPath from "ffmpeg-static";

const src = "C:/Users/ibraheem/Desktop/video uploader/smoke-src.mp4";

function run(name: string, args: string[]) {
  const r = spawnSync(ffmpegPath!, ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  console.log(name, "=>", r.status === 0 ? "OK" : "FAIL: " + (r.stderr || "").split("\n").slice(0, 3).join(" | "));
}

// generate music + sfx wavs
spawnSync(ffmpegPath!, ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=5", "-c:a", "pcm_s16le", "C:/Users/ibraheem/Desktop/video uploader/music.wav"], { encoding: "utf8" });
spawnSync(ffmpegPath!, ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-c:a", "pcm_s16le", "C:/Users/ibraheem/Desktop/video uploader/sfx0.wav"], { encoding: "utf8" });

const graph1 =
  "[0:a]atrim=start=0.5:end=2.5,asetpts=PTS-STARTPTS[a0];[0:a]atrim=start=3:end=4.5,asetpts=PTS-STARTPTS[a1];[a0][a1]concat=n=2:v=0:a=1[basea];[basea]highpass=f=75,afftdn=nf=-25,deesser=i=0.35,aresample=44100[voice];[1:a]volume=0.18,afade=t=in:st=0:d=0.15,afade=t=out:st=1.50:d=0.50,aresample=44100[music];[music][voice]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=350[musicD];[2:a]aresample=44100,adelay=384:all=1,volume=0.40[sfx0];[voice][musicD][sfx0]amix=inputs=3:duration=first:normalize=0,loudnorm=I=-14.0:TP=-1.5:LRA=11,aresample=44100[aout];[0:v]trim=start=0.5:end=2.5,setpts=PTS-STARTPTS[v0];[0:v]trim=start=3:end=4.5,setpts=PTS-STARTPTS[v1];[v0][v1]concat=n=2:v=1:a=0[basev];[basev]scale=540:960:force_original_aspect_ratio=decrease,pad=540:960:(ow-iw)/2:(oh-ih)/2:color=black,fade=t=in:st=0:d=0.35,fade=t=out:st=1.40:d=0.6[v]";

run("full graph (sidechain)", [
  "-i", src, "-i", "C:/Users/ibraheem/Desktop/video uploader/music.wav", "-i", "C:/Users/ibraheem/Desktop/video uploader/sfx0.wav",
  "-filter_complex", graph1,
  "-map", "[v]", "-map", "[aout]", "-t", "4.2",
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", "-b:a", "192k",
  "-f", "null", "-",
]);

const graph2 = graph1.replace("[music][voice]sidechaincompress=threshold=0.03:ratio=6:attack=25:release=350[musicD]", "[music]anull[musicD]");
run("full graph (no sidechain)", [
  "-i", src, "-i", "C:/Users/ibraheem/Desktop/video uploader/music.wav", "-i", "C:/Users/ibraheem/Desktop/video uploader/sfx0.wav",
  "-filter_complex", graph2,
  "-map", "[v]", "-map", "[aout]", "-t", "4.2",
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", "-b:a", "192k",
  "-f", "null", "-",
]);

const graph3 = graph1.replace("[2:a]aresample=44100,adelay=384:all=1,volume=0.40[sfx0]", "[2:a]aresample=44100,adelay=384:all=1,volume=0.40[sfx0]").replace("[voice][musicD][sfx0]amix", "[voice][musicD]amix2")
run("amix 2 inputs only", [
  "-i", src, "-i", "C:/Users/ibraheem/Desktop/video uploader/music.wav", "-i", "C:/Users/ibraheem/Desktop/video uploader/sfx0.wav",
  "-filter_complex", graph3,
  "-map", "[v]", "-map", "[aout]", "-t", "4.2",
  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", "-b:a", "192k",
  "-f", "null", "-",
]);