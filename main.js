// Konfigurasi WebSocket
const WS_SERVER_URL = "wss://mahjong-pvp-server.owning.workers.dev/ws";
const CLIENT_ID = "client_" + Math.random().toString(36).substring(2, 9);

// State Aturan & Level Assist
let currentGameMode = "HK";           // "HK" atau "RIICHI"
let assistLevel = "BEGINNER";          // "NEWBIE", "BEGINNER", "INTERMEDIATE"

let socket = null;
let currentRoomCode = null;
let mySeatIndex = 0;
let isHost = false;

// Skor Poin & Melds
let playerPoints = [25000, 25000, 25000, 25000];
let isRiichiDeclared = false;
let exposedMelds = [[], [], [], []];
let botHands = [[], [], [], []];

// State Permainan
let wallDeck = [];
let myHand = [];
let currentTurnSeat = -1;
let turnTimeRemaining = 15;
let turnTimerInterval = null;
let botActionTimer = null;
let claimTimeoutTimer = null;
let isProcessingTurn = false;
let lastDiscardedTile = null;
let lastDiscarderSeat = -1;
let lastDiscardElement = null;
let doraTile = null;

// Koleksi Balok Mahjong
const SUITS = [
  { name: "Wan", symbol: "🀇", order: 1, count: 9 },
  { name: "Pin", symbol: "🀙", order: 2, count: 9 },
  { name: "Sou", symbol: "🀐", order: 3, count: 9 }
];
const HONORS = [
  { name: "Dong", symbol: "🀀", val: 1 },
  { name: "Nan", symbol: "🀁", val: 2 },
  { name: "Xi", symbol: "🀂", val: 3 },
  { name: "Bei", symbol: "🀃", val: 4 },
  { name: "Zhong", symbol: "🀄", val: 5 },
  { name: "Fa", symbol: "🀅", val: 6 },
  { name: "Bai", symbol: "🀆", val: 7 }
];

function createFullDeck() {
  const deck = [];
  SUITS.forEach((suit) => {
    for (let num = 1; num <= suit.count; num++) {
      for (let i = 0; i < 4; i++) {
        deck.push({
          id: `${num}_${suit.name}_${i}`,
          suit: suit.name,
          num: num,
          order: suit.order,
          display: `${suit.symbol} ${num}${suit.name[0]}`
        });
      }
    }
  });

  HONORS.forEach((honor) => {
    for (let i = 0; i < 4; i++) {
      deck.push({
        id: `honor_${honor.name}_${i}`,
        suit: "Honor",
        num: honor.val,
        order: 4,
        display: `${honor.symbol} ${honor.name}`
      });
    }
  });

  return shuffleDeck(deck);
}

