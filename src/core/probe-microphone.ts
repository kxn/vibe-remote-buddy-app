/** Records the receiver's USB microphone, never the system default input. */
export class ProbeMicrophone {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private generation = 0;
  private timeout?: ReturnType<typeof setTimeout>;
  private failure = "";
  get error() {
    return this.failure;
  }
  async start() {
    this.cancel();
    this.failure = "";
    const generation = this.generation;
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((d) => d.kind === "audioinput" && d.label)) {
      // Permission grants device labels. Do not start a recorder on this input.
      const permission = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      permission.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    const inputs = devices.filter(
      (d) =>
        d.kind === "audioinput" &&
        /Remote USB S3|Remote microphone/i.test(d.label) &&
        d.deviceId !== "default" &&
        d.deviceId !== "communications",
    );
    if (inputs.length !== 1)
      throw Error(
        inputs.length
          ? "检测到多只接收器麦克风，请仅保留当前接收器"
          : "未找到接收器麦克风，请检查麦克风权限及 USB 连接",
      );
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: inputs[0].deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      throw Error("录音已取消");
    }
    this.stream = stream;
    try {
      this.chunks = [];
      this.recorder = new MediaRecorder(this.stream);
      this.recorder.ondataavailable = (e) => {
        if (e.data.size) this.chunks.push(e.data);
      };
      this.recorder.start(250);
      this.timeout = setTimeout(() => {
        this.failure = "试录等待超时，请重新录音";
        this.cancel();
      }, 90000);
    } catch (e) {
      this.cancel();
      throw e;
    }
  }
  async finish(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder || recorder.state !== "recording")
      throw Error("麦克风录音已中断，请重新录音");
    return new Promise((resolve, reject) => {
      recorder.onstop = () => {
        const result = new Blob(this.chunks, { type: recorder.mimeType });
        this.cancel();
        result.size ? resolve(result) : reject(Error("没有收到麦克风音频"));
      };
      recorder.onerror = () => {
        this.cancel();
        reject(Error("麦克风录音失败"));
      };
      recorder.stop();
    });
  }
  cancel() {
    this.generation++;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder) {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.chunks = [];
  }
}
