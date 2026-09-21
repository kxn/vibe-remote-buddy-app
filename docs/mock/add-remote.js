const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const names = {
  power: "电源",
  voice: "语音",
  up: "上",
  down: "下",
  left: "左",
  right: "右",
  ok: "确认",
  back: "返回",
  home: "主页",
  menu: "菜单",
  tv: "电视",
  volume_up: "音量＋",
  volume_down: "音量−",
  mute: "静音",
  settings: "设置",
  local: "本地",
  channel_up: "频道＋",
  channel_down: "频道−",
  star: "＊",
  hash: "＃",
};
const symbols = {
  power: "⏻",
  voice: "♪",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  ok: "✓",
  back: "↶",
  home: "⌂",
  menu: "≡",
  tv: "TV",
  volume_up: "＋",
  volume_down: "−",
  settings: "⚙",
};
const label = (b) =>
  b.label || names[b.semantic] || b.semantic.replace("digit_", "");
const devices = [
  { name: "Xiaomi Bluetooth Remote 2 Pro", matches: [0], signal: "信号良好" },
  { name: "小米蓝牙语音遥控器", matches: [1], signal: "信号良好" },
  { name: "CMCC_Voice_Remote", matches: [2, 3], signal: "信号良好" },
  { name: "Bluetooth remote", matches: [], signal: "信号良好" },
];
let s,
  epoch = 0,
  pending,
  drag;