function shuffleDeck(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// 1. Logika Masuk Ruangan & Setting
function startCreateRoom() {
  const modeRadios = document.getElementsByName("rule-mode");
  for (const r of modeRadios) {
    if (r.checked) {
      currentGameMode = r.value;
      break;
    }
  }

  const selectLevelEl = document.getElementById("select-assist-level");
  if (selectLevelEl) {
    assistLevel = selectLevelEl.value;
  }

  const code = Math.floor(1000 + Math.random() * 9000).toString();
  isHost = true;
  mySeatIndex = 0;
  enterRoom(code);
}

function startJoinRoom() {
  const inputEl = document.getElementById("input-room-code");
  const code = (inputEl ? inputEl.value : "").trim().toUpperCase();
  if (code.length < 4) {
    alert("Masukkan 4 digit kode ruangan yang valid!");
    return;
  }

  const selectLevelEl = document.getElementById("select-assist-level");
  if (selectLevelEl) {
    assistLevel = selectLevelEl.value;
  }

  isHost = false;
  enterRoom(code);
}

function enterRoom(code) {
  currentRoomCode = code;

  const lobby = document.getElementById("lobby-screen");
  const table = document.getElementById("game-table");
  const badge = document.getElementById("room-badge");
  const ruleBadge = document.getElementById("rule-badge");
  const levelBadge = document.getElementById("level-badge");
  const doraBar = document.getElementById("dora-bar");

  if (badge) badge.innerText = `ROOM: ${code}`;
  if (ruleBadge) ruleBadge.innerText = currentGameMode;
  if (levelBadge) levelBadge.innerText = assistLevel;
  if (lobby) lobby.style.display = "none";
  if (table) table.style.display = "flex";

  if (currentGameMode === "RIICHI" && doraBar) {
    doraBar.classList.remove("hidden");
  }

  // Jika Intermediate: Tombol aksi selalu ditampilkan permanen (manual mode)
  if (assistLevel === "INTERMEDIATE") {
    showIntermediateManualButtons();
  }

  initNetwork();

  if (isHost) {
    wallDeck = createFullDeck();
    myHand = wallDeck.splice(0, 13);
    botHands[1] = wallDeck.splice(0, 13);
    botHands[2] = wallDeck.splice(0, 13);
    botHands[3] = wallDeck.splice(0, 13);

    if (currentGameMode === "RIICHI") {
      doraTile = wallDeck.pop();
      updateDoraUI();
    }
    sortMyHand();
    renderOpponents();
    updateSeatsInfo();

    setTimeout(() => {
      moveToNextTurn(0);
    }, 1000);
  } else {
    const statusBar = document.getElementById("status-bar");
    if (statusBar) statusBar.innerText = `Bergabung ke ROOM ${code}. Menunggu Host...`;
    renderOpponents();
  }
}

function updateDoraUI() {
  const doraEl = document.getElementById("dora-tile");
  if (doraEl && doraTile) {
    doraEl.innerText = doraTile.display;
  }
}

// 2. Sinkronisasi WebSocket
function initNetwork() {
  const statusBar = document.getElementById("status-bar");
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      sendSocketMessage({
        type: "JOIN_ROOM",
        room: currentRoomCode,
        isHost: isHost,
        mode: currentGameMode
      });
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.room !== currentRoomCode || msg.senderId === CLIENT_ID) return;

        if (msg.type === "JOIN_ROOM") {
          if (isHost) {
            sendSocketMessage({
              type: "SYNC_GAME_STATE",
              wallDeck: wallDeck,
              doraTile: doraTile,
              mode: currentGameMode,
              turnSeat: currentTurnSeat
            });
          }
        } else if (msg.type === "SYNC_GAME_STATE" && !isHost) {
          wallDeck = msg.wallDeck;
          doraTile = msg.doraTile;
          currentGameMode = msg.mode;
          updateDoraUI();
          if (myHand.length === 0) {
            myHand = wallDeck.splice(0, 13);
            sortMyHand();
          }
          applyTurn(msg.turnSeat);
        } else if (msg.type === "TURN_UPDATE") {
          applyTurn(msg.seat);
        } else if (msg.type === "DISCARD") {
          lastDiscarderSeat = msg.seat;
          addDiscardTile(msg.tile);
          evaluateDiscardForPlayer(msg.tile);
        } else if (msg.type === "MELD_CLAIMED") {
          removeLastDiscardFromPond();
          handleOpponentMeld(msg.seat, msg.meldTiles);
        } else if (msg.type === "RIICHI_DECLARED") {
          playerPoints[msg.seat] -= 1000;
          updateSeatsInfo();
          alert(`Pemain ${msg.seat + 1} menyatakan RIICHI!`);
        } else if (msg.type === "GAME_OVER") {
          removeLastDiscardFromPond();
          alert(`Game Selesai! Pemenang: Kursi ${msg.winnerSeat + 1}`);
          clearInterval(turnTimerInterval);
        }
      } catch (e) {}
    };

    socket.onerror = () => {
      if (statusBar) statusBar.innerText = "Mode Offline (Simulasi Lokal)";
    };
  } catch (err) {
    if (statusBar) statusBar.innerText = "Mode Offline (Simulasi Lokal)";
  }
}

function sendSocketMessage(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    payload.room = currentRoomCode;
    payload.senderId = CLIENT_ID;
    socket.send(JSON.stringify(payload));
  }
}

