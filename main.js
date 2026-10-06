// Konfigurasi URL WebSocket Cloudflare Worker Anda
const WS_SERVER_URL = "wss://mahjong-pvp-server.owning.workers.dev/ws";

// Elemen Antarmuka (DOM)
const statusBar = document.getElementById("status-bar");
const handContainer = document.getElementById("player-hand");
const discardContainer = document.getElementById("discard-tiles");
const handTop = document.getElementById("hand-top");
const handLeft = document.getElementById("hand-left");
const handRight = document.getElementById("hand-right");
const btnPung = document.getElementById("btn-pung");

// State Permainan
let socket = null;
let wallDeck = [];
let myHand = [];
let lastDiscardedTile = null;

// Daftar Balok Mahjong Standar (Total 136 Balok)
const SUITS = [
  { name: "Wan", symbol: "🀇", count: 9 },
  { name: "Pin", symbol: "🀙", count: 9 },
  { name: "Sou", symbol: "🀐", count: 9 }
];
const HONORS = [
  { name: "Dong", symbol: "🀀" },
  { name: "Nan", symbol: "🀁" },
  { name: "Xi", symbol: "🀂" },
  { name: "Bei", symbol: "🀃" },
  { name: "Zhong", symbol: "🀄" },
  { name: "Fa", symbol: "🀅" },
  { name: "Bai", symbol: "🀆" }
];

function createFullDeck() {
  const deck = [];

  SUITS.forEach((suit) => {
    for (let num = 1; num <= suit.count; num++) {
      for (let i = 0; i < 4; i++) {
        deck.push({
          id: `${num}_${suit.name}_${i}`,
          label: `${num} ${suit.name}`,
          display: `${suit.symbol} ${num}${suit.name[0]}`
        });
      }
    }
  });

  HONORS.forEach((honor, hIdx) => {
    for (let i = 0; i < 4; i++) {
      deck.push({
        id: `honor_${hIdx}_${i}`,
        label: honor.name,
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

function initNetwork() {
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      statusBar.innerText = "Terkoneksi ke Server Meja PvP Cloudflare!";
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "DISCARD") {
          addDiscardTile(msg.tile);
          checkPossibleActions(msg.tile);
        }
      } catch (e) {}
    };

    socket.onclose = () => {
      statusBar.innerText = "Mode Offline (Visual & Logika Lokal)";
    };

    socket.onerror = () => {
      statusBar.innerText = "Mode Offline (Gagal konek server)";
    };
  } catch (err) {
    statusBar.innerText = "Mode Offline (Visual & Logika Lokal)";
  }
}

// Render Balok Tangan Pemain
function renderHand() {
  handContainer.innerHTML = "";
  myHand.forEach((tile, index) => {
    const tileElement = document.createElement("div");
    tileElement.className = "tile";
    tileElement.innerText = tile.display;
    tileElement.onclick = () => discardTile(index);
    handContainer.appendChild(tileElement);
  });
}

// Render Punggung Balok Lawan (13 keping per lawan)
function renderOpponents() {
  const opponentHolders = [handTop, handLeft, handRight];
  opponentHolders.forEach(holder => {
    holder.innerHTML = "";
    for (let i = 0; i < 13; i++) {
      const tileBack = document.createElement("div");
      tileBack.className = "tile-back";
      holder.appendChild(tileBack);
    }
  });
}

function drawTile() {
  if (wallDeck.length === 0) {
    statusBar.innerText = "Game Selesai: Tumpukan balok habis (Draw)!";
    return;
  }

  const newTile = wallDeck.pop();
  myHand.push(newTile);
  renderHand();
  statusBar.innerText = `Giliran Anda. Buang 1 balok (Sisa balok meja: ${wallDeck.length})`;
}

function discardTile(index) {
  const discarded = myHand.splice(index, 1)[0];
  lastDiscardedTile = discarded;

  renderHand();
  addDiscardTile(discarded);
  hideActionButtons();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "DISCARD",
      tile: discarded
    }));
  }

  // Simulasi giliran berikutnya: tarik kartu baru otomatis setelah 1 detik
  setTimeout(() => {
    drawTile();
  }, 1000);
}

function addDiscardTile(tile) {
  const tileElement = document.createElement("div");
  tileElement.className = "tile discarded";
  tileElement.innerText = tile.display || tile;
  discardContainer.appendChild(tileElement);
}

function checkPossibleActions(discardedTile) {
  const countSame = myHand.filter(t => t.display === discardedTile.display).length;

  if (countSame >= 2 && btnPung) {
    btnPung.style.display = "inline-block";
    btnPung.style.backgroundColor = "#27ae60";
  }
}

function hideActionButtons() {
  if (btnPung) {
    btnPung.style.backgroundColor = "";
  }
}

function claimAction(actionName) {
  if (actionName === "PUNG" && lastDiscardedTile) {
    let removed = 0;
    myHand = myHand.filter(tile => {
      if (tile.display === lastDiscardedTile.display && removed < 2) {
        removed++;
        return false;
      }
      return true;
    });

    renderHand();
    alert(`Berhasil PUNG untuk balok ${lastDiscardedTile.display}!`);
    hideActionButtons();
  } else {
    alert(`Aksi ${actionName} dipilih`);
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "ACTION",
      action: actionName
    }));
  }
}

function startNewGame() {
  wallDeck = createFullDeck();
  myHand = wallDeck.splice(0, 13);
  renderHand();
  renderOpponents();
  drawTile();
  initNetwork();
}

startNewGame();
