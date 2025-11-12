export type MergeAudioBlobsResult = {
  blob: Blob;
  mimeType: string;
};

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i += 1) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const frames = buffer.length;
  const bytesPerSample = 2; // 16-bit PCM
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = frames * blockAlign;
  const bufferLength = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch += 1) {
    channelData[ch] = buffer.getChannelData(ch);
  }

  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let ch = 0; ch < numChannels; ch += 1) {
      let sample = channelData[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      view.setInt16(
        offset,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
      offset += 2;
    }
  }

  return arrayBuffer;
}

export async function mergeAudioBlobs(
  base: Blob | null,
  append: Blob | null
): Promise<MergeAudioBlobsResult | null> {
  if (!base && !append) return null;
  if (!base || base.size === 0) {
    const mime =
      append?.type && append.type.length > 0 ? append.type : "audio/webm";
    return append ? { blob: append, mimeType: mime } : null;
  }
  if (!append || append.size === 0) {
    const mime = base.type && base.type.length > 0 ? base.type : "audio/webm";
    return { blob: base, mimeType: mime };
  }

  if (typeof window === "undefined") {
    const fallbackType = append.type || base.type || "audio/webm";
    return {
      blob: new Blob([base, append], { type: fallbackType }),
      mimeType: fallbackType,
    };
  }

  const AudioCtx: typeof AudioContext | undefined =
    window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    const fallbackType = append.type || base.type || "audio/webm";
    return {
      blob: new Blob([base, append], { type: fallbackType }),
      mimeType: fallbackType,
    };
  }

  const ctx = new AudioCtx();
  try {
    const [baseBuffer, appendBuffer] = await Promise.all([
      ctx.decodeAudioData(await base.arrayBuffer()),
      ctx.decodeAudioData(await append.arrayBuffer()),
    ]);

    const sampleRate = ctx.sampleRate;
    const numberOfChannels = Math.max(
      baseBuffer.numberOfChannels,
      appendBuffer.numberOfChannels
    );
    const totalLength = baseBuffer.length + appendBuffer.length;
    const merged = ctx.createBuffer(numberOfChannels, totalLength, sampleRate);

    for (let ch = 0; ch < numberOfChannels; ch += 1) {
      const dest = merged.getChannelData(ch);
      if (ch < baseBuffer.numberOfChannels) {
        dest.set(baseBuffer.getChannelData(ch), 0);
      } else {
        dest.fill(0, 0, baseBuffer.length);
      }
      if (ch < appendBuffer.numberOfChannels) {
        dest.set(appendBuffer.getChannelData(ch), baseBuffer.length);
      } else {
        dest.fill(0, baseBuffer.length);
      }
    }

    const wavBuffer = audioBufferToWav(merged);
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    return { blob, mimeType: "audio/wav" };
  } catch (err) {
    const fallbackType = append.type || base.type || "audio/webm";
    return {
      blob: new Blob([base, append], { type: fallbackType }),
      mimeType: fallbackType,
    };
  } finally {
    void ctx.close().catch(() => {});
  }
}