function updateSeatsInfo() {
  const labelBottom = document.getElementById("label-bottom");
  const labelRight = document.getElementById("label-right");
  const labelTop = document.getElementById("label-top");
  const labelLeft = document.getElementById("label-left");

  if (labelBottom) labelBottom.innerText = `Anda (${playerPoints[0]} pts)`;
  if (labelRight) labelRight.innerText = `P2 (${playerPoints[1]} pts)`;
  if (labelTop) labelTop.innerText = `P3 (${playerPoints[2]} pts)`;
  if (labelLeft) labelLeft.innerText = `P4 (${playerPoints[3]} pts)`;
}

// 3. Kontrol Giliran & Timer
function startTurnTimer() {
  clearInterval(turnTimerInterval);
  turnTimeRemaining = 15;
  const timerCount = document.getElementById("timer-count");
  if (timerCount) timerCount.innerText = turnTimeRemaining;

  turnTimerInterval = setInterval(() => {
    turnTimeRemaining--;
    if (timerCount) timerCount.innerText = turnTimeRemaining;

    if (turnTimeRemaining <= 0) {
      clearInterval(turnTimerInterval);
      if (currentTurnSeat === mySeatIndex) {
        discardTile(myHand.length - 1);
      }
    }
  }, 1000);
}

function applyTurn(seatIndex) {
  if (currentTurnSeat === seatIndex && isProcessingTurn) return;

  currentTurnSeat = seatIndex;
  isProcessingTurn = true;

  if (botActionTimer) {
    clearTimeout(botActionTimer);
    botActionTimer = null;
  }

  const seats = [
    document.getElementById("seat-bottom"),
    document.getElementById("seat-right"),
    document.getElementById("seat-top"),
    document.getElementById("seat-left")
  ];

  seats.forEach((seatEl, idx) => {
    if (!seatEl) return;
    if (idx === seatIndex) {
      seatEl.classList.add("active-turn");
    } else {
      seatEl.classList.remove("active-turn");
    }
  });

  startTurnTimer();

  const statusBar = document.getElementById("status-bar");
  if (currentTurnSeat === mySeatIndex) {
    if (statusBar) statusBar.innerText = "Giliran Anda: Sentuh balok untuk buang";
    drawTile();
    isProcessingTurn = false;
  } else {
    if (statusBar) statusBar.innerText = `Giliran Kursi ${currentTurnSeat + 1}...`;
    if (isHost) {
      botActionTimer = setTimeout(() => {
        executeBotTurn(currentTurnSeat);
      }, 2500);
    }
  }
}

function moveToNextTurn(nextSeat) {
  applyTurn(nextSeat);
  sendSocketMessage({
    type: "TURN_UPDATE",
    seat: nextSeat
  });
}

function executeBotTurn(seatIndex) {
  const statusBar = document.getElementById("status-bar");
  if (wallDeck.length === 0) {
    if (statusBar) statusBar.innerText = "Game Selesai: Balok Habis";
    clearInterval(turnTimerInterval);
    return;
  }

  const drawn = wallDeck.pop();
  botHands[seatIndex].push(drawn);

  const discarded = botHands[seatIndex].pop();
  lastDiscardedTile = discarded;
  lastDiscarderSeat = seatIndex;
  addDiscardTile(discarded);

  // Evaluasi balok untuk peluang pemain manusia
  const canPlayerClaim = evaluateDiscardForPlayer(discarded);

  botActionTimer = setTimeout(() => {
    isProcessingTurn = false;
    hideAssistNotification();
    if (isHost && checkOtherBotsClaim(seatIndex, discarded)) {
      return;
    }
    moveToNextTurn((seatIndex + 1) % 4);
  }, canPlayerClaim ? 5000 : 1800); // Beri waktu 5 detik bagi pemain untuk berpikir jika ada klaim
}

// 4. Render Balok & Area Buangan
function renderHand() {
  const handContainer = document.getElementById("player-hand");
  if (!handContainer) return;

  handContainer.innerHTML = "";
  myHand.forEach((tile, index) => {
    const tileElement = document.createElement("div");
    tileElement.className = "tile";
    tileElement.innerText = tile.display;
    tileElement.addEventListener("click", () => {
      if (currentTurnSeat === mySeatIndex) {
        discardTile(index);
      } else {
        alert("Bukan giliran Anda!");
      }
    });
    handContainer.appendChild(tileElement);
  });
}

