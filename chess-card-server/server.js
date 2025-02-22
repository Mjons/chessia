// ------------------------------
// SERVER-SIDE Integration Block
// ------------------------------


let gameId = localStorage.getItem("gameId");
if (!gameId) {
  fetch("http://YOUR_SERVER_IP:3000/create-game", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  })
    .then(response => response.json())
    .then(data => {
      gameId = data._id;
      localStorage.setItem("gameId", gameId);
      loadGame();
    })
    .catch(err => console.error("Error creating game:", err));
} else {
  loadGame();
}

function loadGame() {
  fetch(`http://YOUR_SERVER_IP:3000/game/${gameId}`)
    .then(response => response.json())
    .then(data => {
      // Load board state from server
      game.board.position(data.boardState);
      // Only update this player's hand from server data
      playerHand[myColor] = data.playerHands[myColor] || [];
      game.updateCardDisplay();
    })
    .catch(err => console.error("Error loading game:", err));
  socket.emit("join-game", gameId);
}

function sendMove(fen) {
  socket.emit("move-piece", { gameId, fen });
}

socket.on("update-board", (fen) => {
  game.board.position(fen);
});

// Utility function to update hand display if needed
function updateHandDisplay(newHands) {
  playerHand[myColor] = newHands[myColor];
  game.updateCardDisplay();
}
