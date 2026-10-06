// URL WebSocket Cloudflare Worker Anda (atau fallback broadcast lokal untuk uji coba tampilan)
const WS_SERVER_URL = "wss://echo.websocket.events"; // Ganti dengan URL Cloudflare Worker Anda jika sudah siap

const statusBar = document.getElementById("status-bar");
const handContainer = document.getElementById("player-hand");
const discardContainer = document.getElementById("discard-tiles");

// Kartu dummy awal pemain
let myHand = [
  "🀇 1W", "🀈 2W", "🀉 3W", 
  "🀐 1S", "🀑 2S", "🀒 3S", 
  "🀙 1T", "🀚 2T", "🀛 3T", 
  "🀀 Tmr", "🀀 Tmr", "🀄 Mer", "🀄 Mer"
];

let socket;

function initNetwork() {
  try {
    socket = new WebSocket(WS_SERVER_URL);

    socket.onopen = () => {
      statusBar.innerText = "Terkoneksi ke Server Online";
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "DISCARD") {
          addDiscardTile(msg.tile);
        }
      } catch (e) {
        // Jika data echo mentah
      }
    };

    socket.onerror = () => {
      statusBar.innerText = "Mode Offline (Visual Test)";
    };
  } catch (err) {
    statusBar.innerText = "Mode Offline (Visual Test)";
  }
}

function renderHand() {
  handContainer.innerHTML = "";
  myHand.forEach((tileText, index) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.innerText = tileText;
    tile.onclick = () => discardTile(index);
    handContainer.appendChild(tile);
  });
}

function discardTile(index) {
  const thrown = myHand.splice(index, 1)[0];
  renderHand();
  addDiscardTile(thrown);

  // Kirim data ke WebSocket
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "DISCARD", tile: thrown }));
  }
}

function addDiscardTile(tileText) {
  const tile = document.createElement("div");
  tile.className = "tile discarded";
  tile.innerText = tileText;
  discardContainer.appendChild(tile);
}

function claimAction(actionName) {
  alert(`Aksi: ${actionName}`);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "ACTION", action: actionName }));
  }
}

// Jalankan saat halaman dibuka
initNetwork();
renderHand();