function renderOpponents() {
  const holders = [
    document.getElementById("hand-top"),
    document.getElementById("hand-left"),
    document.getElementById("hand-right")
  ];

  holders.forEach((holder) => {
    if (!holder) return;
    holder.innerHTML = "";
    for (let i = 0; i < 13; i++) {
      const tileBack = document.createElement("div");
      tileBack.className = "tile-back";
      holder.appendChild(tileBack);
    }
  });
}

function sortMyHand() {
  myHand.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.num - b.num;
  });
  renderHand();
}

function drawTile() {
  const statusBar = document.getElementById("status-bar");
  const btnHu = document.getElementById("btn-win");
  const btnRiichi = document.getElementById("btn-riichi");

  if (wallDeck.length === 0) {
    if (statusBar) statusBar.innerText = "Game Selesai: Balok Habis";
    clearInterval(turnTimerInterval);
    return;
  }

  const newTile = wallDeck.pop();
  myHand.push(newTile);
  renderHand();

  // Mode Riichi
  if (currentGameMode === "RIICHI" && !isRiichiDeclared && exposedMelds[0].length === 0) {
    if (checkTenpai(myHand) && btnRiichi) {
      if (assistLevel !== "INTERMEDIATE") {
        btnRiichi.classList.remove("hidden");
      }
    }
  }

  // Cek Menang Tsumo
  if (validateWin(myHand, true)) {
    if (assistLevel === "NEWBIE") {
      showAssistNotification("PELUANG TSUMO (HU)! Tangan Anda Lengkap!");
      if (btnHu) btnHu.classList.remove("hidden");
    } else if (assistLevel === "BEGINNER") {
      if (btnHu) btnHu.classList.remove("hidden");
    }
    if (statusBar) statusBar.innerText = "HU! Tangan lengkap dan siap menang!";
  }
}

function discardTile(index) {
  const discarded = myHand.splice(index, 1)[0];
  lastDiscardedTile = discarded;
  lastDiscarderSeat = mySeatIndex;

  renderHand();
  addDiscardTile(discarded);
  hideActionButtons();
  hideAssistNotification();

  sendSocketMessage({
    type: "DISCARD",
    tile: discarded,
    seat: mySeatIndex
  });

  if (isHost && checkOtherBotsClaim(0, discarded)) {
    return;
  }

  moveToNextTurn((mySeatIndex + 1) % 4);
}

function addDiscardTile(tile) {
  const discardContainer = document.getElementById("discard-tiles");
  if (!discardContainer) return;

  const tileElement = document.createElement("div");
  tileElement.className = "tile discarded";
  tileElement.innerText = tile.display || tile;
  discardContainer.appendChild(tileElement);
  discardContainer.scrollTop = discardContainer.scrollHeight;
  lastDiscardElement = tileElement;
}

function removeLastDiscardFromPond() {
  if (lastDiscardElement && lastDiscardElement.parentNode) {
    lastDiscardElement.parentNode.removeChild(lastDiscardElement);
    lastDiscardElement = null;
  }
}