function later(fn, ms = 800) {
  const token = epoch;
  setTimeout(() => {
    if (token === epoch) fn();
  }, ms);
}
function reset() {
  epoch++;
  s = {
    stage: "scan",
    selected: -1,
    all: false,
    busy: false,
    ready: false,
    model: 0,
    checked: new Set(),
    voice: "idle",
    heard: false,
    cells: Array(36).fill(null),
    active: -1,
    preset: "",
    title: "我的遥控器",
  };
  render();
  later(() => {
    s.ready = true;
    render();
  }, 600);
}
function notify(message) {
  $("status").textContent = message;
}
function ask(title, html, yes) {
  $("confirmTitle").textContent = title;
  $("confirmBody").innerHTML = html;
  pending = yes;
  $("confirm").showModal();
}
$("confirmNo").onclick = () => $("confirm").close();
$("confirmYes").onclick = () => {
  const action = pending;
  $("confirm").close();
  action?.();
};
function remote(model, interactive = false) {
  const g = model.geometry;
  const legacy = model.id.includes("legacy");
  // Crop empty side columns in legacy editor geometry; keep the actual occupied layout.
  const lo = legacy ? 20 : 0,
    span = legacy ? 60 : 100;
  return `<div class="remote ${model.confirmKeys ? "keypad" : ""}" style="height:350px;width:${legacy ? 132 : (350 * g.width) / g.height}px">${model.id === "xiaomi.rc003" ? '<div class="dpad"></div><div style="position:absolute;left:60%;top:38.6%;width:30%;height:19%;background:#22282a;border-radius:25px"></div>' : ""}${g.buttons
    .map((k) => {
      const b = model.buttons.find((b) => b.id === k.button);
      if (!b) return "";
      return `<button type="button" class="rkey ${s.checked.has(b.id) ? "verified" : ""}" ${interactive ? `data-key="${esc(b.id)}"` : 'tabindex="-1"'} aria-label="${esc(label(b))}" title="${esc(label(b))}" style="left:${((k.x - lo) / span) * 100}%;top:${k.y}%;width:${(k.width / span) * 100}%;height:${k.height}%;border-radius:${k.radius || 50}%;background:${k.fill || ""};color:${k.color || ""};border-color:${k.border || ""}">${esc(symbols[b.semantic] || k.symbol || label(b))}</button>`;
    })
    .join("")}</div>`;
}
function render() {
  const stage = s.stage;
  const step = { scan: 0, model: 1, keys: 2, voice: 2, layout: 3, success: 4 }[
    stage
  ];
  $("deviceName").textContent = s.selected >= 0 ? devices[s.selected].name : "";
  $("title").textContent = {
    scan: "添加遥控器",
    model: "选择机型",
    keys: "确认按键",
    voice: "确认语音",
    layout: "按键与布局",
    success: "添加完成",
  }[stage];
  const steps =
    stage === "voice" || stage === "layout"
      ? ["连接设备", "选择机型", "确认语音", "按键与布局"]
      : ["连接设备", "选择机型", "确认按键", "完成"];
  $("steps").innerHTML = steps
    .map(
      (v, i) =>
        `<span class="${i === step ? "active" : i < step ? "done" : ""}">${i < step ? "✓" : i + 1} ${v}</span>`,
    )
    .join("");
  $("status").textContent = "";
  $("next").disabled = false;
  $("back").disabled = s.busy;
  $("close").disabled = s.busy;
  $("back").textContent = stage === "scan" ? "取消" : "返回";
  $("back").hidden = stage === "success";
  $("next").textContent =
    stage === "scan"
      ? "连接"
      : stage === "layout"
        ? "保存并添加"
        : stage === "keys"
          ? "添加"
          : stage === "success"
            ? "完成"
            : "下一步";
  $("outcome").disabled = stage !== "scan" || s.busy;
  $("mockActions").innerHTML = "";
  $("mockHint").textContent = "选择设备体验不同分支。";
  let html = "";
  if (stage === "scan") {
    html = `<div class="toolbar"><div class="search-state"><i class="spinner"></i>搜索附近的遥控器</div><label><input id="showAll" type="checkbox" ${s.all ? "checked" : ""}> 显示所有机型</label></div><div class="devices">${s.ready && $("outcome").value !== "empty" ? devices.map((d, i) => (!s.all && !d.matches.length ? "" : `<button class="device ${s.selected === i ? "selected" : ""}" data-device="${i}" ${s.busy ? "disabled" : ""}><span class="radio"></span><span class="device-info">${d.name}<small>${d.matches.length ? "机型库中有匹配信息" : "未找到机型信息"}</small></span><small>${d.signal}</small></button>`)).join("") : '<div class="center muted" style="height:230px">请将遥控器靠近接收器，并进入配对模式</div>'}</div>`;
    $("next").disabled = s.selected < 0 || s.busy;
    if (s.busy) {
      $("next").textContent = "连接中…";
      notify("正在连接并读取设备信息…");
    }
  } else if (stage === "model") {
    const d = devices[s.selected];
    const m = models[s.model];
    html = `<div class="two"><div><label class="field">机型<select id="model">${d.matches.map((i) => `<option value="${i}" ${s.model === i ? "selected" : ""}>${esc(models[i].title)}</option>`).join("")}<option value="-1" ${s.model === -1 ? "selected" : ""}>未知遥控器需要适配</option></select></label><div class="summary"><span>✓ 已连接</span><span>${s.model < 0 ? "下一步确认语音，再设置按键布局。" : m.confirmKeys ? "下一步按一遍遥控器上的按键。" : "可以直接添加。"}</span></div></div><div class="preview">${s.model < 0 ? '<div class="symbol">?</div><p>创建新的遥控器配置</p>' : remote(m)}<small>${s.model < 0 ? "" : esc(m.title)}</small></div></div>`;
    $("mockHint").textContent =
      "移动示例包含两个候选，用于体验切换预览；不代表真实指纹结果。";
  } else if (stage === "keys") {
    const m = models[s.model];
    html = `<div class="two"><div><h3>依次按下并松开每个按键</h3><p class="muted">已确认的按键会变绿。</p><div class="counter">${s.checked.size}<small> / ${m.buttons.length}</small></div><div class="fixed-message" id="keyFeedback">${s.checked.size === m.buttons.length ? "全部按键已确认" : "等待按键…"}</div><div class="check-list">${m.buttons.map((b) => `<span class="${s.checked.has(b.id) ? "verified" : ""}">${esc(label(b))}${s.checked.has(b.id) ? " ✓" : ""}</span>`).join("")}</div></div><div class="preview">${remote(m, true)}</div></div>`;
    $("next").disabled = s.checked.size !== m.buttons.length;
    keyTools();
  } else if (stage === "voice") {
    html = `<div class="voice"><h3>按住语音键说话，再松开</h3><div class="bars ${s.voice === "recording" ? "recording" : ""}">${Array.from({ length: 21 }, (_, i) => `<i style="--d:${(i % 5) * -0.13}s;--h:${18 + (i % 6) * 8}px"></i>`).join("")}</div><div class="voice-state">${{ idle: "等待语音键…", recording: "正在录音…", done: "录音完成", failed: "没有收到音频，请重试" }[s.voice]}</div><div class="voice-controls">${s.voice === "done" ? '<button id="listen">▶ 试听</button><button id="recordAgain">重新录音</button>' : ""}</div><label><input id="heard" type="checkbox" ${s.heard ? "checked" : ""} ${s.voice !== "done" ? "disabled" : ""}> 声音正常</label></div>`;
    $("next").disabled = !s.heard;
    $("mockHint").textContent =
      "长按右侧按钮模拟语音键；试听是示例音，不访问麦克风。";
    $("mockActions").innerHTML =
      '<button id="hold">按住模拟语音</button> <button id="voiceFail">模拟无音频</button>';
  } else if (stage === "layout") {
    html = `<div class="editor-head"><label class="field">机型名称<input id="modelTitle" type="text" value="${esc(s.title)}"></label><label class="field">从已有布局复制<select id="preset"><option value="">选择布局</option>${models.map((m, i) => `<option value="${i}" ${s.preset === String(i) ? "selected" : ""}>${esc(m.title)}</option>`).join("")}</select></label></div>${s.preset !== "" ? `<div class="preset-preview"><div class="between"><span>${esc(models[+s.preset].title)} · ${models[+s.preset].buttons.length} 个按键</span><button id="loadPreset">加载此布局</button></div>${remote(models[+s.preset])}</div>` : ""}<div class="editor"><div><div class="canvas">${s.cells.map((b, i) => `<div class="cell" data-cell="${i}">${b ? `<button draggable="true" data-cell-key="${i}" class="${b.verified ? "verified" : ""}">${esc(label(b))}${b.verified ? " ✓" : ""}</button>` : "＋"}</div>`).join("")}</div></div><aside><h3>常用按键</h3><p class="instruction">把右侧按键拖到左侧。<br>也可点击空格，选择按键。</p><div class="palette">${Object.keys(
      names,
    )
      .map(
        (k) =>
          `<button draggable="true" data-semantic="${k}" ${s.cells.some((b) => b?.semantic === k) ? "disabled" : ""}>${names[k]}</button>`,
      )
      .join(
        "",
      )}</div><div class="remove" id="remove">拖到这里移除按键</div><div class="editor-status">${s.active >= 0 && s.cells[s.active] ? `请按下并松开「${esc(label(s.cells[s.active]))}」` : "点击布局中的按键，录入键码。语音键已确认。"}</div></aside></div>`;
    const buttons = s.cells.filter(Boolean);
    notify(
      `已确认 ${buttons.filter((b) => b.verified).length} / ${buttons.length} 个按键`,
    );
    $("next").disabled =
      !s.title.trim() ||
      !buttons.length ||
      buttons.some((b) => !b.verified) ||
      !buttons.some((b) => b.semantic === "voice");
    keyTools();
  } else
    html =
      '<div class="center"><div class="symbol">✓</div><h3>遥控器已添加</h3><p class="muted">现在可以使用了</p></div>';
  $("body").innerHTML = html;
  bind();
}
function keyTools() {
  $("mockHint").textContent =
    s.stage === "keys"
      ? "点击右侧预览模拟按下、松开。"
      : "模拟按键会记录当前选中的键；未选中时按顺序确认。";
  $("mockActions").innerHTML =
    '<button id="oneKey">模拟下一键</button> <button id="allKeys">模拟全部按键</button>';
}
function verify(id) {
  if (s.stage === "keys") {
    s.checked.add(id);
  } else {
    let i =
      s.active >= 0 ? s.active : s.cells.findIndex((b) => b && !b.verified);
    if (i >= 0) s.cells[i].verified = true;
    s.active = -1;
  }
  const scroll = $("body").scrollTop;
  render();
  $("body").scrollTop = scroll;
}
function bind() {
  document.querySelectorAll("[data-device]").forEach(
    (el) =>
      (el.onclick = () => {
        s.selected = +el.dataset.device;
        render();
      }),
  );
  if ($("showAll"))
    $("showAll").onchange = (e) => {
      s.all = e.target.checked;
      if (!s.all && s.selected === 3) s.selected = -1;
      render();
    };
  if ($("model"))
    $("model").onchange = (e) => {
      s.model = +e.target.value;
      s.checked.clear();
      render();
    };
  document.querySelectorAll("[data-key]").forEach((el) => {
    el.onpointerdown = (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add("pressed");
      $("keyFeedback").textContent = `${el.title} · 已按下，请松开`;
    };
    el.onpointerup = () => verify(el.dataset.key);
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        verify(el.dataset.key);
      }
    };
  });
  if ($("oneKey"))
    $("oneKey").onclick = () =>
      verify(models[s.model]?.buttons.find((b) => !s.checked.has(b.id))?.id);
  if ($("allKeys"))
    $("allKeys").onclick = () => {
      if (s.stage === "keys")
        models[s.model].buttons.forEach((b) => s.checked.add(b.id));
      else
        s.cells.forEach((b) => {
          if (b) b.verified = true;
        });
      render();
    };
  if ($("hold")) {
    const hold = $("hold");
    hold.onpointerdown = (e) => {
      e.preventDefault();
      hold.setPointerCapture(e.pointerId);
      s.voice = "recording";
      s.heard = false;
      document.querySelector(".bars").classList.add("recording");
      document.querySelector(".voice-state").textContent = "正在录音…";
      $("next").disabled = true;
    };
    hold.onpointerup = () => {
      s.voice = "done";
      render();
    };
    hold.onpointercancel = () => {
      s.voice = "failed";
      render();
    };
    hold.onkeydown = (e) => {
      if (e.key === " " && !e.repeat) {
        e.preventDefault();
        s.voice = "recording";
        document.querySelector(".bars").classList.add("recording");
      }
    };
    hold.onkeyup = (e) => {
      if (e.key === " ") {
        s.voice = "done";
        render();
      }
    };
    $("voiceFail").onclick = () => {
      s.voice = "failed";
      s.heard = false;
      render();
    };
    $("heard").onchange = (e) => {
      s.heard = e.target.checked;
      $("next").disabled = !s.heard;
    };
  }
  if ($("listen"))
    $("listen").onclick = () => {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C) {
        const c = new C(),
          o = c.createOscillator(),
          g = c.createGain();
        o.connect(g);
        g.connect(c.destination);
        g.gain.value = 0.06;
        o.frequency.value = 440;
        o.start();
        o.stop(c.currentTime + 0.35);
        o.onended = () => c.close();
      }
      notify("请确认试听结果");
    };
  if ($("recordAgain"))
    $("recordAgain").onclick = () => {
      s.voice = "idle";
      s.heard = false;
      render();
    };
  if ($("modelTitle"))
    $("modelTitle").oninput = (e) => {
      s.title = e.target.value;
      $("next").disabled =
        !s.title.trim() ||
        s.cells.filter(Boolean).some((b) => !b.verified) ||
        !s.cells.some((b) => b?.semantic === "voice");
    };
  if ($("preset"))
    $("preset").onchange = (e) => {
      s.preset = e.target.value;
      render();
    };
  if ($("loadPreset"))
    $("loadPreset").onclick = () =>
      ask("替换当前布局？", "当前布局及按键确认结果将被替换。", () => {
        const m = models[+s.preset];
        s.cells = Array(36).fill(null);
        const xs = [...new Set(m.geometry.buttons.map((k) => k.x))].sort(
            (a, b) => a - b,
          ),
          ys = [...new Set(m.geometry.buttons.map((k) => k.y))].sort(
            (a, b) => a - b,
          );
        m.geometry.buttons.forEach((k) => {
          const b = m.buttons.find((b) => b.id === k.button);
          const col = Math.round(
            (xs.indexOf(k.x) / Math.max(1, xs.length - 1)) * 2,
          );
          let i = ys.indexOf(k.y) * 3 + col;
          if (i >= 36 || s.cells[i]) i = s.cells.findIndex((x) => !x);
          if (b && i >= 0)
            s.cells[i] = { ...b, verified: b.semantic === "voice" };
        });
        s.preset = "";
        render();
      });
  document.querySelectorAll("[data-semantic]").forEach(
    (el) =>
      (el.ondragstart = (e) => {
        drag = { semantic: el.dataset.semantic };
        e.dataTransfer.setData("text/plain", el.dataset.semantic);
      }),
  );
  document.querySelectorAll("[data-cell-key]").forEach((el) => {
    el.ondragstart = (e) => {
      drag = { from: +el.dataset.cellKey };
      e.dataTransfer.setData("text/plain", "key");
    };
    el.onclick = (e) => {
      e.stopPropagation();
      s.active = +el.dataset.cellKey;
      const y = $("body").scrollTop;
      render();
      $("body").scrollTop = y;
    };
  });
  document.querySelectorAll("[data-cell]").forEach((el) => {
    el.ondragover = (e) => {
      e.preventDefault();
      el.classList.add("over");
    };
    el.ondragleave = () => el.classList.remove("over");
    el.ondrop = (e) => {
      e.preventDefault();
      const i = +el.dataset.cell;
      if (s.cells[i]) {
        el.classList.remove("over");
        return;
      }
      if (drag?.from !== undefined) {
        s.cells[i] = s.cells[drag.from];
        s.cells[drag.from] = null;
      } else if (
        drag?.semantic &&
        !s.cells.some((b) => b?.semantic === drag.semantic)
      )
        s.cells[i] = {
          semantic: drag.semantic,
          verified: drag.semantic === "voice",
        };
      drag = null;
      render();
    };
    el.onclick = () => {
      const i = +el.dataset.cell;
      if (s.cells[i]) return;
      ask(
        "添加按键",
        `<label class="field">按键<select id="newKey">${Object.keys(names)
          .filter((k) => !s.cells.some((b) => b?.semantic === k))
          .map((k) => `<option value="${k}">${names[k]}</option>`)
          .join(
            "",
          )}<option value="custom">自定义</option></select></label><input id="customName" type="text" placeholder="按键名称" hidden>`,
        () => {
          const k = $("newKey").value,
            custom = $("customName").value.trim();
          if (k === "custom" && !custom) return;
          s.cells[i] = {
            semantic: k === "custom" ? `custom_${i}` : k,
            label: k === "custom" ? custom : undefined,
            verified: k === "voice",
          };
          render();
        },
      );
      $("newKey").onchange = (e) =>
        ($("customName").hidden = e.target.value !== "custom");
    };
  });
  if ($("remove")) {
    $("remove").ondragover = (e) => e.preventDefault();
    $("remove").ondrop = (e) => {
      e.preventDefault();
      if (drag?.from !== undefined) s.cells[drag.from] = null;
      drag = null;
      render();
    };
  }
}
function finish() {
  s.busy = true;
  $("next").disabled = true;
  $("back").disabled = true;
  notify("正在保存到接收器…");
  later(() => {
    s.busy = false;
    s.stage = "success";
    render();
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h3>${esc(s.model < 0 ? s.title : models[s.model].title)}</h3><p>● 可用</p>`;
    $("homeCards").querySelector(".home-empty")?.remove();
    $("homeCards").append(el);
  });
}
$("next").onclick = () => {
  if (s.busy) return;
  if (s.stage === "scan") {
    s.busy = true;
    render();
    later(() => {
      s.busy = false;
      if ($("outcome").value === "fail") {
        render();
        notify("连接未成功。请唤醒遥控器后重试。");
        return;
      }
      s.model = devices[s.selected].matches[0] ?? -1;
      s.stage = "model";
      render();
    });
  } else if (s.stage === "model") {
    if (s.model < 0) {
      s.stage = "voice";
      render();
    } else if (models[s.model].confirmKeys) {
      s.stage = "keys";
      s.checked.clear();
      render();
    } else finish();
  } else if (s.stage === "keys" || s.stage === "layout") finish();
  else if (s.stage === "voice") {
    s.stage = "layout";
    if (!s.cells.some(Boolean))
      s.cells[1] = { semantic: "voice", verified: true };
    render();
  } else $("wizard").close();
};
function close() {
  if (s.stage === "scan" || s.stage === "success") {
    $("wizard").close();
    epoch++;
  } else
    ask("退出添加？", "本次添加尚未保存。", () => {
      $("wizard").close();
      epoch++;
    });
}
$("close").onclick = close;
$("wizard").oncancel = (e) => {
  e.preventDefault();
  close();
};
$("back").onclick = () => {
  if (s.stage === "scan") close();
  else if (s.stage === "model") reset();
  else if (s.stage === "layout") {
    s.stage = "voice";
    render();
  } else {
    s.stage = "model";
    render();
  }
};
$("open").onclick = () => {
  reset();
  $("wizard").showModal();
};
$("reset").onclick = reset;
$("outcome").onchange = reset;
reset();
$("wizard").showModal();
