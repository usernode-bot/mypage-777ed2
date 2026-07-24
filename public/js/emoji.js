// MPEmoji — the shared emoji picker (stickers, mood widget). A curated
// static set, no network dependency: categories are space-separated
// strings (safe for multi-codepoint emoji, unlike string spreading).
// Recent picks persist in localStorage under mp_recent_emoji.
(function () {
  'use strict';

  const CATEGORIES = [
    ['smileys', '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫡 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 🤡 👻 💀 👽 👾 🤖 💩 😺 😸 😹 😻 😼 😽 🙀 😿 😾'],
    ['hearts & symbols', '💖 💗 💓 💞 💕 💘 💝 💟 ❤️ 🧡 💛 💚 💙 💜 🤎 🖤 🤍 💔 ❣️ 💋 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤 ✨ ⭐ 🌟 💎 🔥 🌈 ☀️ 🌤️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ 🌊 ⚡ ☄️ 🎵 🎶 ✅ ❌ ❓ ❗ ⭕ 🚫 ♻️ ✝️ ☮️ ☯️ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🔮 🧿 ☘️ 🍀'],
    ['animals & nature', '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🐣 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪲 🦋 🐌 🐞 🐜 🪰 🐢 🐍 🦎 🦂 🦀 🦞 🦐 🦑 🐙 🦈 🐬 🐳 🐋 🐟 🐠 🐡 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🐈‍⬛ 🐾 🦔 🐉 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 🍃 🍂 🍁 🍄 🐚 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌙 🌛 🌕 🌎 🪐'],
    ['food & drink', '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🫔 🥗 🥘 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🫖 🍵 🧃 🥤 🧋 🍶 🍺 🥂 🍷 🥃 🍸 🍹 🧉'],
    ['activities', '⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🪀 🏓 🏸 🏒 🥍 🏏 🪃 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🤽 🚣 🧗 🚴 🚵 🎪 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🪘 🎷 🎺 🪗 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🕹️ 🎰 🧩 🪅 🪆 🎨 🖼️ 🧵 🪡 🧶 🪢'],
    ['travel & places', '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🚧 ⛽ 🚏 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏘️ 🏚️ 🏗️ 🏢 🏬 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉 🎑'],
    ['objects', '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 🖲️ 💽 💾 💿 📀 📼 📷 📸 📹 🎥 📽️ 🎞️ 📞 ☎️ 📟 📠 📺 📻 🎙️ 🎚️ 🎛️ 🧭 ⏱️ ⏲️ ⏰ 🕰️ ⌛ ⏳ 📡 🔋 🔌 💡 🔦 🕯️ 🪔 🧯 🛢️ 💸 💵 💰 💳 💎 ⚖️ 🪜 🧰 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪚 🔩 ⚙️ 🪤 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🗡️ ⚔️ 🛡️ 🚬 ⚰️ 🪦 ⚱️ 🏺 🔭 🔬 🕳️ 🩹 🩺 💊 💉 🩸 🧬 🦠 🧫 🧪 🌡️ 🧹 🪠 🧺 🧻 🚽 🚿 🛁 🪥 🪒 🧼 🪣 🧽 🧴 🛎️ 🔑 🗝️ 🚪 🪑 🛋️ 🛏️ 🧸 🪆 🖼️ 🪞 🪟 🛍️ 🎁 🎈 🎏 🎀 🪄 🎊 🎉 🎎 🏮 🎐 🧧 ✉️ 📦 📫 📮 📜 📃 📑 🧾 📊 📈 📉 🗒️ 📆 📅 📇 🗃️ 🗄️ 📋 📁 📂 🗞️ 📓 📔 📕 📗 📘 📙 📚 📖 🔖 🧷 🔗 📎 🖇️ 📐 📏 🧮 📌 📍 ✂️ 🖊️ 🖋️ ✒️ 🖌️ 🖍️ 📝 ✏️ 🔍 🔎 🔏 🔐 🔒 🔓'],
    ['people & hands', '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 🥷 👷 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🕴️ 👯 🧖 👫 👭 👬 💏 💑 👪'],
  ];

  const RECENT_KEY = 'mp_recent_emoji';
  const RECENT_MAX = 24;

  function loadRecent() {
    try {
      const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(arr) ? arr.filter((e) => typeof e === 'string').slice(0, RECENT_MAX) : [];
    } catch { return []; }
  }
  function saveRecent(emoji) {
    try {
      const arr = [emoji].concat(loadRecent().filter((e) => e !== emoji)).slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
    } catch {}
  }

  function open({ title, onPick } = {}) {
    const content = document.createElement('div');
    let ctl;

    const pick = (emoji) => {
      saveRecent(emoji);
      ctl.close();
      if (onPick) onPick(emoji);
    };

    function grid(list) {
      const g = document.createElement('div');
      g.className = 'mp-emoji-grid';
      list.forEach((em) => {
        const b = document.createElement('button');
        b.className = 'mp-emoji-cell';
        b.textContent = em;
        b.addEventListener('click', () => pick(em));
        g.appendChild(b);
      });
      return g;
    }

    const recent = loadRecent();
    if (recent.length) {
      const label = document.createElement('div');
      label.className = 'mp-label';
      label.textContent = 'recent';
      content.append(label, grid(recent));
    }

    const tabs = document.createElement('div');
    tabs.className = 'mp-panel-row';
    content.appendChild(tabs);
    const mount = document.createElement('div');
    mount.className = 'mp-emoji-mount';
    content.appendChild(mount);

    let activeChip = null;
    function show(name, list, chip) {
      mount.textContent = '';
      mount.appendChild(grid(list));
      if (activeChip) activeChip.classList.remove('mp-chip-on');
      activeChip = chip;
      chip.classList.add('mp-chip-on');
    }
    CATEGORIES.forEach(([name, str], i) => {
      const list = str.split(' ');
      const chip = document.createElement('button');
      chip.className = 'mp-chip mp-chip-btn';
      chip.textContent = name;
      chip.addEventListener('click', () => show(name, list, chip));
      tabs.appendChild(chip);
      if (i === 0) show(name, list, chip);
    });

    ctl = MP.openModal({ title: title || 'Pick an emoji', contentEl: content, actions: [{ label: 'Close' }] });
    return ctl;
  }

  window.MPEmoji = { open };
})();