// 5. Evaluasi Balok & Sistem Bantuan 3 Level
function evaluateDiscardForPlayer(discardedTile) {
  const btnPung = document.getElementById("btn-pung");
  const btnChow = document.getElementById("btn-chow");
  const btnKong = document.getElementById("btn-kong");
  const btnHu = document.getElementById("btn-win");
  const btnSkip = document.getElementById("btn-skip");

  let canPung = false;
  let canKong = false;
  let canChow = false;
  let canHu = false;

  // 1. Cek Kemungkinan Pung & Kong
  const countSame = myHand.filter((t) => t.display === discardedTile.display).length;
  if (countSame >= 2) canPung = true;
  if (countSame === 3) canKong = true;

  // 2. Cek Kemungkinan Chow (Hanya dari Pemain Kiri / Kursi 3)
  const leftSeatIndex = (mySeatIndex + 3) % 4;
  if (lastDiscarderSeat === leftSeatIndex && discardedTile.suit !== "Honor") {
    const suit = discardedTile.suit;
    const n = discardedTile.num;
    const hasNum = (num) => myHand.some((t) => t.suit === suit && t.num === num);

    if ((hasNum(n - 2) && hasNum(n - 1)) || (hasNum(n - 1) && hasNum(n + 1)) || (hasNum(n + 1) && hasNum(n + 2))) {
      canChow = true;
    }
  }

  // 3. Cek Kemungkinan Hu (Ron)
  const testHand = [...myHand, discardedTile];
  if (validateWin(testHand, false)) {
    canHu = true;
  }

  const anyAvailable = canPung || canKong || canChow || canHu;

  // === PENERAPAN ATURAN 3 LEVEL ASSIST ===
  if (assistLevel === "NEWBIE") {
    // Level 1: Munculkan banner teks notifikasi mencolok + tombol aktif + tombol Lewatkan
    if (anyAvailable) {
      let notifyMsg = "Peluang Tersedia: ";
      if (canHu) notifyMsg += "HU (MENANG)! ";
      if (canPung) notifyMsg += "PUNG ";
      if (canChow) notifyMsg += "CHOW ";
      if (canKong) notifyMsg += "KONG ";

      showAssistNotification(notifyMsg);

      if (canHu && btnHu) btnHu.classList.remove("hidden");
      if (canPung && btnPung) btnPung.classList.remove("hidden");
      if (canChow && btnChow) btnChow.classList.remove("hidden");
      if (canKong && btnKong) btnKong.classList.remove("hidden");
      if (btnSkip) btnSkip.classList.remove("hidden");
    }
  } else if (assistLevel === "BEGINNER") {
    // Level 2: Banner notifikasi TIDAK muncul, hanya tombol yang otomatis menyala
    hideAssistNotification();
    if (anyAvailable) {
      if (canHu && btnHu) btnHu.classList.remove("hidden");
      if (canPung && btnPung) btnPung.classList.remove("hidden");
      if (canChow && btnChow) btnChow.classList.remove("hidden");
      if (canKong && btnKong) btnKong.classList.remove("hidden");
      if (btnSkip) btnSkip.classList.remove("hidden");
    }
  } else if (assistLevel === "INTERMEDIATE") {
    // Level 3: Sama sekali TIDAK ADA NOTIFIKASI dan TIDAK ADA AUTO-HIGHLIGHT
    hideAssistNotification();
    // Tombol tetap terbuka untuk manual tap
    showIntermediateManualButtons();
  }

  return anyAvailable;
}

function showAssistNotification(text) {
  const banner = document.getElementById("assist-notify-banner");
  const textEl = document.getElementById("assist-notify-text");
  if (banner && textEl) {
    textEl.innerText = text;
    banner.classList.remove("hidden");
  }
}

function hideAssistNotification() {
  const banner = document.getElementById("assist-notify-banner");
  if (banner) banner.classList.add("hidden");
}

function showIntermediateManualButtons() {
  const btnPung = document.getElementById("btn-pung");
  const btnChow = document.getElementById("btn-chow");
  const btnKong = document.getElementById("btn-kong");
  const btnHu = document.getElementById("btn-win");
  const btnSkip = document.getElementById("btn-skip");

  if (btnPung) btnPung.classList.remove("hidden");
  if (btnChow) btnChow.classList.remove("hidden");
  if (btnKong) btnKong.classList.remove("hidden");
  if (btnHu) btnHu.classList.remove("hidden");
  if (btnSkip) btnSkip.classList.remove("hidden");
}

function hideActionButtons() {
  if (assistLevel === "INTERMEDIATE") return; // Di intermediate tombol tetap standby

  const btnPung = document.getElementById("btn-pung");
  const btnChow = document.getElementById("btn-chow");
  const btnKong = document.getElementById("btn-kong");
  const btnHu = document.getElementById("btn-win");
  const btnRiichi = document.getElementById("btn-riichi");
  const btnSkip = document.getElementById("btn-skip");

  if (btnPung) btnPung.classList.add("hidden");
  if (btnChow) btnChow.classList.add("hidden");
  if (btnKong) btnKong.classList.add("hidden");
  if (btnHu) btnHu.classList.add("hidden");
  if (btnRiichi) btnRiichi.classList.add("hidden");
  if (btnSkip) btnSkip.classList.add("hidden");
}

// Fungsi Manual Skip bagi pemain yang menolak klaim
window.skipClaimAction = function () {
  hideAssistNotification();
  hideActionButtons();
  const statusBar = document.getElementById("status-bar");
  if (statusBar) statusBar.innerText = "Anda memilih MELEWATKAN balok ini.";
};

// 6. Eksekusi Aksi Klaim Manual
function claimAction(actionName) {
  if (!lastDiscardedTile && actionName !== "RIICHI") {
    alert("Belum ada balok buangan yang bisa diklaim!");
    return;
  }

  if (actionName === "RIICHI") {
    if (!checkTenpai(myHand)) {
      alert("Gagal Riichi: Tangan belum Tenpai (kurang 1 balok untuk menang)!");
      return;
    }
    isRiichiDeclared = true;
    playerPoints[0] -= 1000;
    updateSeatsInfo();
    hideActionButtons();
    alert("RIICHI aktif! Taruhan 1.000 poin dipasang.");
    sendSocketMessage({
      type: "RIICHI_DECLARED",
      seat: mySeatIndex
    });
    return;
  }

  if (actionName === "HU") {
    const testHand = [...myHand, lastDiscardedTile];
    if (!validateWin(testHand, false)) {
      alert("CHOMBO! Anda salah klaim HU. Tangan belum memenuhi syarat menang!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();
    alert("SELAMAT! ANDA MENANG (HU)! Balok berhasil diklaim.");
    clearInterval(turnTimerInterval);
    sendSocketMessage({
      type: "GAME_OVER",
      winnerSeat: mySeatIndex
    });
    return;
  }

  if (actionName === "PUNG") {
    const matching = myHand.filter((tile) => tile.display === lastDiscardedTile.display);
    if (matching.length < 2) {
      alert("Gagal PUNG: Anda tidak memiliki 2 balok kembar yang cocok!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();

    let removed = 0;
    const claimedTiles = [lastDiscardedTile];
    myHand = myHand.filter((tile) => {
      if (tile.display === lastDiscardedTile.display && removed < 2) {
        removed++;
        claimedTiles.push(tile);
        return false;
      }
      return true;
    });

    addExposedMeld(0, claimedTiles);
    renderHand();
    hideActionButtons();

    sendSocketMessage({
      type: "MELD_CLAIMED",
      seat: mySeatIndex,
      meldTiles: claimedTiles
    });

    // Pemain yang PUNG mendapat giliran jalan
    isProcessingTurn = false;
    currentTurnSeat = mySeatIndex;
    startTurnTimer();
    const statusBar = document.getElementById("status-bar");
    if (statusBar) statusBar.innerText = "PUNG berhasil! Silakan buang 1 balok.";
  }

  if (actionName === "CHOW") {
    const leftSeatIndex = (mySeatIndex + 3) % 4;
    if (lastDiscarderSeat !== leftSeatIndex) {
      alert("Gagal CHOW: Aturan resmi hanya membolehkan klaim dari pemain sebelah kiri!");
      return;
    }

    const suit = lastDiscardedTile.suit;
    const n = lastDiscardedTile.num;
    let t1 = null, t2 = null;

    if (myHand.some(t => t.suit === suit && t.num === n - 1) && myHand.some(t => t.suit === suit && t.num === n + 1)) {
      t1 = myHand.find(t => t.suit === suit && t.num === n - 1);
      t2 = myHand.find(t => t.suit === suit && t.num === n + 1);
    } else if (myHand.some(t => t.suit === suit && t.num === n + 1) && myHand.some(t => t.suit === suit && t.num === n + 2)) {
      t1 = myHand.find(t => t.suit === suit && t.num === n + 1);
      t2 = myHand.find(t => t.suit === suit && t.num === n + 2);
    } else if (myHand.some(t => t.suit === suit && t.num === n - 2) && myHand.some(t => t.suit === suit && t.num === n - 1)) {
      t1 = myHand.find(t => t.suit === suit && t.num === n - 2);
      t2 = myHand.find(t => t.suit === suit && t.num === n - 1);
    }

    if (!t1 || !t2) {
      alert("Gagal CHOW: Anda tidak memiliki pasangan angka yang bersambung!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();

    myHand = myHand.filter(t => t !== t1 && t !== t2);
    const claimedMeld = [t1, lastDiscardedTile, t2];
    addExposedMeld(0, claimedMeld);
    renderHand();
    hideActionButtons();

    sendSocketMessage({
      type: "MELD_CLAIMED",
      seat: mySeatIndex,
      meldTiles: claimedMeld
    });

    isProcessingTurn = false;
    currentTurnSeat = mySeatIndex;
    startTurnTimer();
    const statusBar = document.getElementById("status-bar");
    if (statusBar) statusBar.innerText = "CHOW berhasil! Silakan buang 1 balok.";
  }

  if (actionName === "KONG") {
    const matching = myHand.filter((tile) => tile.display === lastDiscardedTile.display);
    if (matching.length < 3) {
      alert("Gagal KONG: Anda harus memiliki 3 balok kembar di tangan!");
      return;
    }

    removeLastDiscardFromPond();
    hideAssistNotification();

    let removed = 0;
    const claimedTiles = [lastDiscardedTile];
    myHand = myHand.filter((tile) => {
      if (tile.display === lastDiscardedTile.display && removed < 3) {
        removed++;
        claimedTiles.push(tile);
        return false;
      }
      return true;
    });

    addExposedMeld(0, claimedTiles);
    drawTile();
    renderHand();
    hideActionButtons();

    sendSocketMessage({
      type: "MELD_CLAIMED",
      seat: mySeatIndex,
      meldTiles: claimedTiles
    });
  }
}

// 7. Otomatisasi Klaim untuk Bot Meja
function checkOtherBotsClaim(discarderSeat, discardedTile) {
  for (let seat = 1; seat <= 3; seat++) {
    if (seat === discarderSeat) continue;

    const testHand = [...botHands[seat], discardedTile];
    if (validateWin(testHand, false)) {
      removeLastDiscardFromPond();
      alert(`Pemain ${seat + 1} (Bot) mengklaim HU untuk balok ${discardedTile.display}! Permainan Selesai.`);
      sendSocketMessage({
        type: "GAME_OVER",
        winnerSeat: seat
      });
      return true;
    }

    const matching = botHands[seat].filter(t => t.display === discardedTile.display);
    if (matching.length >= 2) {
      removeLastDiscardFromPond();
      let removed = 0;
      botHands[seat] = botHands[seat].filter(t => {
        if (t.display === discardedTile.display && removed < 2) {
          removed++;
          return false;
        }
        return true;
      });

      const claimedMeld = [discardedTile, matching[0], matching[1]];
      addExposedMeld(seat, claimedMeld);
      sendSocketMessage({
        type: "MELD_CLAIMED",
        seat: seat,
        meldTiles: claimedMeld
      });

      moveToNextTurn(seat);
      return true;
    }
  }
  return false;
}

// 8. Tampilan Balok Terbuka (Meld UI)
function addExposedMeld(seatIndex, tiles) {
  exposedMelds[seatIndex].push(tiles);
  const containerIds = ["melds-bottom", "melds-right", "melds-top", "melds-left"];
  const targetEl = document.getElementById(containerIds[seatIndex]);
  if (!targetEl) return;

  const groupEl = document.createElement("div");
  groupEl.className = "meld-group";
  tiles.forEach((t) => {
    const tileDiv = document.createElement("div");
    tileDiv.className = "tile-meld";
    tileDiv.innerText = t.display;
    groupEl.appendChild(tileDiv);
  });
  targetEl.appendChild(groupEl);
}

function handleOpponentMeld(seatIndex, meldTiles) {
  addExposedMeld(seatIndex, meldTiles);
}

// 9. Validator Kemenangan Sesuai Mode
function validateWin(handTiles, isSelfDrawn) {
  if (!checkBasicMahjongStructure(handTiles)) return false;
  if (currentGameMode === "HK") return true;
  return checkRiichiYaku(handTiles, isSelfDrawn);
}

function checkBasicMahjongStructure(handTiles) {
  const counts = {};
  handTiles.forEach((t) => {
    const key = `${t.suit}_${t.num}`;
    counts[key] = (counts[key] || 0) + 1;
  });

  const uniqueKeys = Object.keys(counts);
  for (const pairKey of uniqueKeys) {
    if (counts[pairKey] >= 2) {
      counts[pairKey] -= 2;
      if (canFormMelds(counts)) {
        counts[pairKey] += 2;
        return true;
      }
      counts[pairKey] += 2;
    }
  }
  return false;
}

function canFormMelds(counts) {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);
  if (keys.length === 0) return true;

  const firstKey = keys[0];
  const [suit, numStr] = firstKey.split("_");
  const num = parseInt(numStr, 10);

  if (counts[firstKey] >= 3) {
    counts[firstKey] -= 3;
    if (canFormMelds(counts)) {
      counts[firstKey] += 3;
      return true;
    }
    counts[firstKey] += 3;
  }

  if (suit !== "Honor" && num <= 7) {
    const secondKey = `${suit}_${num + 1}`;
    const thirdKey = `${suit}_${num + 2}`;

    if (counts[secondKey] > 0 && counts[thirdKey] > 0) {
      counts[firstKey]--;
      counts[secondKey]--;
      counts[thirdKey]--;

      if (canFormMelds(counts)) {
        counts[firstKey]++;
        counts[secondKey]++;
        counts[thirdKey]++;
        return true;
      }

      counts[firstKey]++;
      counts[secondKey]++;
      counts[thirdKey]++;
    }
  }

  return false;
}

function checkRiichiYaku(handTiles, isSelfDrawn) {
  if (isRiichiDeclared) return true;
  if (isSelfDrawn && exposedMelds[0].length === 0) return true;

  const isTanyao = handTiles.every((t) => t.suit !== "Honor" && t.num >= 2 && t.num <= 8);
  if (isTanyao) return true;

  const counts = {};
  handTiles.forEach((t) => {
    const key = `${t.suit}_${t.num}`;
    counts[key] = (counts[key] || 0) + 1;
  });
  if (counts["Honor_5"] >= 3 || counts["Honor_6"] >= 3 || counts["Honor_7"] >= 3) {
    return true;
  }

  return false;
}

function checkTenpai(handTiles) {
  if (handTiles.length !== 14) return false;
  for (let i = 0; i < handTiles.length; i++) {
    const test13 = [...handTiles];
    test13.splice(i, 1);
    for (const suit of SUITS) {
      for (let n = 1; n <= 9; n++) {
        const dummyTile = { suit: suit.name, num: n, order: suit.order, display: `${suit.symbol} ${n}` };
        if (checkBasicMahjongStructure([...test13, dummyTile])) {
          return true;
        }
      }
    }
  }
  return false;
}

// Pasang Event Listener DOM
document.addEventListener("DOMContentLoaded", () => {
  const btnCreate = document.getElementById("btn-create-room");
  const btnJoin = document.getElementById("btn-join-room");
  const btnSort = document.getElementById("btn-sort");
  const btnRiichi = document.getElementById("btn-riichi");
  const btnChow = document.getElementById("btn-chow");
  const btnPung = document.getElementById("btn-pung");
  const btnKong = document.getElementById("btn-kong");
  const btnWin = document.getElementById("btn-win");

  if (btnCreate) btnCreate.addEventListener("click", startCreateRoom);
  if (btnJoin) btnJoin.addEventListener("click", startJoinRoom);
  if (btnSort) btnSort.addEventListener("click", sortMyHand);
  if (btnRiichi) btnRiichi.addEventListener("click", () => claimAction("RIICHI"));
  if (btnChow) btnChow.addEventListener("click", () => claimAction("CHOW"));
  if (btnPung) btnPung.addEventListener("click", () => claimAction("PUNG"));
  if (btnKong) btnKong.addEventListener("click", () => claimAction("KONG"));
  if (btnWin) btnWin.addEventListener("click", () => claimAction("HU"));
});
